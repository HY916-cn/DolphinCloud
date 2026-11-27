-- 补登行情 (PHASE-2.md §10.10): a weekday worked into the net values as closed (a later close came first) takes no close
-- any more: record_wealth_day says WEALTH_DAY_SETTLED and writes nothing, the fetch skips it, the net values stay as they
-- were, and the 理财 page lists it among each product's inferred days.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('acc', 'accountant') as accountant \gset
create function tests.at(p text) returns timestamptz language sql as $$ select (p::timestamp) at time zone 'Asia/Shanghai' $$;

-- Each product at 1 on Sunday 2 March 2025; closes for 3 to 5 March, but 沪深 300 has none for Tuesday 4 March.
set local session_replication_role = replica;
delete from wealth_days;
delete from wealth_navs;
set local session_replication_role = origin;
insert into wealth_navs (product, day, nav) select p ->> 'key', '2025-03-02', 1 from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p;
update job_runs set done_to = '2025-03-02', last_ok = null, last_err = null;
insert into wealth_days (product, day, change, source, params)
select p, d::date, 1, 'tencent', '{}'
from generate_series('2025-03-03'::date, '2025-03-05', interval '1 day') d, unnest(array['bond', 'gold', 'csi300', 'chinext', 'hsi', 'ndx']) p
where not (p = 'csi300' and d::date = '2025-03-04');
select is(app_private.run_jobs('2025-03-06') -> 'failed', 'null', 'the jobs up to 5 March');
select is((select concat_ws(' ', change, rate = app_private.day_base(anchor + premium)) from wealth_navs where product = 'csi300' and day = '2025-03-04'),
  '0.0000 t', '沪深 300''s 4 March taken as closed: the base alone');
select string_agg(concat_ws(' ', product, day, change, rate, nav), ', ' order by product, day) as navs from wealth_navs \gset

select is(tests.call(:'teacher', $$select record_wealth_day('csi300', '2025-03-04', 1, '中证指数官网收盘行情')$$),
  '{"error": "WEALTH_DAY_SETTLED", "detail": "{\"day\": \"2025-03-04\", \"nav_day\": \"2025-03-05\", \"product\": \"csi300\"}"}',
  'a close for a day already worked out is refused, with the latest day of net values');
select is((select count(*)::int from wealth_days where product = 'csi300' and day = '2025-03-04'), 0, 'and not written');
select is(tests.call(:'teacher', $$select record_wealth_day('csi300', '2025-03-03', 1, 'x')$$) ->> 'error', 'ALREADY_EXISTS',
  'a day entered is still ALREADY_EXISTS');
select is(tests.call(:'teacher', $$select record_wealth_day('csi300', '2025-03-04', 99, 'x')$$) ->> 'detail', '{"field": "change"}',
  'and the input is checked first');
select is(app_private.record_wealth_days('csi300', 'sina', '[{"day":"2025-03-03","close":"4000"},{"day":"2025-03-04","close":"4040"}]',
  tests.at('2025-03-06 16:00')), 0, 'the fetch leaves it out too');
select is((select string_agg(concat_ws(' ', product, day, change, rate, nav), ', ' order by product, day) from wealth_navs), :'navs',
  'the net values as they were');

-- The 理财 page: inferred, each product's weekdays among its last 30 days of net values that took no close.
select is(jsonb_object_agg(p ->> 'key', p -> 'inferred'),
  '{"ndx": [], "hsi": [], "bond": [], "gold": [], "csi300": ["2025-03-04"], "chinext": []}', 'the 理财 page lists 沪深 300''s 4 March')
from jsonb_array_elements(tests.call(:'accountant', 'select wealth_overview()') -> 'products') p;
select is(tests.call(:'accountant', 'select wealth_overview()') #> '{products,2,missing}' -> 0, '"2025-03-06"',
  'and it is not missing (it cannot be entered): the first day missing is the 6th');

-- A day not worked out yet still takes its close: 6 March, held for 沪深 300 alone.
insert into wealth_days (product, day, change, source, params)
select p, '2025-03-06', 1, 'tencent', '{}' from unnest(array['bond', 'gold', 'chinext', 'hsi', 'ndx']) p;
select is(tests.call(:'teacher', $$select record_wealth_day('csi300', '2025-03-06', 0.5, '中证指数官网收盘行情')$$) ->> 'change', '0.5000',
  'a day not worked out takes its close');
select is((select change from wealth_navs where product = 'csi300' and day = '2025-03-06'), 0.5000, 'into the net values at once');

select * from finish();
rollback;
