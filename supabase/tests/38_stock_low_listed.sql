-- 库存不足 (PHASE-2.md §12.1) on the products 总览 lists, listed and at or under the 安全库存: created so, listed so,
-- the stock falling or the 安全库存 rising each raise one alert, an unlisted product none; one per product while open;
-- the migration's backfill, once; the products with an open alert are those 总览 lists.
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('admin', 'teacher') as admin \gset
select tests.student('s1', 500) \gset

-- The products with an open stock_low alert, and those 总览 lists (client/src/app/admin/index.tsx: listed and low).
create function tests.alerted() returns text[] language sql as $$
  select coalesce(array_agg(p.name order by p.name), '{}') from risk_alerts a join products p on a.target = 'products:' || p.id
  where a.kind = 'stock_low' and a.status = 'open'
$$;
create function tests.overview() returns text[] language sql as $$
  select coalesce(array_agg(name order by name), '{}') from products where listed and low
$$;
create function tests.n() returns bigint language sql as $$ select count(*) from risk_alerts where kind = 'stock_low' $$;
-- A product the storekeeper creates, then stocks in p_stock (a new product has none).
create function tests.product(p_name text, p_listed boolean, p_stock integer default 0) returns uuid language plpgsql as $$
declare
  v_keeper uuid := (select id from profiles where login_id = 'keeper');
  v uuid := (tests.call(v_keeper, format('select upsert_product(null, %L, 5, p_listed => %s)', p_name, p_listed::text)) ->> 'id')::uuid;
begin
  if p_stock > 0 then
    perform tests.call(v_keeper, format('select stock_in(%L, %s)', v, p_stock));
  end if;
  return v;
end $$;

-- Created at or under the 安全库存: listed raises one, unlisted none.
select tests.product('甲', true) as a \gset
select tests.product('乙', false) as b \gset
select is(tests.alerted(), array['甲'], 'created low: listed raises one, unlisted none');
select is((select row(student_no, staff_id, detail)::text from risk_alerts where target = 'products:' || :'a'),
  row(null::text, null::uuid, '{"name": "甲", "stock": 0, "safety_stock": 5}'::jsonb)::text, 'the product and its stock');

-- Unlisted, falling to the 安全库存: none; listed while low: one.
select tests.product('丙', false, 10) as c \gset
select tests.call(:'keeper', format($$select stock_move('stock_out', '[{"product_id":"%s","qty":6}]', '损坏')$$, :'c'));
select is(tests.alerted(), array['甲'], 'unlisted falling low raises nothing');
select tests.call(:'keeper', format($$select upsert_product(%L, '丙', 5, p_listed => true)$$, :'c'));
select is((select detail from risk_alerts where target = 'products:' || :'c'), '{"name": "丙", "stock": 4, "safety_stock": 5}',
  'listed while low raises one');

-- Listed, the stock falling to the 安全库存 by a sale: one.
select tests.product('丁', false, 10) as d \gset
select tests.call(:'keeper', format($$select upsert_product(%L, '丁', 5, p_listed => true)$$, :'d'));
select is(tests.alerted(), array['丙', '甲'], 'listed above the 安全库存 raises nothing');
select tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's1', %L, 'account')$$, jsonb_build_array(jsonb_build_object('product_id', :'d', 'qty', 5))));
select is((select detail from risk_alerts where target = 'products:' || :'d'), '{"name": "丁", "stock": 5, "safety_stock": 5}',
  'a sale down to the 安全库存 raises one');

-- Listed, the 安全库存 raised to the stock: one.
select tests.product('戊', false, 8) as e \gset
select tests.call(:'keeper', format($$select upsert_product(%L, '戊', 5, p_listed => true)$$, :'e'));
select tests.call(:'keeper', format($$select upsert_product(%L, '戊', 5, p_listed => true, p_safety_stock => 8)$$, :'e'));
select is((select detail from risk_alerts where target = 'products:' || :'e'), '{"name": "戊", "stock": 8, "safety_stock": 8}',
  'the 安全库存 raised to the stock raises one');

-- While open: falling again, or unlisted and listed again, raises no other.
select tests.call(:'keeper', format($$select stock_in(%L, 10)$$, :'a'));
select tests.call(:'keeper', format($$select stock_move('stock_out', '[{"product_id":"%s","qty":8}]', '损坏')$$, :'a'));
select tests.call(:'keeper', format($$select upsert_product(%L, '丙', 5, p_listed => false)$$, :'c'));
select tests.call(:'keeper', format($$select upsert_product(%L, '丙', 5, p_listed => true)$$, :'c'));
select is(tests.n(), 4::bigint, 'one per product while open');
select is(tests.alerted(), tests.overview(), 'the alerted products are those 总览 lists');
select is(tests.overview(), array['丁', '丙', '戊', '甲'], '…the listed products at or under the 安全库存');

-- The backfill: 己 listed and low before the triggers (as products were before this migration), 甲's alert marked
-- 已查看. Running the migration gives each one open alert; running it again adds none.
set local session_replication_role = replica;
insert into products (name, price, listed) values ('己', 5, true);
set local session_replication_role = origin;
select tests.call(:'admin', format('select handle_alert(%s, %L)', (select id from risk_alerts where target = 'products:' || :'a'), 'seen'));
select is(tests.alerted(), array['丁', '丙', '戊'], 'before the backfill: 己 and 甲 without an open alert');
\i /opt/dolphin/migrations/20261207000000_stock_low_listed.sql
select is(tests.alerted(), tests.overview(), 'the backfill: every listed low product has an open alert');
select is(tests.n(), 6::bigint, '…one each for 己 and 甲');
\i /opt/dolphin/migrations/20261207000000_stock_low_listed.sql
select is(tests.n(), 6::bigint, 'again: none');
select is(array(select tgname::text from pg_trigger where tgrelid = 'public.products'::regclass and tgname like 'risk_alert%' order by 1),
  array['risk_alert_insert', 'risk_alert_update'], 'the triggers once');

select * from finish();
rollback;
