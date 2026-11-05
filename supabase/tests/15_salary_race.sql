-- The bank admin presses 发放工资 on two devices at the same moment: the week is paid once (PHASE-1.md §6.9).
-- The two payments run in their own sessions (dblink), so this file commits its fixtures and removes them at the end.
\ir helpers/setup.psql
create extension dblink with schema tests;

select coalesce(max(id), 0) as mark from audit_log \gset
select dblink_connect('setup', 'dbname=postgres user=postgres');
select dblink_exec('setup', $$
  do $do$
  declare
    v_admin uuid := app_private.create_login('pay-admin@staff.dolphin.internal', 'test-password');
    v_teller uuid := app_private.create_login('pay-teller@staff.dolphin.internal', 'test-password');
    v_day date := app_private.cn_date(now()) - 7;
  begin
    insert into profiles (id, login_kind, login_id, display_name, must_change_password)
    values (v_admin, 'staff', 'pay-admin', 'pay-admin', false), (v_teller, 'staff', 'pay-teller', 'pay-teller', false);
    insert into user_roles values (v_admin, 'teacher'), (v_teller, 'teller');
    insert into students (student_no, name, division, cohort, class_no) values ('pay-1', 'pay-1', 'primary', app_private.grade_of('primary', 0) - 4, 1);
    insert into accounts (student_no, balance) values ('pay-1', 0);
    insert into staff_payroll (user_id, attendance, account) values (v_teller, true, 'pay-1');
    insert into attendance (user_id, day, shift, status, signed_by, reviewed_by, reviewed_at)
    values (v_teller, v_day, 'am', 'confirmed', v_teller, v_admin, now()), (v_teller, v_day, 'pm', 'confirmed', v_teller, v_admin, now());
  end
  $do$
$$);

select id as admin from profiles where login_id = 'pay-admin' \gset
select (app_private.cn_date(now()) - 7) as week \gset
select dblink_connect(c, 'dbname=postgres user=postgres') from unnest(array['lock', 'a', 'b']) c;
select dblink_exec(c, format('set request.jwt.claims = %L', json_build_object('sub', :'admin', 'role', 'authenticated'))),
       dblink_exec(c, 'set role authenticated')
from unnest(array['a', 'b']) c;

-- Hold the week's shifts so both payments queue behind them, then release them together.
select dblink_exec('lock', 'begin');
select count(*) from dblink('lock', $$select id from attendance where salary_txn is null for update$$) as t(id uuid);
select dblink_send_query(c, format('select public.pay_salaries(%L)', :'week')) from unnest(array['a', 'b']) c;
select pg_sleep(0.3);
select dblink_exec('lock', 'commit');

create temp table race (conn text, result jsonb, error text);
insert into race select 'a', (select r from dblink_get_result('a', false) as t(r jsonb)), dblink_error_message('a');
insert into race select 'b', (select r from dblink_get_result('b', false) as t(r jsonb)), dblink_error_message('b');

select is((select count(*)::int from race where result is not null), 2, 'both presses answer');
select is((select count(*)::int from race where jsonb_array_length(result -> 'paid') = 1), 1, 'one of them pays the teller');
select is((select count(*)::int from txns where student_no = 'pay-1' and type = 'salary'), 1, 'one salary transaction');
select is((select balance from accounts where student_no = 'pay-1'),
  (select ((value ->> 'am')::int + (value ->> 'pm')::int) from settings where key = 'salary_per_shift'), 'the week is paid once');
select is((select count(*)::int from app_private.check_balances()), 0, 'balances match the ledger');

select dblink_disconnect(c) from unnest(array['lock', 'a', 'b']) c;
select dblink_exec('setup', format($$
  set session_replication_role = replica;
  delete from attendance where user_id in (select id from profiles where login_id in ('pay-admin', 'pay-teller'));
  delete from staff_payroll where account = 'pay-1';
  delete from txns where student_no = 'pay-1';
  delete from accounts where student_no = 'pay-1';
  delete from students where student_no = 'pay-1';
  delete from audit_log where id > %s;
  delete from user_roles where user_id in (select id from profiles where login_id in ('pay-admin', 'pay-teller'));
  delete from profiles where login_id in ('pay-admin', 'pay-teller');
  delete from auth.users where email in ('pay-admin@staff.dolphin.internal', 'pay-teller@staff.dolphin.internal');
$$, :'mark'));
select dblink_disconnect('setup');

select * from finish();
rollback;
