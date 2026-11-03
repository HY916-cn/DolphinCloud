-- 行长 (president): many logins, the bank admin's rights but managing logins (PHASE-1.md §4.1).
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.staff('t1', 'teller') as t1 \gset
select tests.student('s1', 30, '张小明') as s1 \gset
select tests.student('s2', 0, '李四') as s2 \gset

-- Created by the bank admin or the sysadmin, as many as needed.
select is(tests.call(:'teacher', $$select create_staff('p1', '王行长', 'president')$$) ->> 'role', 'president', 'the bank admin creates a president');
select is(tests.call(:'ops', $$select create_staff('p2', '李行长', 'president')$$) ->> 'role', 'president', 'so does the sysadmin, a second one');
select (select id from profiles where login_id = 'p1') as p1 \gset
select (select id from profiles where login_id = 'p2') as p2 \gset
update profiles set must_change_password = false where id in (:'p1', :'p2');
select is(tests.err(:'ops', format($$select reset_password(%L)$$, :'p2')), null, 'the sysadmin manages a president''s login');
update profiles set must_change_password = false where id = :'p2';

-- The bank admin's business.
select is(tests.err(:'p1', $$select bank_report(current_date, current_date)$$), null, '报表');
select is(tests.err(:'p1', $$select set_setting('ranking_anonymous', 'true')$$), null, '参数');
select is(tests.err(:'p1', format($$select set_attendance(%L, false)$$, :'t1')), null, '考勤');
select is(tests.err(:'p1', $$select upsert_product(null, '海豚书签', 2, 1)$$) is distinct from 'FORBIDDEN', true, '商品');
select is((tests.call(:'p1', $$select count(*) from audit_log$$))::int > 0, true, '日志');
select is((tests.call(:'p1', $$select count(*) from accounts$$))::int, 2, 'every balance');
select is((tests.call(:'p1', $$select count(*) from profiles where login_kind = 'staff'$$))::int, 5, 'the staff list, to read');

-- Not managing logins.
select is(tests.err(:'p1', $$select import_roster('[]')$$), 'FORBIDDEN', 'no 导入名册');
select is(tests.err(:'p1', $$select set_student_status('s1', 'frozen')$$), 'FORBIDDEN', 'no 账户状态');
select is(tests.err(:'p1', format($$select reset_password(%L)$$, :'s1')), 'FORBIDDEN', 'no 重置密码');
select is(tests.err(:'p1', $$select reissue_passwords(array['s1'])$$), 'FORBIDDEN', 'no 开户通知单');
select is(tests.err(:'p1', format($$select close_accounts(array[%L]::uuid[])$$, :'s2')), 'FORBIDDEN', 'no 注销');
select is(tests.err(:'p1', $$select create_staff('t9', '柜员九', 'teller')$$), 'FORBIDDEN', 'no 新增账号');
select is(tests.err(:'p1', format($$select set_role(%L, 'accountant')$$, :'t1')), 'FORBIDDEN', 'no 身份');
select is(tests.err(:'p1', format($$select set_user_disabled(%L, true)$$, :'t1')), 'FORBIDDEN', 'no 停用');
select is(tests.err(:'p1', format($$select bind_salary_account(%L, 's1', '123456')$$, :'t1')), 'FORBIDDEN', 'no 工资账户');
select is(tests.err(:'p1', format($$select unbind_salary_account(%L)$$, :'t1')), 'FORBIDDEN', 'nor unbinding one');
select is((select count(*)::int from app_private.login_attempts), 0, 'and no student login is tried');

-- One bank admin still.
select is(tests.err(:'p1', format($$select set_role(%L, 'teacher')$$, :'p1')), 'FORBIDDEN', 'a president does not become the bank admin');
select is(tests.err(:'teacher', format($$select set_role(%L, 'teacher')$$, :'p2')), 'ONE_BANK_ADMIN', 'nobody is made a second one');

select * from finish();
rollback;
