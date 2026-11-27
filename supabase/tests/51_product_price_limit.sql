-- 商品价格 (PHASE-1.md §6.7): 1 to 1,000,000 HTB; a 兑换 over what an integer holds is a business error, at the counter
-- and in 补录, never an integer overflow.
\ir helpers/setup.psql

select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('t1', 'teller') as t1 \gset
select tests.student('s1', 100) as s1 \gset

select is(tests.call(:'keeper', format('select upsert_product(null, %L, %s, p_listed => true)', '贵', p)) ->> 'price', p::text, why)
from (values (1, 'a price from 1'), (1000000, 'up to 1,000,000 HTB')) t(p, why);
select is((tests.call(:'keeper', format('select upsert_product(null, %L, %s, p_listed => true)', 'x', p)) ->> 'detail')::jsonb,
  '{"field": "price", "min": 1, "max": 1000000}', why)
from (values (0, 'not 0'), (1000001, 'nor over 1,000,000')) t(p, why);
select is(tests.err(:'keeper', format('select upsert_product(%L, %L, 2000000, p_listed => true)', id, name)), 'INVALID_INPUT', 'an edit too')
from products where name = '贵' and price = 1;

-- 9999 each at 1 and 1,000,000 HTB: 9,999,009,999 HTB in all, past an integer.
update products set stock = 9999 where name = '贵';
create function tests.items() returns jsonb language sql as $$
  select jsonb_agg(jsonb_build_object('product_id', id, 'qty', 9999) order by price) from products where name = '贵'
$$;
select is(tests.call(:'t1', format('select purchase(gen_random_uuid(), %L, %L, %L)', 's1', tests.items(), 'account')),
  '{"error": "INSUFFICIENT_BALANCE", "detail": "{\"short\": 9999009899, \"balance\": 100}"}', 'from the account: 活期 is short');
select is(tests.call(:'t1', format('select purchase(gen_random_uuid(), %L, %L, %L, %L)', 's1', tests.items(), 'cash', '{"10":1}')),
  '{"error": "CASH_NOT_ENOUGH", "detail": "{\"due\": 9999009999, \"received\": 10}"}', 'in cash: not enough cash');
select is(tests.call(:'teacher', format('select manual_entry(gen_random_uuid(), %L, %L, now(), %L, null, %L, null, %L)',
    's1', 'purchase', '11月系统故障，柜台手写登记', 'account', tests.items())) ->> 'error',
  'INSUFFICIENT_BALANCE', '补录 the same');
select is((select sum(stock)::int from products where name = '贵'), 19998, 'nothing taken');

select * from finish();
rollback;
