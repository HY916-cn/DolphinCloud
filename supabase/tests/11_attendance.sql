-- 考勤与工资 (PHASE-1.md §6.9).
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('t2', 'teller') as t2 \gset
select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.staff('acct', 'accountant') as acct \gset
select tests.student('s1', 10, '张小明') as s1 \gset
select tests.student('s2', 0, '李四') as s2 \gset
select app_private.cn_date(now()) as d \gset
select app_private.shift_of(now()) as now_shift \gset
-- Monday of this week, and a day of last week.
select (:'d'::date - (extract(isodow from :'d'::date)::integer - 1)) as monday \gset

-- 上班 / 下班
delete from duty where user_id = :'t1';
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's2', '{"10":1}')$$), 'OFF_DUTY', 'a teller off duty does no counter business');
select tests.call(:'t1', $$select start_duty()$$) as duty \gset
select is(tests.call(:'t1', $$select start_duty()$$) ->> 'id', :'duty'::jsonb ->> 'id', '上班 again answers the open duty');
select is((select count(*)::int from attendance), 0, 'a teller not counted signs no shift');
select is(tests.err(:'t1', $$select deposit('00000000-0000-4000-8000-000000000050', 's2', '{"10":1}')$$), null, 'on duty the teller serves');
select is(tests.err(:'t1', $$select end_duty(0)$$), 'SUMMARY_STALE', '下班 needs the summary of every transaction since 上班');
select is(tests.call(:'t1', $$select end_duty(1)$$) -> 'txns', '1', '下班 records how many transactions the signed summary has');
select is(tests.err(:'t1', $$select end_duty(1)$$), 'OFF_DUTY', 'and only an open duty ends');
select is(tests.err(:'t1', $$select withdraw(gen_random_uuid(), 's2', 1)$$), 'OFF_DUTY', 'after 下班 the counter is closed to the teller');
select is(tests.err(:'t2', $$select start_duty()$$), null, 'each teller has their own duty');
select is(tests.err(:'acct', $$select start_duty()$$), 'FORBIDDEN', 'only tellers go on duty');

-- 绑定工资账户
select is(tests.call(:'t1', $$select bind_salary_account(auth.uid(), 's1', 'wrong')$$) ->> 'error', 'WRONG_PASSWORD', 'the student account''s password is needed');
select is((select cardinality(failures) from app_private.login_attempts where user_id = :'s1'), 1, 'and a wrong one counts toward the lockout');
select is(tests.err(:'t1', format($$select bind_salary_account(%L, 's1', '123456')$$, :'t2')), 'FORBIDDEN', 'a teller binds only their own');
select is(tests.err(:'acct', format($$select bind_salary_account(%L, 's1', '123456')$$, :'t1')), 'FORBIDDEN', 'nor does the accountant');
select is(tests.err(:'teacher', format($$select set_attendance(%L, true)$$, :'t1')), 'SALARY_UNBOUND', 'a teller is counted only with a bound account');
select is(tests.call(:'t1', $$select bind_salary_account(auth.uid(), 's1', '123456')$$) ->> 'name', '张小明', 'the teller binds their student account');
select is((select count(*)::int from app_private.login_attempts where user_id = :'s1'), 0, 'the right password clears the count');
select is(tests.err(:'teacher', format($$select bind_salary_account(%L, 's1', '123456')$$, :'t2')), 'ALREADY_EXISTS', 'one staff login per account');
select is(tests.call(:'ops', format($$select bind_salary_account(%L, 's2', '123456')$$, :'t2')) ->> 'account', 's2', 'the sysadmin binds for a teller');
select is(tests.err(:'t1', $$select lookup_student('s1')$$), 'SELF_SERVICE_FORBIDDEN', 'a teller does not serve the account their pay goes to');
select is(tests.err(:'t2', $$select deposit('00000000-0000-4000-8000-000000000051', 's1', '{"10":1}')$$), null, 'another teller does');

-- 参与考勤
select is(tests.err(:'acct', format($$select set_attendance(%L, true)$$, :'t1')), 'FORBIDDEN', 'only the bank admin sets who is counted');
select is(tests.err(:'teacher', format($$select set_attendance(%L, true)$$, :'ops')), 'INVALID_INPUT', 'the sysadmin is not counted');
select tests.call(:'teacher', format($$select set_attendance(%L, true)$$, :'t1'));
select tests.call(:'teacher', format($$select set_attendance(%L, true)$$, :'t2'));
select is(tests.err(:'t2', $$select unbind_salary_account(auth.uid())$$), 'ATTENDANCE_ON', 'a counted teller keeps a bound account');

-- 签到 by 上班
select tests.call(:'t1', $$select start_duty()$$);
select tests.call(:'t1', $$select row_to_json(a) from attendance a$$) as signed \gset
select is(row(:'signed'::jsonb ->> 'day', :'signed'::jsonb ->> 'shift', :'signed'::jsonb ->> 'status')::text,
  row(:'d', :'now_shift', 'pending')::text, '上班 signs the shift of now, waiting for the bank admin');
select tests.call(:'t1', $$select end_duty(0)$$);
select tests.call(:'t1', $$select start_duty()$$);
select is((select count(*)::int from attendance), 1, 'coming and going within a shift signs it once');
select is(app_private.shift_of('2026-11-02 13:29:59+08'), 'am', '中午班 before 13:30');
select is(app_private.shift_of('2026-11-02 13:30:00+08'), 'pm', '下午班 from 13:30');
select is((select count(*)::int from jsonb_array_elements(tests.call(:'t2', $$select coalesce(jsonb_agg(a), '[]') from attendance a$$))), 0,
  'a teller reads only their own shifts');

-- 补签 and 审核
select is(tests.err(:'t1', format($$select makeup_attendance(%L, %L::date - 1, 'am', '忘记签到')$$, :'t1', :'d')), 'FORBIDDEN', 'only the bank admin signs in for a teller');
select is(tests.err(:'teacher', format($$select makeup_attendance(%L, %L::date + 1, 'am', '提前')$$, :'t1', :'d')), 'INVALID_INPUT', 'not a day to come');
select is(tests.err(:'teacher', format($$select makeup_attendance(%L, %L::date - 1, 'am', ' ')$$, :'t1', :'d')), 'INVALID_INPUT', 'a 补签 says why');
select is(tests.err(:'teacher', format($$select makeup_attendance(%L, %L, %L, '重复')$$, :'t1', :'d', :'now_shift')), 'ALREADY_EXISTS', 'not a shift already signed');
select tests.call(:'teacher', format($$select makeup_attendance(%L, %L, 'am', '忘记签到')$$, :'t2', :'monday')) ->> 'status' as made \gset
select is(:'made'::text, 'confirmed', 'a 补签 counts at once');
select tests.call(:'teacher', format($$select makeup_attendance(%L, %L::date - 7, 'pm', '上周补签')$$, :'t1', :'monday'));
select is(tests.err(:'teacher', format($$select pay_salaries(%L)$$, :'d')), 'ATTENDANCE_PENDING', 'pay waits until every shift of the week is reviewed');
select is(tests.err(:'t1', format($$select review_attendance(array[%L]::uuid[], 'confirmed')$$, :'signed'::jsonb ->> 'id')), 'FORBIDDEN', 'a teller does not confirm their own shift');
select is(tests.call(:'teacher', format($$select review_attendance(array[%L]::uuid[], 'confirmed', '已核实')$$, :'signed'::jsonb ->> 'id')) -> 'count', '1', 'the bank admin confirms a shift');
select is(tests.err(:'teacher', format($$select review_attendance(array[%L]::uuid[], 'rejected')$$, :'signed'::jsonb ->> 'id')), 'ATTENDANCE_REVIEWED', 'and the decision stands');
select is((select note from attendance where id = (:'signed'::jsonb ->> 'id')::uuid), '已核实', 'with its note');

-- 停用: t2 is no longer counted, and not paid
select tests.call(:'teacher', format($$select set_user_disabled(%L, true)$$, :'t2'));
select is((select attendance from staff_payroll where user_id = :'t2'), false, 'a stopped teller is no longer counted');
select is(tests.err(:'teacher', format($$select set_attendance(%L, true)$$, :'t2')), 'INVALID_INPUT', 'nor counted again while stopped');

-- 工资标准 (the rules of set_salary_rates are in 30_staff_attendance.sql)
update salary_rates set amount = case shift when 'am' then 15 else 20 end where role = 'teller';
select case when :'now_shift' = 'am' then 15 else 20 end as now_pay \gset

-- 发放工资
select is(tests.err(:'acct', format($$select pay_salaries(%L)$$, :'d')), 'FORBIDDEN', 'only the bank admin pays');
select is(tests.err(:'teacher', format($$select pay_salaries(%L::date + 7)$$, :'monday')), 'INVALID_INPUT', 'not a week to come');
select tests.call(:'teacher', format($$select pay_salaries(%L::date - 7)$$, :'monday')) as last_week \gset
select is(:'last_week'::jsonb -> 'paid' -> 0 -> 'amount', '20', 'last week''s payout pays only last week''s shift, a 下午班');
select is((select reason from txns where type = 'salary'), format('%s月%s日，下午班 1 个', extract(month from :'monday'::date - 7), extract(day from :'monday'::date - 7)),
  'the salary says which days and shifts it pays');
select tests.call(:'teacher', format($$select pay_salaries(%L)$$, :'d')) as week \gset
select is(row(:'week'::jsonb -> 'paid' -> 0 ->> 'name', :'week'::jsonb -> 'paid' -> 0 -> 'shifts', :'week'::jsonb -> 'paid' -> 0 -> 'amount')::text,
  row('t1', '1'::jsonb, to_jsonb(:now_pay))::text, 'this week''s confirmed shift of t1, at the pay of its kind');
select is(:'week'::jsonb -> 'skipped', jsonb_build_array(jsonb_build_object('user_id', :'t2', 'name', 't2', 'shifts', 1, 'reason', 'disabled')),
  'a stopped teller is not paid');
select is((select balance from accounts where student_no = 's1'), 40 + :now_pay, 'the pay goes into the bound account (10 + 10 deposited + 20 + this week''s)');
select is((select count(*)::int from txns where type = 'salary' and student_no = 's1' and balance_delta = amount and cash_delta = 0), 2,
  'as salary transactions that bring no cash');
select is(tests.call(:'teacher', format($$select pay_salaries(%L)$$, :'d')) -> 'paid', '[]', 'paying again pays nothing twice');
select is(tests.err(:'teacher', format($$select reverse_txn(gen_random_uuid(), (select id from txns where type = 'salary' limit 1), '业务选错')$$)),
  'REVERSAL_NOT_ALLOWED', 'a salary is not reversed');
select is(tests.call(:'t1', $$select jsonb_agg(pay order by day) from attendance where salary_txn is not null$$), jsonb_build_array(20, :now_pay),
  'the teller sees what each shift paid');
select is((select count(*)::int from app_private.check_balances()), 0, 'the ledger self-check still holds');
select is((select count(*)::int from audit_log where action = 'salary.pay'), 2, 'each payout is logged once');

-- 报表 counts the pay as a change to the balance, not as a business
select tests.call(:'acct', format($$select bank_report(%L, %L)$$, :'d', :'d')) as r \gset
select is(:'r'::jsonb -> 'balance' -> 'changes' -> 'salary', to_jsonb(20 + :now_pay), 'the balance check has the salaries');
select is(:'r'::jsonb -> 'business' -> 'deposit', '{"count": 2, "amount": 20}', 'and the businesses do not');

select * from finish();
rollback;
