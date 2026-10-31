-- Purchases paid from the account or in cash: stock, listing, balance, change (PHASE-1.md §6.2).
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.student('s1', 100) as s1 \gset
select tests.student('s2', 20) as s2 \gset

select tests.call(:'keeper', $$select upsert_product(null, '海豚书签', 10, p_listed => true)$$) ->> 'id' as a \gset
select tests.call(:'keeper', $$select upsert_product(null, '贴纸', 3, p_listed => true)$$) ->> 'id' as b \gset
select tests.call(:'keeper', $$select upsert_product(null, '下架商品', 5, p_listed => false)$$) ->> 'id' as c \gset
select tests.call(:'keeper', format($$select stock_in(%L, 5)$$, :'a'));
select tests.call(:'keeper', format($$select stock_in(%L, 1)$$, :'b'));
select tests.call(:'keeper', format($$select stock_in(%L, 5)$$, :'c'));

select is(tests.call(:'t1', format($$select purchase('00000000-0000-4000-8000-000000000010', 's1', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 2), jsonb_build_object('product_id', :'b', 'qty', 1))))
  - 'id' - 'txn_no' - 'created_at', '{"type":"purchase","amount":23,"balance_after":77,"change_given":null}', 'account purchase');
select is((select row(balance, total_spent)::text from accounts where student_no = 's1'), '(77,23)', 'balance and total spent');
select is((select array_agg(stock order by price) from products where id in (:'a', :'b')), '{0,3}', 'stock is reduced');
select is((select count(*)::int from txn_items where txn_id = '00000000-0000-4000-8000-000000000010'), 2, 'one item row per product');
select is((select sum(qty_delta)::int from stock_movements where txn_id = '00000000-0000-4000-8000-000000000010' and kind = 'sale'), -3,
  'sales are recorded as stock movements');
select is((select row(balance_delta, cash_delta, payment)::text from txns where id = '00000000-0000-4000-8000-000000000010'),
  '(-23,0,account)', 'account purchase moves no counter cash');
select throws_ok($$delete from stock_movements$$, '42501', null, 'stock movements are append-only');
select throws_ok($$update txn_items set qty = 1$$, '42501', null, 'transaction items are append-only');

select is(tests.call(:'t1', format($$select purchase('00000000-0000-4000-8000-000000000010', 's1', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 2)))) ->> 'amount', '23', 'resubmitting returns the first result');
select is((select stock from products where id = :'a'), 3, 'the resubmission takes no stock');

select is(tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's1', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'b', 'qty', 1)))) ->> 'detail',
  jsonb_build_object('name', '贴纸', 'stock', 0, 'product_id', :'b')::text, 'out of stock names the product');
select is(tests.err(:'t1', format($$select purchase(gen_random_uuid(), 's1', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'c', 'qty', 1)))), 'PRODUCT_UNLISTED', 'unlisted product');
select is(tests.err(:'t1', format($$select purchase(gen_random_uuid(), 's1', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', gen_random_uuid(), 'qty', 1)))), 'PRODUCT_NOT_FOUND', 'unknown product');
select is(tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's2', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 3)))) ->> 'detail', '{"short": 10, "balance": 20}', 'insufficient balance');
select is((select stock from products where id = :'a'), 3, 'a refused purchase takes no stock');

select is(tests.err(:'t1', format($$select purchase(gen_random_uuid(), 's1', %L, 'card')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 1)))), 'INVALID_INPUT', 'unknown payment method');
select is(tests.err(:'t1', $$select purchase(gen_random_uuid(), 's1', '[]', 'account')$$), 'INVALID_INPUT', 'empty cart');
select is(tests.err(:'t1', format($$select purchase(gen_random_uuid(), 's1', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 0)))), 'INVALID_INPUT', 'zero quantity');
select is(tests.err(:'s2', format($$select purchase(gen_random_uuid(), 's1', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 1)))), 'FORBIDDEN', 'a student cannot sell');

select is(tests.call(:'t1', format($$select purchase('00000000-0000-4000-8000-000000000011', 's1', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 1), jsonb_build_object('product_id', :'a', 'qty', 1)))) ->> 'amount', '20',
  'repeated product lines are merged');
select is((select qty from txn_items where txn_id = '00000000-0000-4000-8000-000000000011'), 2, 'merged into one item row');

-- Cash
select tests.call(:'keeper', format($$select stock_in(%L, 5)$$, :'a'));
select is(tests.call(:'t1', format($$select purchase('00000000-0000-4000-8000-000000000012', 's2', %L, 'cash', '{"10":1,"5":1,"2":1}')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 1)))) - 'id' - 'txn_no' - 'created_at',
  '{"type":"purchase","amount":10,"balance_after":20,"change_given":{"2":1,"5":1}}', 'cash purchase gives change for 7');
select is((select row(balance_delta, cash_delta, payment, denominations)::text from txns where id = '00000000-0000-4000-8000-000000000012'),
  row(0, 10, 'cash', '{"10":1,"5":1,"2":1}'::jsonb)::text, 'cash purchase keeps the balance and adds the price to counter cash');
select is((select balance from accounts where student_no = 's2'), 20, 'balance unchanged');
select is(tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's2', %L, 'cash', '{"5":1}')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 1)))) ->> 'detail', '{"due": 10, "received": 5}', 'cash not enough');
select is(tests.err(:'t1', format($$select purchase(gen_random_uuid(), 's2', %L, 'cash')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 1)))), 'INVALID_AMOUNT', 'cash purchase needs the cash received');
select is(tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's2', %L, 'cash', '{"10":1}')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 1)))) -> 'change_given', '{}'::jsonb, 'exact cash gives no change');

select is((select count(*)::int from app_private.check_balances()), 0, 'balances and stock match the ledger');

select * from finish();
rollback;
