-- 注销 against counter business at the same moment (PHASE-1.md §6.8, PHASE-2.md §10.10): close_accounts takes the account
-- before it looks at the 理财, so a 买入 that got it first is sold with the rest; a 存款 waiting behind a 注销 finds the
-- student closed. The calls run in their own sessions (dblink), so this file commits its fixtures and removes them at the end.
\ir helpers/setup.psql
create extension dblink with schema tests;

select dblink_connect('setup', 'dbname=postgres user=postgres');
select dblink_exec('setup', $$
  do $do$
  declare
    v_teller uuid := app_private.create_login('close-teller@staff.dolphin.internal', 'test-password');
    v_teacher uuid := app_private.create_login('close-teacher@staff.dolphin.internal', 'test-password');
    v_user uuid;
    v_no text;
  begin
    insert into profiles (id, login_kind, login_id, display_name, must_change_password)
    values (v_teller, 'staff', 'close-teller', 'close-teller', false), (v_teacher, 'staff', 'close-teacher', 'close-teacher', false);
    insert into user_roles values (v_teller, 'teller'), (v_teacher, 'teacher');
    insert into duty (user_id) values (v_teller);
    foreach v_no in array array['close-w', 'close-d'] loop
      v_user := app_private.create_login(v_no || '@student.dolphin.internal', '123456');
      insert into profiles (id, login_kind, login_id, display_name, must_change_password) values (v_user, 'student', v_no, v_no, false);
      insert into students (student_no, user_id, name, division, cohort, class_no)
      values (v_no, v_user, v_no, 'primary', app_private.grade_of('primary', 0) - 4, 1);
      insert into accounts (student_no, balance, total_in) values (v_no, 100, 100);
      insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id)
      values (gen_random_uuid(), 'opening', v_no, 100, 100, 100, v_teller);
    end loop;
  end
  $do$
$$);

select id as teller from profiles where login_id = 'close-teller' \gset
select id as teacher from profiles where login_id = 'close-teacher' \gset
select user_id as w from students where student_no = 'close-w' \gset
select user_id as d from students where student_no = 'close-d' \gset
select dblink_connect(c, 'dbname=postgres user=postgres') from unnest(array['lock', 'a', 'b']) c;
select dblink_exec(c, format('set request.jwt.claims = %L', json_build_object('sub', u, 'role', 'authenticated'))), dblink_exec(c, 'set role authenticated')
from (values ('a', :'teller'), ('b', :'teacher')) v(c, u);
create temp table race (round text, conn text, result jsonb, error text);

-- 1. The account held; the teller's 买入 queues first, the 注销 behind it; then both go.
select dblink_exec('lock', 'begin');
select * from dblink('lock', $$select balance from accounts where student_no = 'close-w' for update$$) as t(balance int);
select dblink_send_query('a', $$select public.buy_wealth('00000000-0000-4000-8000-0000000000e1', 'close-w', 'csi300', 100)$$);
select pg_sleep(0.3);
select dblink_send_query('b', format('select public.close_accounts(array[%L]::uuid[])', :'w'));
select pg_sleep(0.3);
select dblink_exec('lock', 'commit');
insert into race select 'buy', c, (select r from dblink_get_result(c, false) as t(r jsonb)), dblink_error_message(c) from unnest(array['a', 'b']) c;
select count(*) from unnest(array['a', 'b']) c, lateral dblink_get_result(c, false) as t(r jsonb);  -- each connection ready again
select is((select count(*)::int from race where round = 'buy' and result is not null), 2, 'the 买入 and then the 注销 both go through');
select is((select status from wealth_holdings where id = '00000000-0000-4000-8000-0000000000e1'), 'redeemed', 'the 理财 bought first is sold by the 注销');
select is((select concat_ws(' ', a.balance, a.wealth_total, s.status) from accounts a join students s using (student_no) where student_no = 'close-w'),
  '0 0 closed', 'and the account closes with nothing in it');
select is((select amount from txns where student_no = 'close-w' and type = 'closing'), 100, 'what it held paid out by the 注销');

-- 2. The 注销 queues first, a 存款 behind it.
select dblink_exec('lock', 'begin');
select * from dblink('lock', $$select balance from accounts where student_no = 'close-d' for update$$) as t(balance int);
select dblink_send_query('b', format('select public.close_accounts(array[%L]::uuid[])', :'d'));
select pg_sleep(0.3);
select dblink_send_query('a', $$select public.deposit(gen_random_uuid(), 'close-d', '{"10":1}')$$);
select pg_sleep(0.3);
select dblink_exec('lock', 'commit');
insert into race select 'deposit', c, (select r from dblink_get_result(c, false) as t(r jsonb)), dblink_error_message(c) from unnest(array['b', 'a']) c;
select ok((select error like '%STUDENT_INACTIVE%' from race where round = 'deposit' and conn = 'a'), 'the 存款 behind the 注销 finds the student closed');
select is((select concat_ws(' ', a.balance, s.status) from accounts a join students s using (student_no) where student_no = 'close-d'), '0 closed',
  'nothing lands in the closed account');
select is((select count(*)::int from app_private.check_balances()), 0, 'balances match the ledger');

select dblink_disconnect(c) from unnest(array['lock', 'a', 'b']) c;
select dblink_exec('setup', format($$
  set session_replication_role = replica;
  delete from wealth_holdings where student_no in ('close-w', 'close-d');
  delete from risk_alerts where student_no in ('close-w', 'close-d') or staff_id in (%1$L, %2$L);
  delete from txns where student_no in ('close-w', 'close-d');
  delete from credit_events where student_no in ('close-w', 'close-d');
  delete from credit_scores where student_no in ('close-w', 'close-d');
  delete from accounts where student_no in ('close-w', 'close-d');
  delete from students where student_no in ('close-w', 'close-d');
  delete from staff_payroll where user_id in (%1$L, %2$L, %3$L, %4$L);
  delete from duty where user_id = %1$L;
  delete from user_roles where user_id in (%1$L, %2$L);
  delete from profiles where id in (%1$L, %2$L, %3$L, %4$L);
  delete from auth.users where id in (%1$L, %2$L, %3$L, %4$L);
  delete from audit_log where at >= %5$L;
$$, :'teller', :'teacher', :'w', :'d', now()));
select dblink_disconnect('setup');

select * from finish();
rollback;
