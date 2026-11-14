-- 全员考勤与工资 (PHASE-1.md §6.9, PHASE-2.md §3, §5).
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('acct', 'accountant') as acct \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('p1', 'president') as p1 \gset
select tests.staff('p2', 'president') as p2 \gset
select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.student('s1', 0, '张小明') as s1 \gset
select tests.student('s2', 0, '李四') as s2 \gset
select tests.student('s3', 0, '王五') as s3 \gset
select tests.student('s4', 0, '赵六') as s4 \gset
select tests.student('s5', 0, '钱七') as s5 \gset
select tests.student('s6', 0, '孙八') as s6 \gset
select app_private.cn_date(now()) as d \gset
select app_private.cn_date(now()) - 1 as y \gset

-- 迁移: every counted identity has both shifts at the pay salary_per_shift had
select is((select count(*)::int from salary_rates), 10, 'five identities × two shifts');
select is((select count(*)::int from salary_rates where amount = 10), 10, 'each at the pay salary_per_shift had');
select is((select count(*)::int from salary_rates where role = 'sysadmin'), 0, 'the sysadmin has no pay');
select is((select count(*)::int from settings where key = 'salary_per_shift'), 0, 'salary_per_shift is gone: the pay is salary_rates');
select is(tests.call(:'teacher', $$select set_setting('salary_per_shift', '{"am":10,"pm":10}')$$) - 'detail',
  '{"error":"INVALID_INPUT"}', 'and set_setting takes it as an unknown key');
select is(tests.call(:'teacher', $$select set_setting('salary_per_shift', '{"am":10,"pm":10}')$$) ->> 'detail', '{"field": "key"}', 'field key');

-- 绑定工资账户: anyone counted their own, with the password
select is(tests.call(:'acct', $$select bind_salary_account(auth.uid(), 's1', 'wrong')$$) ->> 'error', 'WRONG_PASSWORD', 'the accountant gives the password');
select is(tests.call(:'acct', $$select bind_salary_account(auth.uid(), 's1', '123456')$$) ->> 'account', 's1', 'and binds their own');
select is(tests.call(:'keeper', $$select bind_salary_account(auth.uid(), 's2', '123456')$$) ->> 'name', '李四', 'the storekeeper too');
select is(tests.call(:'p1', $$select bind_salary_account(auth.uid(), 's3', '123456')$$) ->> 'account', 's3', 'and a president');
select is(tests.call(:'teacher', $$select bind_salary_account(auth.uid(), 's4', null)$$) ->> 'error', 'WRONG_PASSWORD',
  'the bank admin binding their own gives the password');
select is(tests.call(:'teacher', $$select bind_salary_account(auth.uid(), 's4', '123456')$$) ->> 'account', 's4', 'and binds with it');
select is(tests.err(:'ops', $$select bind_salary_account(auth.uid(), 's5', '123456')$$), 'INVALID_INPUT', 'the sysadmin has no 工资账户');
select is(tests.err(:'teacher', format($$select bind_salary_account(%L, 's5', null)$$, :'ops')), 'INVALID_INPUT', 'not even from the bank admin');
select is(tests.err(:'p1', format($$select bind_salary_account(%L, 's5', null)$$, :'p2')), 'FORBIDDEN', 'a president binds only their own');
select is(tests.err(:'acct', format($$select bind_salary_account(%L, 's5', '123456')$$, :'keeper')), 'FORBIDDEN', 'as does everyone else');
select is(tests.call(:'ops', format($$select bind_salary_account(%L, 's5', null)$$, :'p2')) ->> 'account', 's5',
  'the sysadmin binds for a president without the password');
select is(tests.call(:'p2', $$select unbind_salary_account(auth.uid())$$) ->> 'account', null, 'a president unbinds their own');
select is(tests.err(:'p1', format($$select unbind_salary_account(%L)$$, :'acct')), 'FORBIDDEN', 'not anyone else''s');
select is(tests.call(:'teacher', format($$select bind_salary_account(%L, 's6', null)$$, :'t1')) ->> 'account', 's6', 'the teller is bound as before');

-- 参与考勤
select is(tests.err(:'teacher', format($$select set_attendance(%L, true)$$, :'p2')), 'SALARY_UNBOUND', 'counted only with a bound account');
select is(tests.err(:'teacher', format($$select set_attendance(%L, true)$$, :'ops')), 'INVALID_INPUT', 'the sysadmin is never counted');
select is(count(*), 0::bigint, 'every bound identity is counted') from unnest(array[:'t1', :'acct', :'keeper', :'p1', :'teacher']::uuid[]) id
  where tests.err(:'p1', format($$select set_attendance(%L, true)$$, id)) is not null;
select is(tests.err(:'acct', $$select unbind_salary_account(auth.uid())$$), 'ATTENDANCE_ON', 'and keeps the account while counted');

-- 登记: the president or the bank admin, with a note, confirmed at once
select tests.call(:'p1', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'acct', :'y')) as reg \gset
select is(row(:'reg'::jsonb ->> 'status', :'reg'::jsonb ->> 'role', :'reg'::jsonb ->> 'signed_by')::text,
  row('confirmed', 'accountant', :'p1')::text, 'a registered shift counts at once, under the identity of then');
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'am', '再登记')$$, :'acct', :'y')), 'ALREADY_EXISTS', 'once per shift');
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'pm', ' ')$$, :'acct', :'y')), 'INVALID_INPUT', 'with a note');
select is(tests.err(:'acct', format($$select makeup_attendance(%L, %L, 'pm', '值班')$$, :'keeper', :'y')), 'FORBIDDEN',
  'only the president and the bank admin register');
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'p1', :'y')), 'SELF_SERVICE_FORBIDDEN', 'not their own');
select is(tests.err(:'p2', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'p1', :'y')), 'SELF_SERVICE_FORBIDDEN',
  'a president''s shifts are the bank admin''s to register');
select is(tests.err(:'teacher', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'teacher', :'y')), 'SELF_SERVICE_FORBIDDEN',
  'and the bank admin''s a president''s');
select is(tests.call(:'teacher', format($$select makeup_attendance(%L, %L, 'pm', '值班')$$, :'p1', :'y')) ->> 'role', 'president', 'the bank admin registers a president');
select is(tests.call(:'p1', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'teacher', :'y')) ->> 'role', 'teacher', 'a president the bank admin');
select tests.call(:'teacher', format($$select makeup_attendance(%L, %L, 'pm', '值班')$$, :'keeper', :'y'));
select tests.call(:'teacher', format($$select makeup_attendance(%L, %L, 'pm', '值班')$$, :'acct', :'y'));

-- 作废: a registered shift, with a reason, by whoever may register it
select tests.call(:'p1', format($$select makeup_attendance(%L, %L, 'am', '登记错了')$$, :'keeper', :'y')) ->> 'id' as wrong \gset
select id as p1_shift from attendance where user_id = :'p1' \gset
select is(tests.err(:'acct', format($$select void_attendance(%L, '登记错了')$$, :'wrong')), 'FORBIDDEN', 'only the president and the bank admin void');
select is(tests.err(:'p1', format($$select void_attendance(%L, ' ')$$, :'wrong')), 'INVALID_INPUT', 'with a reason');
select is(tests.err(:'p2', format($$select void_attendance(%L, '登记错了')$$, :'p1_shift')), 'SELF_SERVICE_FORBIDDEN',
  'a president''s shift is the bank admin''s to void');
select is(tests.call(:'p1', format($$select void_attendance(%L, '登记错了')$$, :'wrong')) ->> 'status', 'rejected', 'a voided shift is rejected');
select is((select note from attendance where id = :'wrong'), '登记错了', 'with its reason');
select is(tests.err(:'p1', format($$select void_attendance(%L, '再作废')$$, :'wrong')), 'ATTENDANCE_REVIEWED', 'once');
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'am', '再登记')$$, :'keeper', :'y')), 'ALREADY_EXISTS', 'and its shift stays taken');

-- A teller's shift still comes from 上班, waiting for review
select tests.call(:'t1', $$select start_duty()$$);
select is((select row(role, status)::text from attendance where user_id = :'t1'), row('teller', 'pending')::text, '上班 signs a teller''s shift to review');
select is(tests.err(:'teacher', format($$select pay_salaries(%L)$$, :'d')), 'ATTENDANCE_PENDING', 'and pay waits for it');
select is(tests.err(:'teacher', format($$select void_attendance((select id from attendance where user_id = %L), '作废')$$, :'t1')), 'INVALID_INPUT',
  'a teller''s shift is reviewed, not voided');
select tests.call(:'teacher', format($$select review_attendance(array[(select id from attendance where user_id = %L)], 'confirmed')$$, :'t1'));

-- 读取: their own shifts, or all for the president and the bank admin
select is(tests.call(:'acct', $$select count(*) from attendance$$), '2', 'the accountant reads their own shifts');
select is(tests.call(:'p2', $$select count(*) from attendance$$), '7', 'a president reads them all');
select is(tests.call(:'keeper', $$select count(*) from salary_rates$$), '10', 'everyone reads the 工资标准');

-- 工资标准
create temp table rates as select '{"teller": {"am": 11, "pm": 12}, "accountant": {"am": 21, "pm": 22}, "storekeeper": {"am": 31, "pm": 32},
  "president": {"am": 41, "pm": 42}, "teacher": {"am": 51, "pm": 52}}'::jsonb as v;
grant select on rates to authenticated;
select is(tests.err(:'acct', $$select set_salary_rates((select v from rates))$$), 'FORBIDDEN', 'only the president and the bank admin set the pay');
select is(tests.err(:'teacher', $$select set_salary_rates((select v - 'teacher' from rates))$$), 'INVALID_INPUT', 'every identity has its pay');
select is(tests.err(:'teacher', $$select set_salary_rates((select v || '{"sysadmin": {"am": 1, "pm": 1}}' from rates))$$), 'INVALID_INPUT', 'but the sysadmin');
select is(tests.err(:'teacher', $$select set_salary_rates((select jsonb_set(v, '{teller,am}', '0') from rates))$$), 'INVALID_INPUT', 'a shift pays at least 1');
select is(tests.err(:'teacher', $$select set_salary_rates((select jsonb_set(v, '{teller}', '{"am": 11}') from rates))$$), 'INVALID_INPUT',
  'each shift has its pay');
select is(tests.call(:'p1', $$select set_salary_rates((select v from rates))$$), (select v from rates), 'a president sets the pay, answered as set');
select is((select count(*)::int from audit_log where action = 'salary_rates.update'), 10, 'each change is logged');
select is(tests.call(:'teacher', $$select set_salary_rates((select v from rates))$$), (select v from rates), 'setting it again changes nothing');
select is((select count(*)::int from audit_log where action = 'salary_rates.update'), 10, 'and logs nothing');

-- 发放: each shift at the pay of the identity it was signed under, whatever the identity is now
update user_roles set role = 'storekeeper' where user_id = :'acct';
select tests.call(:'teacher', format($$select pay_salaries(%L)$$, :'d')) as paid \gset
select is((select jsonb_object_agg(p ->> 'name', p -> 'amount') from jsonb_array_elements(:'paid'::jsonb -> 'paid') p),
  jsonb_build_object('acct', 21 + 22, 'keeper', 32, 'p1', 42, 'teacher', 51, 't1', case when app_private.shift_of(now()) = 'am' then 11 else 12 end),
  'everyone is paid at their own rate');
select is(:'paid'::jsonb -> 'rates', (select v from rates), 'with the 工资标准 it read');
select is((select jsonb_agg(pay order by shift) from attendance where user_id = :'acct'), '[21, 22]', 'each shift keeps what it paid');
select is((select balance from accounts where student_no = 's1'), 43, 'into the bound account');
select is((select balance from accounts where student_no = 's4'), 51, 'the bank admin''s too, paid by themself');
select is((select pay from attendance where id = :'wrong'), null, 'a voided shift pays nothing');
select is(tests.err(:'teacher', format($$select void_attendance(%L, '作废')$$, :'p1_shift')), 'ATTENDANCE_PAID', 'nor is a paid shift voided');
select is((select count(*)::int from app_private.check_balances()), 0, 'the ledger self-check still holds');

-- 导入工作人员: a 工资账户 for any identity but the sysadmin
update staff_payroll set attendance = false, account = null where user_id = :'keeper';
select is(tests.call(:'teacher', $$select import_staff('[{"login_id": "acct9", "name": "财务九", "role": "accountant", "account": "s2"}]')$$) -> 'bound',
  '1', 'an imported accountant is bound');
select is(tests.err(:'teacher', $$select import_staff('[{"login_id": "ops9", "name": "运维九", "role": "sysadmin", "account": "s5"}]')$$),
  'INVALID_INPUT', 'an imported sysadmin is not');

select * from finish();
rollback;
