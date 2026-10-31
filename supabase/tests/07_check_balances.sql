-- The ledger self-check finds balances, stock, balance_after chains, account totals and purchase items that differ
-- from the ledger (PHASE-1.md §5.4).
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.student('s1', 100);
select tests.call(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":1}')$$);
select tests.call(:'keeper', $$select upsert_product(null, '书签', 5, p_listed => true)$$) ->> 'id' as prod \gset
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

-- Undo, then break the other invariants (txns and txn_items are append-only, so with triggers off).
update accounts set balance = balance - 5 where student_no = 's1';
update products set stock = 4 where id = :'prod';
select tests.student('s2', 50);
select tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's2', '[{"product_id":"%s","qty":1}]', 'account')$$, :'prod')) ->> 'txn_no' as buy \gset
select tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's2', '[{"product_id":"%s","qty":1}]', 'cash', '{"10":1}')$$, :'prod'));
select tests.call(:'t1', $$select withdraw(gen_random_uuid(), 's2', 5)$$) ->> 'id' as wd \gset
select tests.call(:'t1', format($$select reverse_txn(gen_random_uuid(), %L, '金额录错')$$, :'wd'));
select is((select count(*)::int from app_private.check_balances()), 0, 'cash purchases and reversals keep the totals consistent');

select txn_no as dep from txns where student_no = 's1' and type = 'deposit' \gset
set local session_replication_role = replica;
update txns set balance_after = 111 where txn_no = :'dep';
update txn_items set unit_price = 4 where txn_id = (select id from txns where txn_no = :'buy');
set local session_replication_role = origin;
update accounts set total_out = 7 where student_no = 's1';
update accounts set total_in = 51, total_spent = 0 where student_no = 's2';
select results_eq($$select kind, key, recorded, expected from app_private.check_balances() order by kind, key$$,
  format($$values ('balance_after', %L, 111, 110::bigint), ('total_in', 's2', 51, 50::bigint), ('total_out', 's1', 7, 0::bigint),
    ('total_spent', 's2', 0, 5::bigint), ('txn_items', %L, 5, 4::bigint)$$, :'dep', :'buy'),
  'a broken balance_after chain, wrong totals and purchase items that do not add up are reported');

select * from finish();
rollback;
