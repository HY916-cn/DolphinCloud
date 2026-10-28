-- Privileges and append-only ledger (PHASE-1.md §5.1, §5.4).
\ir helpers/setup.psql

select is((select count(*)::int from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relrowsecurity
  and relname in ('profiles','user_roles','students','accounts','txns','products','txn_items','stock_movements',
                  'currency_issues','settings','audit_log')), 11, 'RLS is enabled on every business table');

select ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
  and grantee = 'authenticated' and privilege_type <> 'SELECT'), 'authenticated can only select business tables');

select ok(not exists (select 1 from information_schema.role_table_grants where table_schema = 'public'
  and grantee in ('anon', 'PUBLIC')), 'anon has no table privileges');

select ok(not exists (select 1 from pg_proc p where pronamespace = 'public'::regnamespace
  and has_function_privilege('anon', p.oid, 'execute')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')), 'anon cannot call any app function');

select ok(not has_function_privilege('authenticated', 'app_private.create_login(text, text)', 'execute'),
  'authenticated cannot call create_login');
select ok(not has_function_privilege('authenticated', 'app_private.check_balances()', 'execute'),
  'authenticated cannot call check_balances');

select tests.staff('t1', 'teller') as t1 \gset
select tests.student('s1', 100) as s1 \gset
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000001', 's1', '{"10":1}')$$) ->> 'txn_no' as txn_no \gset

select matches(:'txn_no'::text, '^HT[0-9]{12}$', 'transaction number is HT + YYMMDD + 6 digits');
select is(tests.err(:'t1', $$update txns set amount = 1$$), 'permission denied for table txns', 'users cannot update txns');
select is(tests.err(:'s1', $$delete from txns$$), 'permission denied for table txns', 'users cannot delete txns');

select throws_ok($$update txns set amount = 99 where student_no = 's1'$$, '42501', null, 'even the owner cannot change an amount');
select throws_ok($$delete from txns where student_no = 's1'$$, '42501', null, 'even the owner cannot delete a transaction');
select throws_ok($$truncate txns cascade$$, '42501', null, 'even the owner cannot truncate txns');
select lives_ok($$update txns set status = 'reversed' where id = '00000000-0000-4000-8000-000000000001'$$,
  'marking a transaction reversed is the one allowed update');
select throws_ok($$update txns set status = 'normal' where id = '00000000-0000-4000-8000-000000000001'$$, '42501', null,
  'a reversed transaction cannot be restored');

select is((select value from settings where key = 'denominations'), '[1,2,5,10]'::jsonb, 'default denominations');

select * from finish();
rollback;
