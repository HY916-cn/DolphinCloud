-- 考勤签到合并与行长权限 (PHASE-1.md §4.2, §6.9; PHASE-2.md §3).
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('acct', 'accountant') as acct \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('p1', 'president') as p1 \gset
select tests.staff('p2', 'president') as p2 \gset
select tests.staff('p3', 'president') as p3 \gset
select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.student('s1', 0) as s1 \gset
select tests.student('s2', 0) as s2 \gset
select tests.student('s3', 0) as s3 \gset
select tests.student('s4', 0) as s4 \gset
select tests.student('s5', 0) as s5 \gset
select tests.student('s6', 0) as s6 \gset
select tests.student('s7', 0) as s7 \gset
select app_private.cn_date(now()) as d \gset
select app_private.cn_date(now()) - 1 as y \gset

-- 参与考勤: the teller, accountant, storekeeper and president only
select is((select array_agg(distinct role::text order by role::text) from salary_rates), '{accountant,president,storekeeper,teller}',
  '工资标准 for the four counted identities');
select throws_ok($$insert into salary_rates (role, shift, amount) values ('teacher', 'am', 1)$$, '23514', null, 'and no other');
select is((select count(*)::int from staff_payroll s join user_roles r using (user_id) where r.role in ('teacher', 'sysadmin')
  and (s.attendance or s.account is not null)), 0, 'no bank admin or sysadmin is bound or counted');
select is(tests.err(:'teacher', $$select bind_salary_account(auth.uid(), 's7', '123456')$$), 'INVALID_INPUT', 'the bank admin binds no 工资账户');
select is(tests.err(:'ops', $$select bind_salary_account(auth.uid(), 's7', '123456')$$), 'INVALID_INPUT', 'nor does the sysadmin');
select is(tests.err(:'ops', format($$select bind_salary_account(%L, 's7', null)$$, :'teacher')), 'INVALID_INPUT', 'nor is one bound for them');
select is(tests.err(:'teacher', format($$select set_attendance(%L, true)$$, :'teacher')), 'INVALID_INPUT', 'the bank admin is not counted');
select is(tests.err(:'teacher', format($$select set_attendance(%L, true)$$, :'ops')), 'INVALID_INPUT', 'nor the sysadmin');
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'teacher', :'y')), 'INVALID_INPUT',
  'and has no shift to sign');
select is(count(*), 0::bigint, 'the four are bound by the bank admin')
from (values (:'t1'::uuid, 's1'), (:'acct'::uuid, 's2'), (:'keeper'::uuid, 's3'), (:'p1'::uuid, 's4'), (:'p2'::uuid, 's5')) b(id, no)
where tests.err(:'teacher', format($$select bind_salary_account(%L, %L, null)$$, b.id, b.no)) is not null;
select is(count(*), 0::bigint, 'and counted')
from unnest(array[:'t1', :'acct', :'keeper', :'p1']::uuid[]) id
where tests.err(:'teacher', format($$select set_attendance(%L, true)$$, id)) is not null;

-- 签到: the accountant, storekeeper and president, their own shift of now, waiting for review
select is(tests.err(:'t1', $$select sign_in_attendance()$$), 'FORBIDDEN', 'a teller signs in by 上班');
select is(tests.err(:'teacher', $$select sign_in_attendance()$$), 'FORBIDDEN', 'the bank admin does not sign in');
select is(tests.err(:'ops', $$select sign_in_attendance()$$), 'FORBIDDEN', 'nor the sysadmin');
select is(tests.err(:'p3', $$select sign_in_attendance()$$), 'SALARY_UNBOUND', 'a 工资账户 first');
select is(tests.err(:'p2', $$select sign_in_attendance()$$), 'ATTENDANCE_OFF', 'and counted');
select tests.call(:'acct', $$select sign_in_attendance()$$) as acct_in \gset
select is(row(:'acct_in'::jsonb ->> 'status', :'acct_in'::jsonb ->> 'role', :'acct_in'::jsonb ->> 'signed_by',
    :'acct_in'::jsonb ->> 'day', :'acct_in'::jsonb ->> 'shift')::text,
  row('pending', 'accountant', :'acct', :'d', app_private.shift_of(now()))::text,
  'the accountant signs in to the shift of now, waiting, under their identity');
select is(app_private.shift_of('2026-11-17 13:29:59+08'), 'am', 'before 13:30 is 中午班');
select is(app_private.shift_of('2026-11-17 13:30:00+08'), 'pm', 'from 13:30 下午班, as at 上班');
select is(tests.err(:'acct', $$select sign_in_attendance()$$), 'ALREADY_EXISTS', 'once per shift');
select is(tests.call(:'p1', $$select sign_in_attendance()$$) ->> 'role', 'president', 'a president signs in');
select tests.call(:'keeper', $$select sign_in_attendance()$$) ->> 'id' as keeper_in \gset
select is(tests.call(:'teacher', format($$select review_attendance(array[%L]::uuid[], 'rejected')$$, :'keeper_in')) ->> 'count', '1',
  'the bank admin rejects one');
select is(tests.err(:'keeper', $$select sign_in_attendance()$$), 'ALREADY_EXISTS', 'which still takes its shift');
update profiles set disabled = true where id = :'p2';
update staff_payroll set attendance = true where user_id = :'p2';
select is(tests.err(:'p2', $$select sign_in_attendance()$$), 'FORBIDDEN', 'a stopped login does not sign in');
update profiles set disabled = false where id = :'p2';
update staff_payroll set attendance = false where user_id = :'p2';

-- 补签: the president or the bank admin signs a cell of the table, confirmed at once; not their own, a president's only
-- by the bank admin
select tests.call(:'p1', format($$select makeup_attendance(%L, %L, 'am', '忘了上班')$$, :'t1', :'y')) as t1_y \gset
select is(row(:'t1_y'::jsonb ->> 'status', :'t1_y'::jsonb ->> 'role', :'t1_y'::jsonb ->> 'signed_by')::text,
  row('confirmed', 'teller', :'p1')::text, 'a president signs a teller''s shift, confirmed at once');
select is(tests.call(:'p1', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'keeper', :'y')) ->> 'role', 'storekeeper',
  'and a storekeeper''s');
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'pm', '值班')$$, :'p1', :'y')), 'SELF_SERVICE_FORBIDDEN', 'not their own');
select is(tests.err(:'p2', format($$select makeup_attendance(%L, %L, 'pm', '值班')$$, :'p1', :'y')), 'SELF_SERVICE_FORBIDDEN',
  'nor another president''s');
select tests.call(:'teacher', format($$select makeup_attendance(%L, %L, 'pm', '值班')$$, :'p1', :'y')) ->> 'id' as p1_y \gset
select is((select row(role, status, signed_by)::text from attendance where id = :'p1_y'), row('president', 'confirmed', :'teacher')::text,
  'the bank admin signs a president''s');
select is(tests.err(:'acct', format($$select makeup_attendance(%L, %L, 'pm', '值班')$$, :'keeper', :'y')), 'FORBIDDEN',
  'only the president and the bank admin sign for others');
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'acct', :'d' :: date + 1)), 'INVALID_INPUT',
  'a shift not yet begun is not signed');
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'pm', ' ')$$, :'acct', :'y')), 'INVALID_INPUT', 'with a note');
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'t1', :'y')), 'ALREADY_EXISTS', 'once per shift');

-- 审查 and 发放: the bank admin alone
select is(tests.err(:'p1', format($$select review_attendance(array[%L]::uuid[], 'confirmed')$$, :'acct_in'::jsonb ->> 'id')), 'FORBIDDEN',
  'a president does not review');
select is(tests.err(:'p1', format($$select pay_salaries(%L)$$, :'d')), 'FORBIDDEN', 'nor pay');
select is(tests.call(:'teacher', $$select review_attendance(array(select id from attendance where status = 'pending'), 'confirmed')$$) ->> 'count',
  '2', 'the bank admin confirms every waiting shift at once');

-- 作废: a confirmed shift not yet paid, by whoever may sign it
select is(tests.err(:'acct', format($$select void_attendance(%L, '登记错了')$$, :'t1_y'::jsonb ->> 'id')), 'FORBIDDEN',
  'only the president and the bank admin void');
select is(tests.err(:'p1', format($$select void_attendance(%L, '签错了')$$, (select id from attendance where user_id = :'p1' and day = :'d'))),
  'SELF_SERVICE_FORBIDDEN', 'not their own');
select is(tests.err(:'p2', format($$select void_attendance(%L, '签错了')$$, :'p1_y')), 'SELF_SERVICE_FORBIDDEN', 'nor another president''s');
select is(tests.call(:'p1', format($$select void_attendance(%L, '签错了')$$, :'t1_y'::jsonb ->> 'id')) ->> 'status', 'rejected',
  'a president voids a teller''s');
select is(tests.call(:'teacher', format($$select void_attendance(%L, '签错了')$$, :'p1_y')) ->> 'status', 'rejected',
  'the bank admin a president''s');
select tests.call(:'t1', $$select start_duty()$$);
select is(tests.err(:'p1', format($$select void_attendance(%L, '签错了')$$, (select id from attendance where user_id = :'t1' and day = :'d'))),
  'INVALID_INPUT', 'a waiting shift is reviewed, not voided');
select tests.call(:'teacher', $$select review_attendance(array(select id from attendance where status = 'pending'), 'confirmed')$$);
select is(jsonb_array_length(tests.call(:'teacher', format($$select pay_salaries(%L)$$, :'d')) -> 'paid'), 4, 'the bank admin pays the four');

-- 行长: no longer managing students, staff or settings, nor reading the audit log
create temp table revoked (fn text, stmt text);
insert into revoked values
  ('set_settings', $$select set_settings('{"ranking_anonymous": true}')$$),
  ('set_setting', $$select set_setting('ranking_anonymous', 'true')$$),
  ('set_salary_rates', $$select set_salary_rates((select jsonb_object_agg(role, r) from (select role, jsonb_object_agg(shift, amount) r from salary_rates group by role) x))$$),
  ('set_attendance', format($$select set_attendance(%L, false)$$, :'acct')),
  ('review_attendance', $$select review_attendance(array[gen_random_uuid()], 'confirmed')$$),
  ('pay_salaries', format($$select pay_salaries(%L)$$, :'d')),
  ('set_student_status', $$select set_student_status('s6', 'frozen')$$),
  ('import_roster', $$select import_roster('[]')$$),
  ('reissue_passwords', $$select reissue_passwords(array['s6'])$$),
  ('reset_password', format($$select reset_password(%L)$$, :'s6')),
  ('close_accounts', format($$select close_accounts(array[%L]::uuid[])$$, :'s6')),
  ('create_staff', $$select create_staff('t9', '柜员九', 'teller')$$),
  ('import_staff', $$select import_staff('[]')$$),
  ('set_role', format($$select set_role(%L, 'accountant')$$, :'t1')),
  ('set_user_disabled', format($$select set_user_disabled(%L, true)$$, :'t1')),
  ('bind_salary_account', format($$select bind_salary_account(%L, 's6', null)$$, :'p3')),
  ('unbind_salary_account', format($$select unbind_salary_account(%L)$$, :'acct'));
grant select on revoked to authenticated;
select is(tests.err(:'p1', stmt), 'FORBIDDEN', format('a president: %s', fn)) from revoked order by fn;
select is(tests.call(:'p1', $$select count(*) from audit_log$$), '0', 'a president reads no 日志');
select is((tests.call(:'teacher', $$select count(*) from audit_log$$))::int > 0, true, 'the bank admin does');
select is((tests.call(:'ops', $$select count(*) from audit_log$$))::int > 0, true, 'and the sysadmin');
select is((tests.call(:'p1', $$select count(*) from students$$))::int, 7, 'a president still reads the students');
select is((tests.call(:'p1', $$select count(*) from profiles where login_kind = 'staff'$$))::int,
  (select count(*)::int from profiles where login_kind = 'staff'), 'and the staff');
select is(tests.err(:'p1', $$select record_wealth_day(current_date, 0, '')$$) is distinct from 'FORBIDDEN', true, 'and keeps 手动登记指数');
select is(tests.err(:'p1', $$select force_end_duty(gen_random_uuid(), '下班了')$$) is distinct from 'FORBIDDEN', true, 'and 强制下班');

select * from finish();
rollback;
