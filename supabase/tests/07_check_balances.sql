-- The ledger self-check finds balances and stock that differ from the ledger (PHASE-1.md §5.4).
\ir helpers/setup.psql

select tests.staff('t1', '{teller}') as t1 \gset
select tests.staff('keeper', '{storekeeper}') as keeper \gset
select tests.student('s1', 100);
select tests.call(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":1}')$$);
select tests.call(:'keeper', $$select upsert_product(null, '书签', 5)$$) ->> 'id' as prod \gset
select tests.call(:'keeper', format($$select stock_in(%L, 4)$$, :'prod'));

select is((select count(*)::int from app_private.check_balances()), 0, 'consistent ledger: no rows');
select is((select count(*)::int from audit_log where action = 'check.mismatch'), 0, 'and nothing logged');

update accounts set balance = balance + 5 where student_no = 's1';
update products set stock = 3 where id = :'prod';
select results_eq($$select kind, key, recorded, expected from app_private.check_balances() order by kind$$,
  format($$values ('account', 's1', 115, 110::bigint), ('product', %L, 3, 4::bigint)$$, :'prod'),
  'tampered balance and stock are reported with recorded and expected values');
select is((select jsonb_array_length(after) from audit_log where action = 'check.mismatch' order by id desc limit 1), 2,
  'mismatches are written to the audit log');

select * from finish();
rollback;
