-- 理财六品种 (PHASE-2.md §10.9, §10.10, §13, §14.3, §15, §17): wealth_params; each product's net value by day (the
-- daily base of the week's anchor + premium, multiplier × change, within ±cap; weekends and each product's own closed
-- days at the base; a day not known yet holding that product up; a day waiting for its week's anchor); a catch-up against
-- every day on time; the fetch by product at each product's time; the 理财 page and 手动登记 by product; then at the
-- counter today: 买入 at the latest net value, 卖出 from the next day (T+1), the reversals, 注销, who reads what, the
-- ranking, the 利率看板 and the self-check.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('t2', 'teller') as teller2 \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select app_private.cn_date(now()) as today \gset
create function tests.at(p text) returns timestamptz language sql as $$ select (p::timestamp) at time zone 'Asia/Shanghai' $$;
-- What dolphin-jobs fetched into this database goes, inside this test's transaction; each product starts at 1 on p_day.
create function tests.start(p_day date) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  delete from wealth_days;
  delete from wealth_navs;
  set local session_replication_role = origin;
  insert into wealth_navs (product, day, nav) select p ->> 'key', p_day, 1 from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p;
end $$;
create function tests.navs() returns text language sql as $$
  select string_agg(concat_ws(' ', product, day, change, anchor, premium, multiplier, rate, nav), ', ' order by product, day) from wealth_navs
$$;

-- wealth_params (§14.3).
select is(app_private.setting('wealth_params'), '{"cap":20,"products":[{"key":"bond","name":"国债","symbol":"sh000012","multiplier":10,"premium":0.25},{"key":"gold","name":"黄金","symbol":"sh518880","multiplier":1,"premium":1.75},{"key":"csi300","name":"沪深 300","symbol":"sh000300","multiplier":2,"premium":2},{"key":"chinext","name":"创业板指","symbol":"sz399006","multiplier":1,"premium":2},{"key":"hsi","name":"恒生指数","symbol":"hkHSI","multiplier":2,"premium":2},{"key":"ndx","name":"纳斯达克 100","symbol":"us.NDX","multiplier":2,"premium":2}]}',
  'six products, ±20% a day');
select is(array[app_private.day_base(2 + 2), app_private.day_base(2 + 0.25)], array[0.5619, 0.3184]::numeric[],
  'anchor 2%: an index''s daily base 0.5619%, 国债''s 0.3184%');
select is(tests.call(:'teacher', format('select set_setting(''wealth_params'', %L)',
    jsonb_set(jsonb_set(app_private.setting('wealth_params'), '{products,2,multiplier}', '3'), '{products,0,premium}', '-0.5'))) #> '{value,products}',
  jsonb_set(jsonb_set(app_private.setting('wealth_params'), '{products,2,multiplier}', '3'), '{products,0,premium}', '-0.5') -> 'products',
  'the bank admin changes a multiplier and a premium');
select is(tests.call(:'teacher', format('select set_setting(''wealth_params'', %L)', v)) ->> 'detail', '{"field": "wealth_params"}', why)
from (select app_private.setting('wealth_params') as p) w,
  lateral (values (jsonb_set(p, '{cap}', '30'), 'cap fixed'), (jsonb_set(p, '{products,0,name}', '"国债指数"'), 'names fixed'),
    (jsonb_set(p, '{products,1,symbol}', '"sh518800"'), 'symbols fixed'), (jsonb_set(p, '{products,2,key}', '"hs300"'), 'keys fixed'),
    (p #- '{products,5}', 'every product'), (jsonb_set(p, '{products}', (p -> 'products') || (p -> 'products' -> 0)), 'no more'),
    (jsonb_set(p, '{products,0,x}', '1'), 'no other key'), (jsonb_set(p, '{products,2,multiplier}', '0'), 'a multiplier from 0.1'),
    (jsonb_set(p, '{products,2,multiplier}', '21'), 'up to 20'), (jsonb_set(p, '{products,2,premium}', '10.5'), 'a premium −10 to 10'),
    (jsonb_set(p, '{products,2,premium}', '1.00001'), 'up to 4 decimals'), (p - 'cap', 'every key')) t(v, why);
select is(tests.err(w, format('select set_setting(''wealth_params'', %L)', app_private.setting('wealth_params'))), 'FORBIDDEN', 'not the others')
from unnest(array[:'president', :'accountant', :'teller', :'ops']::uuid[]) w;
select is((select (p ->> 'multiplier')::numeric from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p where p ->> 'key' = 'csi300'),
  3::numeric, 'saved');
update settings set value = '{"cap":20,"products":[{"key":"bond","name":"国债","symbol":"sh000012","multiplier":10,"premium":0.25},{"key":"gold","name":"黄金","symbol":"sh518880","multiplier":1,"premium":1.75},{"key":"csi300","name":"沪深 300","symbol":"sh000300","multiplier":2,"premium":2},{"key":"chinext","name":"创业板指","symbol":"sz399006","multiplier":1,"premium":2},{"key":"hsi","name":"恒生指数","symbol":"hkHSI","multiplier":2,"premium":2},{"key":"ndx","name":"纳斯达克 100","symbol":"us.NDX","multiplier":2,"premium":2}]}'
where key = 'wealth_params';

-- 净值 (§10.10, §13) from Sunday 2 March 2025 (each at 1). Closes for 3 to 14 March: 沪深 300 +1%, −0.5%, then +15% (the
-- cap) on 5 March, flat after; 国债 +0.1% each weekday; 黄金 −2% on 10 March; 恒生指数 closed on 5 March (no close, one
-- after) and +1% on 6 March; 纳斯达克 100 (US dates) −1% on 7 March; the rest flat.
savepoint navs;
select tests.start('2025-03-02');
update job_runs set done_to = '2025-03-02', last_ok = null, last_err = null;
create function tests.closes(p_to date) returns void language sql as $$
  insert into wealth_days (product, day, change, source, params)
  select p, d::date, case
      when p = 'csi300' and d::date = '2025-03-03' then 1 when p = 'csi300' and d::date = '2025-03-04' then -0.5
      when p = 'csi300' and d::date = '2025-03-05' then 15 when p = 'bond' then 0.1 when p = 'gold' and d::date = '2025-03-10' then -2
      when p = 'hsi' and d::date = '2025-03-06' then 1 when p = 'ndx' and d::date = '2025-03-07' then -1 else 0 end,
    'tencent', '{}'
  from generate_series('2025-03-03'::date, least(p_to, '2025-03-14'), interval '1 day') d,
    unnest(array['bond', 'gold', 'csi300', 'chinext', 'hsi', 'ndx']) p
  where extract(isodow from d) <= 5 and not (p = 'hsi' and d::date = '2025-03-05')
  on conflict do nothing
$$;
select tests.closes('2025-03-05');
select is(app_private.advance_wealth_navs('2025-03-05'), 0, 'a day waits for its week''s anchor (run_weekly of 3 March not done)');
savepoint every_day;
do $$
declare d date;
begin
  for d in select generate_series('2025-03-03'::date, '2025-03-17', interval '1 day') loop
    perform tests.closes(d - 1);   -- the closes of the day before are in by 00:05
    perform app_private.run_jobs(d);
  end loop;
end $$;
select tests.navs() as every_day \gset
rollback to savepoint every_day;
select tests.closes('2025-03-16');
select is(app_private.run_jobs('2025-03-17') -> 'failed', 'null', 'catching up two weeks at once');
select is(tests.navs(), :'every_day', 'gives the same net values as every day on time');
select is(array(select product || ' ' || count(*) from wealth_navs group by product order by product),
  array['bond 15', 'chinext 15', 'csi300 15', 'gold 15', 'hsi 15', 'ndx 15'], 'each to Sunday 16 March: Monday''s close is not known yet');
select is(count(*)::int, 0, 'each day: rate = daily base of (the week''s anchor + premium) + multiplier × change within ±20, net value to 6 decimals')
from wealth_navs n join lateral (select nav from wealth_navs p where p.product = n.product and p.day = n.day - 1) p on true
where n.anchor <> app_private.anchor_on(n.day)
   or n.rate <> least(20, greatest(-20, round(app_private.day_base(n.anchor + n.premium) + n.multiplier * n.change, 4)))
   or n.nav <> round(p.nav * (1 + n.rate / 100), 6);
select is((select concat_ws(' ', change, rate) from wealth_navs where product = 'csi300' and day = '2025-03-05'), '15.0000 20.0000', '+15% × 2 stops at +20%');
select is((select concat_ws(' ', change, rate = app_private.day_base(anchor + premium)) from wealth_navs where product = 'hsi' and day = '2025-03-05'),
  '0.0000 t', '恒生指数 closed on 5 March: the base alone');
select is((select count(*)::int from wealth_navs where day in ('2025-03-08', '2025-03-09') and rate <> app_private.day_base(anchor + premium)), 0,
  'a weekend at the base');
select is((select concat_ws(' ', change, multiplier, premium) from wealth_navs where product = 'bond' and day = '2025-03-03'), '0.1000 10.0000 0.2500',
  'with the parameters it took');
select is((select concat_ws(' ', change, rate) from wealth_navs where product = 'ndx' and day = '2025-03-07'),
  (select concat_ws(' ', -1.0000, round(app_private.day_base(anchor + 2) - 2, 4)) from wealth_navs where product = 'ndx' and day = '2025-03-07'),
  '纳斯达克 100 by the US date');

-- A day not known holds that product alone; a parameter changed applies from the next day worked out.
insert into wealth_days (product, day, change, source, params)
select p, '2025-03-17', 0.5, 'tencent', '{}' from unnest(array['bond', 'gold', 'chinext', 'hsi', 'ndx']) p;
select is(app_private.advance_wealth_navs('2025-03-18'), 5, '17 March for five; 沪深 300 waits for it, the 18th is not known for any');
select is((select max(day) from wealth_navs where product = 'csi300'), '2025-03-16'::date, '沪深 300 stays at the 16th');
select is(tests.call(:'accountant', $$select wealth_overview('2025-03-19', 3)$$) #> '{products,2,days}' -> 1 -> 'status', '"pending"',
  'the 理财 page: 沪深 300''s 17 March pending');
select is(tests.call(:'accountant', 'select wealth_overview()') #> '{products,2,missing}' -> 0, '"2025-03-17"',
  'and the first day 沪深 300 misses');
update settings set value = jsonb_set(value, '{products,2,multiplier}', '3') where key = 'wealth_params';
select is((tests.call(:'teacher', $$select record_wealth_day('csi300', '2025-03-17', 1, '中证指数官网收盘行情')$$) - 'created_at'),
  jsonb_build_object('product', 'csi300', 'day', '2025-03-17', 'close', null, 'prev_close', null, 'change', 1, 'source', 'manual',
    'note', '中证指数官网收盘行情', 'created_by', :'teacher'), 'the bank admin enters it');
select is((select concat_ws(' ', day, change, multiplier) from wealth_navs where product = 'csi300' order by day desc limit 1), '2025-03-17 1.0000 3.0000',
  'worked out at once, at the multiplier now');
select is((select multiplier from wealth_navs where product = 'csi300' and day = '2025-03-16'), 2::numeric, 'the days before as they were');
select is(tests.call(:'accountant', $$select wealth_overview('2025-03-18', 2)$$) #> '{products,2,days}',
  (select jsonb_build_array(
    jsonb_build_object('day', '2025-03-17', 'status', 'open', 'close', null, 'prev_close', null, 'change', 1, 'source', 'manual', 'source_name', '手动登记',
      'note', '中证指数官网收盘行情', 'created_by_name', 'teacher', 'created_at', w.created_at, 'rate', n.rate, 'nav', n.nav),
    jsonb_build_object('day', '2025-03-16', 'status', 'closed', 'close', null, 'prev_close', null, 'change', null, 'source', 'closed', 'source_name', '休市',
      'note', null, 'created_by_name', null, 'created_at', null, 'rate', m.rate, 'nav', m.nav))
   from wealth_days w, wealth_navs n, wealth_navs m where w.product = 'csi300' and w.day = '2025-03-17' and n.product = 'csi300' and n.day = '2025-03-17'
     and m.product = 'csi300' and m.day = '2025-03-16'),
  'each day with its close, source, rate and net value');
select is(jsonb_path_query_array(tests.call(:'accountant', $$select wealth_overview('2025-03-04', 3)$$) #> '{products,2,days}', '$[*].status'),
  '["open","none","none"]', 'nothing up to the first net value');
select is(tests.call(:'accountant', $$select wealth_overview(null, 0)$$) ->> 'detail', '{"field": "limit"}', '1 to 366 days at a time');
select is(tests.call(:'teacher', format('select record_wealth_day(%L, %L, %s, %L)', p, w, r, n)) ->> 'detail', d, why)
from (values ('csi300', '2025-03-15', '1', 'x', '{"field": "day"}', 'a weekday'), ('csi300', :'today', '1', 'x', '{"field": "day"}', 'once its close may be written'),
  ('x', '2025-03-03', '1', 'x', '{"field": "product"}', 'a product'),
  ('csi300', '2025-03-03', '50.5', 'x', '{"field": "change"}', '−50 to 50'), ('csi300', '2025-03-03', '1.00001', 'x', '{"field": "change"}', 'up to 4 decimals'),
  ('csi300', '2025-03-03', '1', ' ', '{"field": "note"}', 'where it came from')) t(p, w, r, n, d, why)
where p <> 'csi300' or w <> :'today' or now() < app_private.wealth_ready_at('csi300', :'today');
select is(tests.call(:'teacher', $$select record_wealth_day('csi300', '2025-03-17', 2, 'x')$$) ->> 'error', 'ALREADY_EXISTS', 'a day entered is never changed');
rollback to savepoint navs;

-- 取数 (§10.10) by product, each at its own time: A shares 15:30, 恒生指数 16:40, 纳斯达克 100 06:00 the next morning.
savepoint fetched;
select tests.start('2025-03-02');
select is(app_private.record_wealth_days('gold', 'tencent',
  '{"data":{"sh518880":{"qfqday":[["2025-03-03","1","5.000"],["2025-03-04","1","5.100"],["2025-03-05","1","4.998"]]}}}', tests.at('2025-03-05 15:29')), 1,
  '黄金 (an ETF, qfqday): 4 March; 5 March waits for 15:30');
select is(app_private.record_wealth_days('hsi', 'tencent',
  '{"data":{"hkHSI":{"day":[["2025-03-04","1","20000"],["2025-03-05","1","20200"]]}}}', tests.at('2025-03-05 16:39')), 0, '恒生指数 at 16:40');
select is(app_private.record_wealth_days('hsi', 'eastmoney', '{"data":{"klines":["2025-03-04,20000","2025-03-05,20200"]}}', tests.at('2025-03-05 16:40')), 1,
  'then in, from eastmoney');
select is(app_private.record_wealth_days('ndx', 'tencent',
  '{"data":{"us.NDX":{"day":[["2025-03-05","1","20000"],["2025-03-06","1","19800"]]}}}', tests.at('2025-03-07 05:59')), 0,
  '纳斯达克 100''s 6 March (US) waits for 06:00 on the 7th');
select is(app_private.record_wealth_days('ndx', 'tencent',
  '{"data":{"us.NDX":{"day":[["2025-03-05","1","20000"],["2025-03-06","1","19800"]]}}}', tests.at('2025-03-07 06:00')), 1, 'then in');
select is(app_private.record_wealth_days('csi300', 'sina', '[{"day":"2025-03-04","close":"4000"},{"day":"2025-03-05","close":"4040"}]', tests.at('2025-03-05 15:30')), 1,
  'Sina');
select is(array(select concat_ws(' ', product, day, close, prev_close, change, source) from wealth_days order by product, day),
  array['csi300 2025-03-05 4040.0000 4000.0000 1.0000 sina', 'gold 2025-03-04 5.1000 5.0000 2.0000 tencent',
    'hsi 2025-03-05 20200.0000 20000.0000 1.0000 eastmoney', 'ndx 2025-03-06 19800.0000 20000.0000 -1.0000 tencent'],
  'each product its own days');
select throws_ok($$select app_private.record_wealth_days('csi300', 'tencent', '{"data":{"sh000012":{"day":[]}}}')$$, 'no daily closes of csi300 from tencent');
select throws_ok($$select app_private.record_wealth_days('x', 'tencent', '{}')$$, 'no product x');
select throws_ok($$update wealth_days set change = 0$$, '42501', null, 'a day entered is never changed');
select throws_ok($$update wealth_navs set nav = 2$$, '42501', null, 'nor a net value');
rollback to savepoint fetched;

-- At the counter today: each product at 1 from the day before yesterday; 沪深 300 at 1.05 yesterday.
select tests.start(:'today'::date - 2);
insert into wealth_navs (product, day, change, rate, nav) values ('csi300', :'today'::date - 1, 1, 5, 1.05);
select tests.student('s1', 500) as s1 \gset
select tests.student('s2', 100) as s2 \gset
select tests.student('frz', 100);
update students set status = 'frozen' where student_no = 'frz';
select tests.student('pay', 100);
insert into staff_payroll (user_id, account) values (:'teller', 'pay');

select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000047d1', 's1', 100, 'csi300')$$) as bought \gset
select is(:'bought'::jsonb - 'id' - 'txn_no' - 'created_at' - 'holding',
  '{"type":"wealth_buy","amount":100,"balance_after":400,"denominations":null,"change_given":null}', '买入: 100 out of 活期');
select is((:'bought'::jsonb -> 'holding') - 'open_txn',
  jsonb_build_object('id', '00000000-0000-4000-8000-0000000047d1', 'student_no', 's1', 'principal', 100, 'product', 'csi300', 'buy_nav', 1.05,
    'weeks', null, 'opened_on', :'today'::date, 'starts_on', :'today'::date + 1, 'matures_on', null, 'value_centi', 10000, 'valued_to', :'today'::date,
    'status', 'open', 'close_txn', null, 'closed_on', null, 'tier', null, 'tier_name', null, 'multiplier', null, 'factor', null, 'base', null,
    'min_rate', null, 'max_rate', null, 'name', '沪深 300', 'nav', 1.05, 'gain_centi', 0, 'sellable_on', :'today'::date + 1),
  'at the latest net value, sellable tomorrow, no term');
select is((select concat_ws(' ', balance_delta, cash_delta, operator_id = :'teller', reason) from txns where id = (:'bought'::jsonb ->> 'id')::uuid),
  '-100 0 t 沪深 300，净值 1.050000', 'no cash moves; the product and the net value');
select is(tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000047d1', 's1', 100, 'csi300')$$) ->> 'id', :'bought'::jsonb ->> 'id',
  'sent again, the same result');
select is(tests.call(:'teller', $$select buy_wealth(gen_random_uuid(), 's1', 401, 'gold')$$),
  '{"error":"INSUFFICIENT_BALANCE","detail":"{\"short\": 1, \"balance\": 400}"}', 'not more than 活期');
select is(tests.call(:'teller', format('select buy_wealth(gen_random_uuid(), %L, %s, %L)', n, a, p)) ->> 'error', e, why)
from (values ('s1', 0, 'gold', 'INVALID_AMOUNT', '1 HTB or more'), ('s1', 10, 'x', 'INVALID_INPUT', 'one of the six'),
  ('frz', 10, 'gold', 'STUDENT_INACTIVE', 'an account in use'), ('pay', 10, 'gold', 'SELF_SERVICE_FORBIDDEN', 'not the teller''s own pay account'),
  ('nobody', 10, 'gold', 'STUDENT_NOT_FOUND', 'a student that exists')) t(n, a, p, e, why);
select is(tests.call(:'teller', $$select buy_wealth(gen_random_uuid(), 's1', 10, 'x')$$) ->> 'detail', '{"field": "product"}', 'field product');
select is(tests.err(w, $$select buy_wealth(gen_random_uuid(), 's1', 10, 'gold')$$), 'FORBIDDEN', 'the counter''s alone')
from unnest(array[:'president', :'teacher', :'accountant', :'s1']::uuid[]) w;
update duty set ended_at = now(), txns = 0 where user_id = :'teller2';
select is(tests.err(:'teller2', $$select buy_wealth(gen_random_uuid(), 's1', 10, 'gold')$$), 'OFF_DUTY', 'on duty');
savepoint loan;
select app_private.start_loan(gen_random_uuid(), 's2', 10, '测试', 'bullet', 1, 'account', :'teller', now()) is not null;
select is(tests.err(:'teller', $$select buy_wealth(gen_random_uuid(), 's2', 10, 'gold')$$), 'LOAN_OUTSTANDING', 'none while a loan is not paid off');
rollback to savepoint loan;

-- The quote.
select tests.call(:'teller', 'select wealth_quote(''s1'')') as quote \gset
select is(:'quote'::jsonb - 'products' - 'holdings', jsonb_build_object('student_no', 's1', 'today', :'today'::date, 'balance', 400, 'wealth_total', 100),
  'the quote: today, 活期 and 理财本金');
select is(jsonb_path_query_array(:'quote'::jsonb -> 'products', '$[*].key'), '["bond","gold","csi300","chinext","hsi","ndx"]', 'the six products in order');
select is(:'quote'::jsonb -> 'products' -> 2, jsonb_build_object('key', 'csi300', 'name', '沪深 300', 'symbol', 'sh000300', 'multiplier', 2, 'premium', 2,
    'day', :'today'::date - 1, 'nav', 1.05, 'change', 1, 'rate', 5, 'closed', true,
    'week_base', app_private.anchor_on(:'today') + 2, 'day_base', app_private.day_base(app_private.anchor_on(:'today') + 2)),
  'each with its parameters, its latest day, net value, change and rate (closed: no close that day), and this week''s base');
select is(:'quote'::jsonb -> 'products' -> 0 -> 'nav', '1.000000', 'one not moved yet at 1');
select is(jsonb_array_length(:'quote'::jsonb -> 'holdings'), 1, 'and the student''s holdings');
select is(tests.err(:'teller', 'select wealth_quote(''pay'')'), 'SELF_SERVICE_FORBIDDEN', 'not of the teller''s own pay account');
select is(tests.err(w, 'select wealth_quote(''s1'')'), 'FORBIDDEN', 'the quote is the counter''s') from unnest(array[:'teacher', :'s1']::uuid[]) w;

-- T+1: not the day bought.
select is(tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000047d1')$$),
  jsonb_build_object('error', 'WEALTH_LOCKED', 'detail', jsonb_build_object('sellable_on', :'today'::date + 1)::text), 'WEALTH_LOCKED until tomorrow');
-- Bought yesterday instead; 沪深 300 at 1.1025 today: worth 105.
update wealth_holdings set opened_on = opened_on - 1, starts_on = starts_on - 1 where id = '00000000-0000-4000-8000-0000000047d1';
insert into wealth_navs (product, day, change, rate, nav) values ('csi300', :'today', 1, 5, 1.1025);
select app_private.revalue_wealth();
select is((select concat_ws(' ', value_centi, valued_to) from wealth_holdings where id = '00000000-0000-4000-8000-0000000047d1'),
  concat_ws(' ', 10500, :'today'::date + 1), 'the value follows the net value: 100 × 1.1025 ÷ 1.05');
select is(tests.call(:'teller', 'select lookup_student(''s1'')') - 'credit' - 'name' - 'division' - 'cohort' - 'class_no' - 'grade' - 'class_label'
  - 'status' - 'withdrawn_today' - 'loan_remaining' - 'loan_overdue',
  '{"student_no":"s1","balance":400,"term_total":0,"wealth_total":100,"wealth_value_centi":10500}', '查询 shows 理财本金 and its value');
select is(tests.call(:'s1', 'select jsonb_agg(value_centi) from wealth_holdings'), '[10500]', 'the student reads their own value');
select is(tests.call(:'s1', $$select to_jsonb(nav) from wealth_navs where product = 'csi300' order by day desc limit 1$$), '1.102500', 'and the net values');

-- 卖出 at the value.
select tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000047d1')$$) as sold \gset
select is(:'sold'::jsonb - 'id' - 'txn_no' - 'created_at' - 'holding',
  '{"type":"wealth_close","amount":105,"balance_after":505,"denominations":null,"change_given":null}', '105 back to 活期');
select is(concat_ws(' ', :'sold'::jsonb #>> '{holding,status}', :'sold'::jsonb #>> '{holding,closed_on}', :'sold'::jsonb #>> '{holding,gain_centi}'),
  concat_ws(' ', 'redeemed', :'today', 500), '已卖出 today, +5');
select is((select reason from txns where id = (:'sold'::jsonb ->> 'id')::uuid), '卖出，盈 +5.00 HTB', 'the wealth_close says 卖出 and the gain');
select is(tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000047d1')$$) ->> 'id', :'sold'::jsonb ->> 'id', 'sent again, the same result');
select is(tests.err(:'teller', $$select redeem_wealth(gen_random_uuid())$$), 'INVALID_INPUT', 'a holding that exists');
select is(tests.err(w, $$select redeem_wealth('00000000-0000-4000-8000-0000000047d1')$$), 'FORBIDDEN', 'the counter''s alone')
from unnest(array[:'president', :'teacher', :'s1']::uuid[]) w;

-- 冲正 (§10.9): the teller does not reverse 卖出; the bank admin does, the holding open again at the latest net value.
select is(tests.err(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''业务选错'')', :'sold'::jsonb ->> 'id')), 'REVERSAL_NOT_ALLOWED',
  'the teller does not reverse 卖出');
select is(tests.err(:'president', format('select reverse_txn(gen_random_uuid(), %L, ''业务选错'')', :'sold'::jsonb ->> 'id')), 'FORBIDDEN', 'nor a president');
insert into wealth_navs (product, day, change, rate, nav) values ('csi300', :'today'::date + 1, 0, 0, 1.1025);
select is(tests.call(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''业务选错'')', :'sold'::jsonb ->> 'id')) - 'id' - 'txn_no' - 'created_at',
  '{"type":"reversal","amount":105,"balance_after":400,"denominations":null,"change_given":null}', 'the bank admin does: the 105 back out');
select is((select concat_ws(' ', a.balance, a.wealth_total, a.interest_carry, h.status, h.buy_nav, h.value_centi, h.valued_to, h.close_txn is null, h.closed_on is null)
    from accounts a join wealth_holdings h using (student_no) where a.student_no = 's1'),
  concat_ws(' ', 400, 100, 0, 'open', 1.050000, 10500, :'today'::date + 2, true, true), 'open again, bought at the same net value, at the latest');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
set local session_replication_role = replica;
delete from wealth_navs where day > :'today';
set local session_replication_role = origin;
update wealth_holdings set valued_to = :'today' where id = '00000000-0000-4000-8000-0000000047d1';
select is(tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000047d1')$$) ->> 'amount', '105', 'it can be sold again');

-- A loss: 50 bought at 1.1025 worth 46.50 at 1.025325 (tomorrow's, as if worked out): 46 HTB and 0.50 零头.
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000047d2', 's1', 50, 'csi300')$$) ->> 'holding' is not null;
update wealth_holdings set opened_on = opened_on - 1 where id = '00000000-0000-4000-8000-0000000047d2';
select is((select buy_nav from wealth_holdings where id = '00000000-0000-4000-8000-0000000047d2'), 1.1025, 'today''s net value');
insert into wealth_navs (product, day, change, rate, nav) values ('csi300', :'today'::date + 1, -7, -7, 1.025325);
select is(tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000047d2')$$) ->> 'amount', '46', 'a loss pays less than the principal');
select is((select concat_ws(' ', h.value_centi, t.reason, a.interest_carry) from wealth_holdings h join txns t on t.id = h.close_txn
    join accounts a on a.student_no = h.student_no where h.id = '00000000-0000-4000-8000-0000000047d2'),
  '4650 卖出，亏 −3.50 HTB 50', 'and says so; the 0.50 kept as 零头');
set local session_replication_role = replica;
delete from wealth_navs where day > :'today';
set local session_replication_role = origin;

-- 买入 reversed: the teller their own the same day; the bank admin while it is open, any day.
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000047d3', 's1', 20, 'gold')$$) as third \gset
select is(tests.err(:'teller2', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'third'::jsonb ->> 'id')), 'REVERSAL_NOT_ALLOWED',
  'a teller reverses only their own');
select is(tests.call(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'third'::jsonb ->> 'id')) ->> 'amount', '20',
  'their own of today: the principal back to 活期');
select is((select concat_ws(' ', h.status, a.wealth_total) from wealth_holdings h join accounts a using (student_no) where h.id = '00000000-0000-4000-8000-0000000047d3'),
  'reversed 0', 'the holding void');
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000047d4', 's1', 10, 'gold')$$) as fourth \gset
set local session_replication_role = replica;
update txns set created_at = created_at - interval '3 days' where id = (:'fourth'::jsonb ->> 'id')::uuid;
set local session_replication_role = origin;
update wealth_holdings set value_centi = 1020 where id = '00000000-0000-4000-8000-0000000047d4';
select is(tests.err(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'fourth'::jsonb ->> 'id')), 'REVERSAL_NOT_ALLOWED',
  'the teller not a later day');
select is(tests.call(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'fourth'::jsonb ->> 'id')) ->> 'amount', '10',
  'the bank admin a later day: the principal back');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- A frozen account keeps its holding and cannot sell it.
select app_private.start_wealth('00000000-0000-4000-8000-0000000047d5', 'frz', 10, 'bond', :'teller', now() - interval '1 day') is not null;
select is(tests.err(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000047d5')$$), 'STUDENT_INACTIVE', 'no 卖出 while frozen');

-- Who reads what (§3, §16).
select is(tests.call(:'s1', 'select count(*) from wealth_holdings'), '4', 'a student reads their own holdings');
select is(tests.call(:'s2', 'select count(*) from wealth_holdings'), '0', 'only their own');
select is(tests.call(w, 'select count(*) from wealth_holdings'), '5', 'the accountant, president and bank admin everyone''s')
from unnest(array[:'accountant', :'president', :'teacher']::uuid[]) w;
select is(tests.call(w, 'select count(*) from wealth_holdings'), '0', 'the others none, the counter through wealth_quote')
from unnest(array[:'teller', :'ops']::uuid[]) w;
select is(tests.call(w, 'select to_jsonb(count(*) = (select count(*) from wealth_navs)) from wealth_navs'), 'true', 'everyone reads the net values')
from unnest(array[:'s1', :'teller', :'ops']::uuid[]) w;
select is(tests.err(w, 'select wealth_overview()'), 'FORBIDDEN', 'the 理财 page is the back office''s') from unnest(array[:'teller', :'s1', :'ops']::uuid[]) w;
select is(tests.call(:'teacher', 'select wealth_overview()') #> '{products,0,open}', '{"count": 1, "principal": 10, "value_centi": 1000}',
  'the 理财 page: each product''s holdings open');
select is(tests.call(:'teacher', 'select wealth_overview()') -> 'open', '{"count": 1, "principal": 10, "value_centi": 1000}', 'and all');

-- 排名 (§16.3) by 活期 + 定期 + 理财本金.
select tests.student('ra', 150, null, 'junior') as ra \gset
select tests.student('rb', 120, null, 'junior') as rb \gset
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000047d6', 'ra', 100, 'csi300')$$) is not null;
select is(jsonb_path_query_array(tests.call(:'rb', 'select deposit_ranking()') -> 'top', '$[*].balance'), '[150, 120]', 'ranked with the 理财本金');
-- 频繁操作 (§12.1) counts 买入 and 卖出.
select is(app_private.is_business(t), true, 'a 买入 is business') from txns t where t.wealth_id = '00000000-0000-4000-8000-0000000047d6';

-- 注销 (P1 §6.4): sold at the latest net value the day bought (no T+1), then the balance.
insert into wealth_navs (product, day, change, rate, nav) values ('csi300', :'today'::date + 1, 5, 5, 1.157625);
select is(tests.call(:'teacher', format('select close_accounts(array[%L]::uuid[])', :'ra')), '{"closed":1,"cleared":155}', '注销 clears 活期 and 理财');
select is(array(select concat_ws(' ', type, amount, reason) from txns where student_no = 'ra' and type in ('wealth_close', 'closing') order by seq),
  array['wealth_close 105 卖出，盈 +5.00 HTB', 'closing 155 注销账号'], 'sold first (1.157625 ÷ 1.1025), then the whole balance');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- 利率看板 (§16.4): each product's latest day, change and rate; closed on a day with no close.
insert into wealth_navs (product, day, change, anchor, premium, multiplier, rate, nav)
values ('bond', :'today'::date - 1, 0, 2, 0.25, 10, 0.3184, 1.003184);
select is(tests.call(:'s2', 'select public_rates()') -> 'wealth',
  jsonb_build_array(
    jsonb_build_object('key', 'bond', 'name', '国债', 'day', :'today'::date - 1, 'change', 0, 'rate', 0.3184, 'closed', true),
    jsonb_build_object('key', 'gold', 'name', '黄金', 'day', :'today'::date - 2, 'change', null, 'rate', null, 'closed', false),
    jsonb_build_object('key', 'csi300', 'name', '沪深 300', 'day', :'today'::date, 'change', 1, 'rate', 5, 'closed', true),
    jsonb_build_object('key', 'chinext', 'name', '创业板指', 'day', :'today'::date - 2, 'change', null, 'rate', null, 'closed', false),
    jsonb_build_object('key', 'hsi', 'name', '恒生指数', 'day', :'today'::date - 2, 'change', null, 'rate', null, 'closed', false),
    jsonb_build_object('key', 'ndx', 'name', '纳斯达克 100', 'day', :'today'::date - 2, 'change', null, 'rate', null, 'closed', false)),
  'each product: none yet before the first day worked out');
insert into wealth_days (product, day, change, source, params) values ('csi300', :'today', 1, 'tencent', '{}');
select is(tests.call(:'s2', 'select public_rates()') #> '{wealth,2,closed}', 'false', 'open once its close is in');

-- The self-check (§14.1) finds a 理财本金合计 that does not match the holdings open.
update accounts set wealth_total = wealth_total + 5 where student_no = 's1';
select is(array(select concat_ws(' ', kind, key, recorded, expected) from app_private.check_balances()), array['wealth s1 5 0'],
  'check_balances: wealth_total against the principal open');

select * from finish();
rollback;
