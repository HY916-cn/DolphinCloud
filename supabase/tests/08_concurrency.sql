-- Two counters sell the last item at the same moment: one sale succeeds, the other is told it is sold out (PHASE-1.md §10).
-- The two sales run in their own sessions (dblink), so this file commits its fixtures and removes them at the end.
\ir helpers/setup.psql
create extension dblink with schema tests;

select dblink_connect('setup', 'dbname=postgres user=postgres');
select dblink_exec('setup', $$
  do $do$
  declare
    v_teller uuid := app_private.create_login('race-teller@staff.dolphin.internal', 'test-password');
    v_no text;
  begin
    insert into profiles (id, login_kind, login_id, display_name, must_change_password) values (v_teller, 'staff', 'race-teller', 'race', false);
    insert into user_roles values (v_teller, 'teller');
    foreach v_no in array array['race-1', 'race-2'] loop
      insert into students (student_no, name, division, cohort, class_no) values (v_no, v_no, 'primary', app_private.grade_of('primary', 0) - 4, 1);
      insert into accounts (student_no, balance, total_in) values (v_no, 50, 50);
      insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id)
      values (gen_random_uuid(), 'opening', v_no, 50, 50, 50, v_teller);
    end loop;
    insert into products (id, name, price, listed) values ('00000000-0000-4000-8000-0000000000f1', 'race', 10, true);
    insert into stock_movements (product_id, kind, qty_delta, operator_id) values ('00000000-0000-4000-8000-0000000000f1', 'stock_in', 1, v_teller);
    update products set stock = 1 where id = '00000000-0000-4000-8000-0000000000f1';
  end
  $do$
$$);

select id as teller from profiles where login_id = 'race-teller' \gset
select dblink_connect(c, 'dbname=postgres user=postgres') from unnest(array['lock', 'a', 'b']) c;
select dblink_exec(c, format('set request.jwt.claims = %L', json_build_object('sub', :'teller', 'role', 'authenticated'))),
       dblink_exec(c, 'set role authenticated')
from unnest(array['a', 'b']) c;

-- Hold the product row so both sales queue behind it, then release them together.
select dblink_exec('lock', 'begin');
select * from dblink('lock', $$select stock from products where id = '00000000-0000-4000-8000-0000000000f1' for update$$) as t(stock int);
select dblink_send_query(c, format($$select public.purchase(gen_random_uuid(), %L, '[{"product_id":"00000000-0000-4000-8000-0000000000f1","qty":1}]', 'account')$$, s))
from (values ('a', 'race-1'), ('b', 'race-2')) v(c, s);
select pg_sleep(0.3);
select dblink_exec('lock', 'commit');

create temp table race (conn text, result jsonb, error text);
insert into race select 'a', (select r from dblink_get_result('a', false) as t(r jsonb)), dblink_error_message('a');
insert into race select 'b', (select r from dblink_get_result('b', false) as t(r jsonb)), dblink_error_message('b');

select is((select count(*)::int from race where result is not null), 1, 'exactly one sale succeeds');
select ok((select bool_or(error like '%OUT_OF_STOCK%') from race where result is null), 'the other is told it is sold out');
select is((select stock from products where id = '00000000-0000-4000-8000-0000000000f1'), 0, 'stock is 0, never negative');
select is((select sum(balance)::int from accounts where student_no in ('race-1', 'race-2')), 90, 'only one account was charged');
select is((select count(*)::int from app_private.check_balances()), 0, 'balances and stock match the ledger');

select dblink_disconnect(c) from unnest(array['lock', 'a', 'b']) c;
select dblink_exec('setup', $$
  set session_replication_role = replica;
  delete from stock_movements where product_id = '00000000-0000-4000-8000-0000000000f1';
  delete from txn_items where product_id = '00000000-0000-4000-8000-0000000000f1';
  delete from txns where student_no in ('race-1', 'race-2');
  delete from accounts where student_no in ('race-1', 'race-2');
  delete from students where student_no in ('race-1', 'race-2');
  delete from products where id = '00000000-0000-4000-8000-0000000000f1';
  delete from audit_log where target in ('students:race-1', 'students:race-2', 'products:00000000-0000-4000-8000-0000000000f1')
     or target in (select t || id from profiles, unnest(array['profiles:', 'user_roles:']) t where login_id = 'race-teller');
  delete from user_roles where user_id = (select id from profiles where login_id = 'race-teller');
  delete from profiles where login_id = 'race-teller';
  delete from auth.users where email = 'race-teller@staff.dolphin.internal';
$$);
select dblink_disconnect('setup');

select * from finish();
rollback;
