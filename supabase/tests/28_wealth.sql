-- 理财 (PHASE-2.md §9.6, §10.10, §13, §14, §15, §17): the daily closes from Tencent, Sina and eastmoney and by hand, the
-- rate of a day by length and tier, the jobs on fixed days in 2025 (every day applied in order, weekends and a holiday at
-- the base, maturity in the school holidays, a trading day missing holding the holdings up until it is entered, a
-- catch-up against every day on time); then at the counter today: buying, redeeming at the value, the reversals, who
-- reads what, the ranking, 注销 and the self-check.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('t2', 'teller') as teller2 \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select app_private.cn_date(now()) as today \gset
create function tests.at(p text) returns timestamptz language sql as $$ select (p::timestamp) at time zone 'Asia/Shanghai' $$;
-- Closes dolphin-jobs may have fetched into this database go, inside this test's transaction: a later trading day's close
-- would make every weekday of 2025 without one a holiday.
set local session_replication_role = replica;
delete from wealth_days;
set local session_replication_role = origin;

-- wealth_params (§14.3): 沪深 300; the weekly base of each length such that an index that never moves pays what the 定期
-- of the length plus 1.5 points pays in simple interest; factor 2; three tiers with daily bounds.
select is(app_private.setting('wealth_params'), '{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}',
  'the default index, weekly bases, factor and tiers');
select is(array(select round(((1 + ((app_private.setting('term_rates') ->> w::text)::numeric + 1.5) * w / 100) ^ (1.0 / w) - 1) * 100, 4)
  from unnest(array[2, 4, 12, 24, 48]) w),
  array(select (app_private.setting('wealth_params') -> 'base' ->> w::text)::numeric from unnest(array[2, 4, 12, 24, 48]) w),
  'weekly base = (1 + (定期 rate + 1.5) × weeks / 100)^(1 / weeks) − 1');
select is(array(select app_private.day_base((app_private.setting('wealth_params') -> 'base' ->> w::text)::numeric) from unnest(array[2, 4, 12, 24, 48]) w),
  array[0.5512, 0.5623, 0.5153, 0.4539, 0.3649]::numeric[], 'the daily base: (1 + weekly)^(1/7) − 1');
create function tests.hold(p_weeks integer, p_tier jsonb) returns wealth_holdings language sql as $$
  select row(null, null, 1, p_weeks, null, null, null, 10000, null, 'open', null, null, p_tier ->> 'key', p_tier ->> 'name', (p_tier ->> 'multiplier')::numeric,
    2, (app_private.setting('wealth_params') -> 'base' ->> p_weeks::text)::numeric, (p_tier ->> 'min')::numeric, (p_tier ->> 'max')::numeric, null)::wealth_holdings
$$;
select is(array(select app_private.holding_rate(tests.hold(2, t), c)
  from jsonb_array_elements(app_private.setting('wealth_params') -> 'tiers') with ordinality x(t, i), unnest(array[1, -1, 3, -3, 0]) with ordinality y(c, j)
  order by i, j), array[2.5512, -1.4488, 5, -5, 0.5512, 4.5512, -3.4488, 10, -10, 0.5512, 8.5512, -7.4488, 20, -20, 0.5512]::numeric[],
  'a day of +1% / −1% / +3% / −3% / closed for 2 weeks: 稳健 2, 平衡 4, 进取 8 times the index on the daily base, within ±5 / ±10 / ±20');
select is(array(select app_private.tier_rate(app_private.setting('wealth_params'), 2, t, 1) from jsonb_array_elements(app_private.setting('wealth_params') -> 'tiers') t),
  array[2.5512, 4.5512, 8.5512]::numeric[], 'tier_rate works it out the same from wealth_params');
-- Under the defaults an index that never moves pays 108 / 117 / 154 / 214 / 340 HTB on 100 HTB.
select is(array(select (with recursive v(n, c) as (select 0, 10000::numeric union all
    select n + 1, round(c * (100 + app_private.day_base((app_private.setting('wealth_params') -> 'base' ->> w::text)::numeric)) / 100) from v where n < 7 * w)
  select round(c / 100) from v where n = 7 * w) from unnest(array[2, 4, 12, 24, 48]) w), array[108, 117, 154, 214, 340]::numeric[],
  'flat, each length ends 1.5 points a week of simple interest above its 定期');

-- The daily closes (§10.10): each trading day with the one before it in the list, today's from 15:30; the first in the
-- list has nothing to compare with; a day already in is kept.
savepoint closes;
select is(app_private.record_wealth_days('tencent',
  '{"code":0,"data":{"sh000300":{"day":[["2025-03-03","3900","3900.00","3910","3890","1"],["2025-03-04","3900","3939.00","3950","3890","1"],["2025-03-05","3939","3919.305","3950","3900","1"]]}}}',
  tests.at('2025-03-05 15:00')), 1, 'Tencent: 4 March in; 5 March waits for 15:30');
select is(app_private.record_wealth_days('sina',
  '[{"day":"2025-03-04","close":"3939.000"},{"day":"2025-03-05","close":"3919.305"},{"day":"2025-03-07","close":"3958.498"}]', tests.at('2025-03-07 15:30')), 2,
  'Sina: 5 and 7 March from 15:30');
select is(app_private.record_wealth_days('tencent', '{"data":{"sh000300":{"day":[["2025-03-03","1","3000"],["2025-03-04","1","9999"]]}}}', tests.at('2025-03-12 09:00')), 0,
  'a day already in is kept as it was');
select is(app_private.record_wealth_days('eastmoney', '{"data":{"klines":["2025-03-07,3958.50","2025-03-10,3919.10"]}}', tests.at('2025-03-11 09:00')), 1,
  'eastmoney: 10 March');
select is(array(select concat_ws(' ', day, close, prev_close, change, source, created_by is null) from wealth_days where day < '2025-06-01' order by day),
  array['2025-03-04 3939.0000 3900.0000 1.0000 tencent t', '2025-03-05 3919.3050 3939.0000 -0.5000 sina t', '2025-03-07 3958.4980 3919.3050 1.0000 sina t',
    '2025-03-10 3919.1000 3958.5000 -0.9953 eastmoney t'], 'each with its close, the close before and the change');
select is(array(select coalesce(app_private.wealth_day_change(d::date)::text, 'null') from generate_series('2025-03-04'::date, '2025-03-11', interval '1 day') d),
  array['1.0000', '-0.5000', '0', '1.0000', '0', '0', '-0.9953', 'null'],
  'a weekday without a close and a later trading day in (6 March) is closed, as are weekends; 11 March is not known yet');
select throws_ok($$select app_private.record_wealth_days('tencent', '{"code":0,"data":{}}')$$, 'no daily closes from tencent');
select throws_ok($$select app_private.record_wealth_days('sina', '[{"day":"2025-03-28","close":"x"}]')$$);
select throws_ok($$update wealth_days set change = 0$$, '42501', null, 'a day entered is never changed');
rollback to savepoint closes;

-- wealth_params: the bank admin and the president, for the holdings bought after.
select is(tests.call(:'teacher', $$select set_setting('wealth_params', '{"symbol":"sz399006","name":"创业板指","factor":3,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}')$$) -> 'value',
  '{"symbol":"sz399006","name":"创业板指","factor":3,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'the bank admin changes the index, bases, factor and tiers');
select is(tests.call(:'president', $$select set_setting('wealth_params', '{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}')$$) -> 'value', '{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'so does the president');
select is(tests.err(w, $$select set_setting('wealth_params', '{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}')$$), 'FORBIDDEN', 'not the others')
from unnest(array[:'accountant', :'teller', :'ops']::uuid[]) w;
select is(tests.call(:'teacher', format('select set_setting(''wealth_params'', %L)', v)) ->> 'detail', '{"field": "wealth_params"}', why)
from (values ('{"symbol":"sh000300","name":"沪深 300","base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'every key'),
  ('{"symbol":"sh000300","name":"沪深 300","factor":2,"x":1,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'no other'),
  ('{"symbol":"000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'sh or sz and six digits'),
  ('{"symbol":"sh000300&x=1","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'nothing more in it'),
  ('{"symbol":"sh000300","name":"","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'a name'),
  ('{"symbol":"sh000300","name":"沪深 300","factor":0,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'a factor from 0.01'),
  ('{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'a base for every length'),
  ('{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":-1,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'a base from 0'),
  ('{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[]}', 'a tier at least'),
  ('{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"steady","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'each tier its own key'),
  ('{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"Bold","name":"进取","multiplier":4,"min":-20,"max":20}]}', 'keys in lower case'),
  ('{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":0,"min":-20,"max":20}]}', 'a multiplier from 0.1'),
  ('{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-101,"max":20}]}', 'a day loses at most everything'),
  ('{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":101}]}', 'a daily upper bound up to 100'),
  ('{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20}]}', 'every key of a tier')) t(v, why);

-- The jobs (§10.10, §13) from Monday 3 March 2025: 春季 to Sunday 30 March, school holidays, 夏季 from Monday 14 April.
-- w1 buys a (100, 2 weeks) on Wednesday 5 March, b (200, 2 weeks) and c (300, 4 weeks) on Wednesday 26 March; wf buys 100
-- for 2 weeks on 5 March and is frozen. A plain rule for these: no base, factor 1, one tier ×1 within ±50, so a holding
-- moves by the index's change. The index moves on 7 March +2%, 12 March −1.5%, 31 March +3%, 8 April −0.8% (the day
-- that may be missing), 14 April −2%, 22 April +1%, and not at all on the other trading days; Friday 4 April is a holiday.
savepoint jobs;
insert into terms (name, starts_on, ends_on) values ('春季', '2025-03-03', '2025-03-30'), ('夏季', '2025-04-14', '2025-05-11');
update job_runs set done_to = '2025-03-02', last_ok = null, last_err = null;
update settings set value = '{"symbol":"sh000300","name":"沪深 300","factor":1,"base":{"2":0,"4":0,"12":0,"24":0,"48":0},"tiers":[{"key":"plain","name":"测试","multiplier":1,"min":-50,"max":50}]}'
where key = 'wealth_params';
create function tests.old(p_no text, p_opening integer) returns void language plpgsql as $$
begin
  perform tests.student(p_no, 0);
  update students set opened_at = tests.at('2025-03-01 08:00') where student_no = p_no;
  update accounts set balance = p_opening, total_in = p_opening where student_no = p_no;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
  values (gen_random_uuid(), 'opening', p_no, p_opening, p_opening, p_opening, (select id from profiles where login_id = 'teacher'), tests.at('2025-03-01 08:00'));
end $$;
create function tests.buy(p_id text, p_no text, p_amount integer, p_weeks integer, p_at text) returns void language sql as $$
  select app_private.start_wealth(('00000000-0000-4000-8000-0000000000' || p_id)::uuid, p_no, p_amount, p_weeks, 'plain', (select id from profiles where login_id = 't1'), tests.at(p_at))
$$;
-- The trading days from 3 March to p_to, as the fetch would have them.
create function tests.days(p_to date) returns void language sql as $$
  insert into wealth_days (day, change, source, params)
  select d::date, coalesce(c, 0), 'tencent', '{}'
  from generate_series('2025-03-03'::date, p_to, interval '1 day') d
    left join (values ('2025-03-07'::date, 2), ('2025-03-12', -1.5), ('2025-03-31', 3), ('2025-04-08', -0.8), ('2025-04-14', -2), ('2025-04-22', 1)) x(day, c)
      on x.day = d::date
  where extract(isodow from d) <= 5 and d::date <> '2025-04-04'
  on conflict do nothing
$$;
select tests.old('w1', 1000);
select tests.old('wf', 100);
select tests.buy('a1', 'w1', 100, 2, '2025-03-05 12:00');
select tests.buy('f1', 'wf', 100, 2, '2025-03-05 12:00');
update students set status = 'frozen' where student_no = 'wf';
select tests.buy('b1', 'w1', 200, 2, '2025-03-26 12:00');
select tests.buy('c1', 'w1', 300, 4, '2025-03-26 12:00');
select is(array(select concat_ws(' ', id, principal, weeks, opened_on, starts_on, matures_on, value_centi, valued_to, status) from wealth_holdings order by id),
  array['00000000-0000-4000-8000-0000000000a1 100 2 2025-03-05 2025-03-06 2025-03-19 10000 2025-03-06 open',
    '00000000-0000-4000-8000-0000000000b1 200 2 2025-03-26 2025-03-27 2025-04-09 20000 2025-03-27 open',
    '00000000-0000-4000-8000-0000000000c1 300 4 2025-03-26 2025-03-27 2025-04-23 30000 2025-03-27 open',
    '00000000-0000-4000-8000-0000000000f1 100 2 2025-03-05 2025-03-06 2025-03-19 10000 2025-03-06 open'],
  'from the next day for 7 × weeks days, maturing when 定期 of the length would; the value starts at the principal');
select is(array(select concat_ws(' ', student_no, balance, wealth_total) from accounts order by student_no), array['w1 400 600', 'wf 0 100'],
  '活期 goes into 理财');
select is((select reason from txns where wealth_id = '00000000-0000-4000-8000-0000000000c1'), '4 周 · 测试 ×1，4月23日 到期', 'the wealth_buy says the length, the tier and the last day');

create function tests.state() returns text language sql as $$
  select concat_ws(' | ',
    (select string_agg(concat_ws(' ', id, value_centi, valued_to, status), ', ' order by id) from wealth_holdings),
    (select string_agg(concat_ws(' ', student_no, type, amount, balance_after, reason, created_at), ', ' order by student_no, created_at, type)
       from txns where type in ('interest', 'wealth_close')),
    (select string_agg(concat_ws(' ', week_start, deposits, anchor), ', ' order by week_start) from rate_weeks),
    (select string_agg(concat_ws(' ', student_no, rule, delta, at), ', ' order by student_no, id) from credit_events),
    (select string_agg(concat_ws(' ', student_no, interest_carry, balance, wealth_total), ', ' order by student_no) from accounts))
$$;
savepoint every_day;
do $$
declare d date;
begin
  for d in select generate_series('2025-03-03'::date, '2025-04-30', interval '1 day') loop
    perform tests.days(d - 1);   -- each trading day's close is in by the next 00:05
    perform app_private.run_jobs(d);
  end loop;
end $$;
select tests.state() as every_day \gset
rollback to savepoint every_day;
savepoint catch_up;
select tests.days('2025-04-29');
select is(app_private.run_jobs('2025-04-30') -> 'failed', 'null', 'catching up the whole term and the holidays at once');
select is(tests.state(), :'every_day', 'gives the same values, maturities, interest, anchors, scores and balances as every day on time');
select is(array(select concat_ws(' ', h.id, h.value_centi, h.status, t.created_at, t.reason, t.operator_id = app_private.system_user())
    from wealth_holdings h join txns t on t.id = h.close_txn order by h.id),
  array[concat_ws(' ', '00000000-0000-4000-8000-0000000000a1', 10047, 'matured', tests.at('2025-03-20'), '到期，盈 +0.47 HTB', true),
    concat_ws(' ', '00000000-0000-4000-8000-0000000000b1', 20435, 'matured', tests.at('2025-04-10'), '到期，盈 +4.35 HTB', true),
    concat_ws(' ', '00000000-0000-4000-8000-0000000000c1', 30340, 'matured', tests.at('2025-04-24'), '到期，盈 +3.40 HTB', true),
    concat_ws(' ', '00000000-0000-4000-8000-0000000000f1', 10047, 'matured', tests.at('2025-03-20'), '到期，盈 +0.47 HTB', true)],
  'each day in order to 0.01 HTB (10000 × 1.02 × 0.985), the holiday and weekends at the base; matured at the end of its last day, in term or in the holidays, the frozen one too');
select is((select concat_ws(' ', amount, balance_after) from txns where wealth_id = '00000000-0000-4000-8000-0000000000f1' and type = 'wealth_close'), '100 100',
  'the whole HTB back to 活期');
select is(array(select concat_ws(' ', status, matures_on, closed_on) from wealth_holdings order by id),
  array['matured 2025-03-19 2025-03-20', 'matured 2025-04-09 2025-04-10', 'matured 2025-04-23 2025-04-24', 'matured 2025-03-19 2025-03-20'],
  'closed_on: the day each came back to 活期, the day after its last');
select is((select interest_carry from accounts where student_no = 'wf'), 47, 'and the 0.47 kept as 零头');
select is((select deposits from rate_weeks where week_start = '2025-03-10'), 1100, '存款余额 for the anchor counts 理财本金: every opening, still 1100');
select is(count(*)::int, 0, 'the ledger checks out, 理财 with the interest') from app_private.check_balances();
rollback to savepoint catch_up;

-- 8 April and after missing: b and c wait at 8 April, b past its last day; a and f mature as before.
select tests.days('2025-04-07');
select is(app_private.run_jobs('2025-04-25') -> 'failed', 'null', 'a trading day missing stops no job');
select is(array(select concat_ws(' ', id, value_centi, valued_to, status) from wealth_holdings where id::text like '%b1' or id::text like '%c1' order by id),
  array['00000000-0000-4000-8000-0000000000b1 20600 2025-04-08 open', '00000000-0000-4000-8000-0000000000c1 30900 2025-04-08 open'],
  'the holdings that need it wait there, past the last day too; the holiday and the weekend before it went by at the base');
select is(tests.call(:'accountant', 'select wealth_overview()') -> 'missing' -> 0, '"2025-04-08"', 'the 理财 page lists the weekdays missing, the first first');
select is(jsonb_array_length(tests.call(:'accountant', 'select wealth_overview()') -> 'missing'), 12, 'every weekday b and c still need');
select is(jsonb_path_query_array(tests.call(:'accountant', $$select wealth_overview('2025-04-09', 7)$$) -> 'days', '$[*].status'),
  '["pending","open","closed","closed","closed","open","open"]',
  'the days before 9 April, newest first: 8 April pending, the holiday and the weekend closed, the trading days open');
select is(jsonb_path_query_array(tests.call(:'accountant', $$select wealth_overview('2025-04-09', 7)$$) -> 'days', '$[*].source_name'),
  '["待登记","腾讯行情","休市","休市","休市","腾讯行情","腾讯行情"]', 'each with the name of its source');
select is((tests.call(:'accountant', $$select wealth_overview('2025-04-09', 7)$$) -> 'days' -> 3) - 'created_at',
  '{"day":"2025-04-05","status":"closed","close":null,"prev_close":null,"change":null,"source":"closed","source_name":"休市","note":null,"created_by_name":null,
    "rates":{"2":{"plain":0},"4":{"plain":0},"12":{"plain":0},"24":{"plain":0},"48":{"plain":0}}}',
  'a closed day at the base, which is 0 here');
select is(tests.call(:'accountant', $$select wealth_overview('2025-04-09', 7)$$) -> 'days' -> 0 -> 'rates', 'null', 'none while pending');
select is(jsonb_path_query_array(tests.call(:'accountant', $$select wealth_overview('2025-03-04', 3)$$) -> 'days', '$[*].status'), '["open","none","none"]',
  'nothing before the first close on record');
select is(tests.call(:'accountant', $$select wealth_overview(null, 0)$$) ->> 'detail', '{"field": "limit"}', '1 to 366 days at a time');
select is(tests.call(:'teacher', 'select wealth_overview()') -> 'open', '{"count": 2, "principal": 500, "value_centi": 51500}', 'and the holdings open');
select tests.call(:'teacher', $$select record_wealth_day('2025-04-08', -0.8, '中证指数官网收盘行情')$$) as entered \gset
select is(:'entered'::jsonb - 'created_at', jsonb_build_object('day', '2025-04-08', 'close', null, 'prev_close', null, 'change', -0.8,
  'source', 'manual', 'note', '中证指数官网收盘行情', 'created_by', :'teacher'), 'the bank admin enters the day''s change by hand');
select tests.days('2025-04-29');
select is(app_private.run_jobs('2025-04-30') -> 'failed', 'null', 'the next jobs, the closes in again');
select is(array(select concat_ws(' ', id, value_centi, status) from wealth_holdings where id::text like '%b1' or id::text like '%c1' order by id),
  array['00000000-0000-4000-8000-0000000000b1 20435 matured', '00000000-0000-4000-8000-0000000000c1 30340 matured'], 'apply it and the days after, then mature');
select is((select created_at from txns where wealth_id = '00000000-0000-4000-8000-0000000000b1' and type = 'wealth_close'), tests.at('2025-04-26'),
  'b at the end of the first day after');
select is(tests.call(:'accountant', 'select wealth_overview()') -> 'missing', '[]', 'nothing missing');
select is(tests.call(:'teacher', $$select record_wealth_day('2025-04-08', 1, 'x')$$) ->> 'error', 'ALREADY_EXISTS', 'a day entered is never changed');
select is(tests.call(:'teacher', format('select record_wealth_day(%L, %s, %L)', w, r, n)) ->> 'detail', d, why)
from (values ('2025-04-12', '1', 'x', '{"field": "day"}', 'a weekday'), (:'today', '1', 'x', '{"field": "day"}', 'a day over'),
  ('2025-03-03', '50.5', 'x', '{"field": "change"}', '−50 to 50'), ('2025-03-03', '1.00001', 'x', '{"field": "change"}', 'up to 4 decimals'),
  ('2025-03-03', '1', ' ', '{"field": "note"}', 'where it came from')) t(w, r, n, d, why);
select is(tests.err(w, $$select record_wealth_day('2025-03-03', 1, 'x')$$), 'FORBIDDEN', 'the bank admin and the president alone')
from unnest(array[:'accountant', :'teller', :'ops']::uuid[]) w;
select is(tests.call(:'president', $$select record_wealth_day('2025-02-28', 1, 'x')$$) ->> 'source', 'manual', 'the president too');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
rollback to savepoint jobs;

-- The tiers (§10.10) at the defaults: 100 each in 稳健, 平衡 and 进取 for 2 weeks, bought on Wednesday 5 March 2025; the
-- index +1% on 6 March, −3% on 7 March (each tier at its lower bound), then flat. A change to wealth_params after they were
-- bought moves none of them.
savepoint tiers;
select tests.student('tier', 300);
select app_private.start_wealth(('00000000-0000-4000-8000-0000000000e' || i)::uuid, 'tier', 100, 2, k, :'teller', '2025-03-05 12:00+08') is not null
from unnest(array['steady', 'balanced', 'bold']) with ordinality x(k, i);
select is(array(select concat_ws(' ', tier, tier_name, multiplier, factor, base, min_rate, max_rate) from wealth_holdings where student_no = 'tier' order by id),
  array['steady 稳健 1.0000 2.0000 3.9230 -5.0000 5.0000', 'balanced 平衡 2.0000 2.0000 3.9230 -10.0000 10.0000', 'bold 进取 4.0000 2.0000 3.9230 -20.0000 20.0000'],
  'each locks its tier, the factor and the weekly base of its length');
select is(array(select reason from txns where student_no = 'tier' and type = 'wealth_buy' order by wealth_id),
  array['2 周 · 稳健 ×1，3月19日 到期', '2 周 · 平衡 ×2，3月19日 到期', '2 周 · 进取 ×4，3月19日 到期'], 'the wealth_buy says the tier');
update settings set value = jsonb_set(value, '{factor}', '1') where key = 'wealth_params';
insert into wealth_days (day, change, source, params)
select d::date, case d::date when '2025-03-06' then 1 when '2025-03-07' then -3 else 0 end, 'tencent', '{}'
from generate_series('2025-03-06'::date, '2025-03-20', interval '1 day') d where extract(isodow from d) <= 5;
select is(app_private.value_wealth('2025-03-19'), 42, 'fourteen days each');
select is(array(select value_centi from wealth_holdings where student_no = 'tier' order by id), array[10407, 10051, 9276],
  'more won, more lost: 稳健 ×1.025512 ×0.95, 平衡 ×1.045512 ×0.90, 进取 ×1.085512 ×0.80 (each at its lower bound on 7 March), then 12 days at 0.5512%');
select is(app_private.mature_wealth('2025-03-19'), 3, 'all mature');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
rollback to savepoint tiers;

-- At the counter today.
select tests.student('s1', 500) as s1 \gset
select tests.student('s2', 100) as s2 \gset
select tests.student('frz', 100);
update students set status = 'frozen' where student_no = 'frz';
select tests.student('pay', 100);
insert into staff_payroll (user_id, account) values (:'teller', 'pay');

select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d1', 's1', 100, 12, 'bold')$$) as bought \gset
select is(:'bought'::jsonb - 'id' - 'txn_no' - 'created_at' - 'holding',
  '{"type":"wealth_buy","amount":100,"balance_after":400,"denominations":null,"change_given":null}', '买理财: 100 out of 活期');
select is((:'bought'::jsonb -> 'holding') - 'open_txn',
  jsonb_build_object('id', '00000000-0000-4000-8000-0000000000d1', 'student_no', 's1', 'principal', 100, 'weeks', 12, 'opened_on', :'today'::date,
    'starts_on', :'today'::date + 1, 'matures_on', :'today'::date + 84, 'value_centi', 10000, 'valued_to', :'today'::date + 1, 'status', 'open',
    'close_txn', null, 'closed_on', null, 'tier', 'bold', 'tier_name', '进取', 'multiplier', 4, 'factor', 2, 'base', 3.6637, 'min_rate', -20, 'max_rate', 20),
  'a 12 week 进取 holding from tomorrow, its weekly base, factor and tier locked');
select is((select concat_ws(' ', balance_delta, cash_delta, wealth_id, operator_id = :'teller', reason) from txns where id = (:'bought'::jsonb ->> 'id')::uuid),
  concat_ws(' ', -100, 0, '00000000-0000-4000-8000-0000000000d1', true, '12 周 · 进取 ×4，' || to_char(:'today'::date + 84, 'FMMM月FMDD日') || ' 到期'),
  'no cash moves; the length, the tier and the last day');
select is(tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d1', 's1', 100, 12, 'bold')$$) ->> 'id', :'bought'::jsonb ->> 'id',
  'sent again, the same result');
select is(tests.call(:'teller', $$select buy_wealth(gen_random_uuid(), 's1', 401, 2, 'steady')$$),
  '{"error":"INSUFFICIENT_BALANCE","detail":"{\"short\": 1, \"balance\": 400}"}', 'not more than 活期');
select is(tests.err(:'teller', format('select buy_wealth(gen_random_uuid(), %L, %s, %s, %L)', n, a, w, coalesce(k, 'steady'))), e, why)
from (values ('s1', 0, 2, null, 'INVALID_AMOUNT', '1 HTB or more'), ('s1', 10, 8, null, 'INVALID_INPUT', '2, 4, 12, 24 or 48 weeks'),
  ('s1', 10, 2, 'wild', 'INVALID_INPUT', 'a tier of wealth_params'),
  ('frz', 10, 2, null, 'STUDENT_INACTIVE', 'an account in use'), ('pay', 10, 2, null, 'SELF_SERVICE_FORBIDDEN', 'not the teller''s own pay account'),
  ('nobody', 10, 2, null, 'STUDENT_NOT_FOUND', 'a student that exists')) t(n, a, w, k, e, why);
select is(tests.err(w, $$select buy_wealth(gen_random_uuid(), 's1', 10, 2, 'steady')$$), 'FORBIDDEN', 'the counter''s alone')
from unnest(array[:'president', :'teacher', :'accountant', :'s1']::uuid[]) w;
update duty set ended_at = now(), txns = 0 where user_id = :'teller2';
select is(tests.err(:'teller2', $$select buy_wealth(gen_random_uuid(), 's1', 10, 2, 'steady')$$), 'OFF_DUTY', 'on duty');
savepoint loan;
select app_private.start_loan(gen_random_uuid(), 's2', 10, '测试', 'bullet', 1, 'account', :'teller', now()) is not null;
select is(tests.err(:'teller', $$select buy_wealth(gen_random_uuid(), 's2', 10, 2, 'steady')$$), 'LOAN_OUTSTANDING', 'none while a loan is not paid off');
rollback to savepoint loan;

-- The quote and 查询.
-- Yesterday's close, as dolphin-jobs would have fetched it (a row already fetched stays).
insert into wealth_days (day, change, source, params) values (:'today'::date - 1, 1.25, 'tencent', '{}') on conflict do nothing;
select day as last_day, change as last_change from wealth_days order by day desc limit 1 \gset
select change as yday_change from wealth_days where day = :'today'::date - 1 \gset
select is(tests.call(:'teller', 'select wealth_quote(''s1'')') -> 'today',
  jsonb_build_object('day', :'today'::date, 'closed', case when exists (select 1 from wealth_days where day = :'today'::date) then false
    when extract(isodow from :'today'::date) >= 6 then true end), 'today: closed on a weekend, open once its close is in, null until then');
select is(tests.call(:'teller', 'select wealth_quote(''s1'')') - 'holdings' - 'latest' - 'recent' - 'today',
  jsonb_build_object('student_no', 's1', 'index', jsonb_build_object('symbol', 'sh000300', 'name', '沪深 300'), 'factor', 2,
    'tiers', app_private.setting('wealth_params') -> 'tiers',
    'options', (select jsonb_agg(jsonb_build_object('weeks', w, 'starts_on', :'today'::date + 1, 'matures_on', :'today'::date + 7 * w, 'base', b, 'day_base', db,
        'tiers', jsonb_build_array(
          jsonb_build_object('key', 'steady', 'name', '稳健', 'multiplier', 1, 'rate', least(5, greatest(-5, db + 2 * :last_change)), 'min', -5, 'max', 5),
          jsonb_build_object('key', 'balanced', 'name', '平衡', 'multiplier', 2, 'rate', least(10, greatest(-10, db + 4 * :last_change)), 'min', -10, 'max', 10),
          jsonb_build_object('key', 'bold', 'name', '进取', 'multiplier', 4, 'rate', least(20, greatest(-20, db + 8 * :last_change)), 'min', -20, 'max', 20)))
        order by w)
      from (values (2, 3.923, 0.5512), (4, 4.0031, 0.5623), (12, 3.6637, 0.5153), (24, 3.2208, 0.4539), (48, 2.5823, 0.3649)) x(w, b, db)),
    'balance', 400, 'wealth_total', 100),
  'the quote: the index, the tiers, each length from tomorrow with its weekly and daily base and each tier''s name, multiple, rate on the latest change and daily bounds');
select is(tests.call(:'accountant', 'select wealth_overview()') -> 'days' -> 0 -> 'rates' -> '12',
  jsonb_build_object('steady', least(5, greatest(-5, 0.5153 + 2 * :yday_change)), 'balanced', least(10, greatest(-10, 0.5153 + 4 * :yday_change)),
    'bold', least(20, greatest(-20, 0.5153 + 8 * :yday_change))), 'the 理财 page has each length''s and tier''s rate of every day, yesterday first');
select is(tests.call(:'accountant', 'select wealth_overview()') -> 'params' -> 'day_base', '{"2":0.5512,"4":0.5623,"12":0.5153,"24":0.4539,"48":0.3649}',
  'and each length''s daily base');
select is(jsonb_array_length(tests.call(:'accountant', 'select wealth_overview()') -> 'days'), 30, '30 days at first');
select is(tests.call(:'teller', 'select wealth_quote(''s1'')') #>> '{latest,day}', :'last_day', 'latest is the latest trading day');
select is(tests.call(:'teller', 'select wealth_quote(''s1'')') -> 'latest' ->> 'source_name', '腾讯行情', 'with its source''s name');
select is(jsonb_array_length(tests.call(:'teller', 'select wealth_quote(''s1'')') -> 'holdings'), 1, 'and the student''s holdings');
select is(tests.call(:'teller', 'select wealth_quote(''s1'')') -> 'recent', app_private.wealth_recent(10), 'and the latest 10 trading days');
select is(tests.err(:'teller', 'select wealth_quote(''pay'')'), 'SELF_SERVICE_FORBIDDEN', 'not of the teller''s own pay account');
select is(tests.err(w, 'select wealth_quote(''s1'')'), 'FORBIDDEN', 'the quote is the counter''s') from unnest(array[:'teacher', :'s1']::uuid[]) w;
update wealth_holdings set value_centi = 10350, valued_to = :'today'::date + 8 where id = '00000000-0000-4000-8000-0000000000d1';
select is(tests.call(:'teller', 'select lookup_student(''s1'')') - 'credit' - 'name' - 'division' - 'cohort' - 'class_no' - 'grade' - 'class_label'
  - 'status' - 'withdrawn_today' - 'loan_remaining' - 'loan_overdue',
  '{"student_no":"s1","balance":400,"term_total":0,"wealth_total":100,"wealth_value_centi":10350}', '查询 shows 理财本金 and its value');

-- 赎回 (§10.10) at the value: 103.50 pays 103 HTB and keeps 0.50.
select tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d1')$$) as redeemed \gset
select is(:'redeemed'::jsonb - 'id' - 'txn_no' - 'created_at' - 'holding',
  '{"type":"wealth_close","amount":103,"balance_after":503,"denominations":null,"change_given":null}', '103 back to 活期');
select is(:'redeemed'::jsonb #>> '{holding,closed_on}', :'today', 'closed_on: the day of the 赎回');
select is((tests.call(:'teller', 'select wealth_quote(''s1'')') -> 'holdings' -> 0) ->> 'closed_on', :'today', 'and the counter''s quote carries it');
select is(concat_ws(' ', :'redeemed'::jsonb #>> '{holding,status}', :'redeemed'::jsonb #>> '{holding,value_centi}'), 'redeemed 10350', '已赎回 at 103.50');
select is((select concat_ws(' ', balance, wealth_total, interest_carry) from accounts where student_no = 's1'), '503 0 50', 'the 0.50 kept as 零头');
select is((select reason from txns where id = (:'redeemed'::jsonb ->> 'id')::uuid), '赎回，盈 +3.50 HTB', 'the wealth_close says 赎回 and the gain');
select is(tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d1')$$) ->> 'id', :'redeemed'::jsonb ->> 'id', 'sent again, the same result');
select is(tests.err(:'teller', $$select redeem_wealth(gen_random_uuid())$$), 'INVALID_INPUT', 'a holding that exists');
select is(tests.err(w, $$select redeem_wealth('00000000-0000-4000-8000-0000000000d1')$$), 'FORBIDDEN', 'the counter''s alone')
from unnest(array[:'president', :'teacher', :'s1']::uuid[]) w;

-- 冲正 (§10.9): the teller does not reverse 赎回; the bank admin does, the holding open again at 103.50.
select is(tests.err(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''业务选错'')', :'redeemed'::jsonb ->> 'id')), 'REVERSAL_NOT_ALLOWED',
  'the teller does not reverse 赎回');
select is(tests.call(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''业务选错'')', :'redeemed'::jsonb ->> 'id')) - 'id' - 'txn_no' - 'created_at',
  '{"type":"reversal","amount":103,"balance_after":400,"denominations":null,"change_given":null}', 'the bank admin does: the 103 back out');
select is((select concat_ws(' ', a.balance, a.wealth_total, a.interest_carry, h.status, h.value_centi, h.close_txn is null)
    from accounts a join wealth_holdings h using (student_no) where a.student_no = 's1'), '400 100 0 open 10350 t', 'the holding as it was, the 零头 too');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
select is((select closed_on from wealth_holdings where id = '00000000-0000-4000-8000-0000000000d1'), null, 'open again, no closed_on');
select is(tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d1')$$) ->> 'amount', '103', 'it can be redeemed again');

-- A loss: 50 worth 46.50 pays the 0.50 零头 and 46.50, 47 HTB.
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d2', 's1', 50, 2, 'steady')$$) is not null;
update wealth_holdings set value_centi = 4650 where id = '00000000-0000-4000-8000-0000000000d2';
select is(tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d2')$$) ->> 'amount', '47', 'a loss pays less than the principal');
select is((select reason from txns where wealth_id = '00000000-0000-4000-8000-0000000000d2' and type = 'wealth_close'), '赎回，亏 −3.50 HTB', 'and says so');
select is(tests.err(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d2')$$) , null, 'sent again, the same result');

-- 1 HTB worth 0.95 with no 零头 pays 0 HTB: the 0.95 waits as 零头.
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d6', 's2', 1, 2, 'steady')$$) is not null;
update wealth_holdings set value_centi = 95 where id = '00000000-0000-4000-8000-0000000000d6';
select is(tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d6')$$) - 'id' - 'txn_no' - 'created_at' - 'holding',
  '{"type":"wealth_close","amount":0,"balance_after":99,"denominations":null,"change_given":null}', 'less than 1 HTB back: 0 to 活期');
select is((select concat_ws(' ', interest_carry, wealth_total) from accounts where student_no = 's2'), '95 0', 'and the value kept as 零头');
select is(tests.call(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''业务选错'')',
  (select close_txn from wealth_holdings where id = '00000000-0000-4000-8000-0000000000d6'))) ->> 'amount', '0', 'its reversal takes the 0.95 back out of the 零头');
select is((select concat_ws(' ', a.balance, a.interest_carry, a.wealth_total, h.status) from accounts a join wealth_holdings h using (student_no) where a.student_no = 's2'),
  '99 0 1 open', 'the holding open again');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- 买理财 reversed by the teller the same day; not once a week has been applied.
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d3', 's1', 20, 4, 'steady')$$) as third \gset
select is(tests.err(:'teller2', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'third'::jsonb ->> 'id')), 'REVERSAL_NOT_ALLOWED',
  'a teller reverses only their own');
select is(tests.call(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'third'::jsonb ->> 'id')) ->> 'amount', '20',
  'their own of today: the principal back to 活期');
select is((select concat_ws(' ', h.status, a.wealth_total) from wealth_holdings h join accounts a using (student_no) where h.id = '00000000-0000-4000-8000-0000000000d3'),
  'reversed 0', 'the holding void');
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d4', 's1', 10, 2, 'steady')$$) as fourth \gset
update wealth_holdings set valued_to = valued_to + 1, value_centi = 1020 where id = '00000000-0000-4000-8000-0000000000d4';
select is(tests.err(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'fourth'::jsonb ->> 'id')), 'REVERSAL_NOT_ALLOWED',
  'not once a day has moved it');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- A frozen account keeps its holding and cannot redeem it.
select app_private.start_wealth('00000000-0000-4000-8000-0000000000d5', 'frz', 10, 2, 'steady', :'teller', now()) is not null;
select is(tests.err(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d5')$$), 'STUDENT_INACTIVE', 'no 赎回 while frozen');

-- Who reads what (§3, §16).
select is(tests.call(:'s1', 'select count(*) from wealth_holdings'), '4', 'a student reads their own holdings');
select is(tests.call(:'s2', 'select count(*) from wealth_holdings'), '1', 'only their own');
select is(tests.call(w, 'select count(*) from wealth_holdings'), '6', 'the accountant, president and bank admin everyone''s')
from unnest(array[:'accountant', :'president', :'teacher']::uuid[]) w;
select is(tests.call(w, 'select count(*) from wealth_holdings'), '0', 'the others none, the counter through wealth_quote')
from unnest(array[:'teller', :'ops']::uuid[]) w;
select is(tests.call(w, 'select to_jsonb(count(*) = (select count(*) from wealth_days)) from wealth_days'), 'true', 'everyone reads the daily closes')
from unnest(array[:'s1', :'teller', :'ops']::uuid[]) w;
select is(tests.err(w, 'select wealth_overview()'), 'FORBIDDEN', 'the 理财 page is the back office''s') from unnest(array[:'teller', :'s1', :'ops']::uuid[]) w;

-- 排名 (§16.3) by 活期 + 定期 + 理财本金: ra keeps 100 of its 150 in 理财 and still comes first.
select tests.student('ra', 150, null, 'junior') as ra \gset
select tests.student('rb', 120, null, 'junior') as rb \gset
select tests.call(:'teller', $$select buy_wealth(gen_random_uuid(), 'ra', 100, 2, 'steady')$$) is not null;
select is(jsonb_path_query_array(tests.call(:'rb', 'select deposit_ranking()') -> 'top', '$[*].balance'), '[150, 120]', 'ranked with the 理财本金');

-- 注销 (P1 §6.4): the holdings open are redeemed at their value and leave with the balance.
update wealth_holdings set value_centi = 10123 where student_no = 'ra';
select is(tests.call(:'teacher', format('select close_accounts(array[%L]::uuid[])', :'ra')), '{"closed":1,"cleared":151}', '注销 clears 活期 and 理财');
select is(array(select concat_ws(' ', type, amount, reason) from txns where student_no = 'ra' and type in ('wealth_close', 'closing') order by seq),
  array['wealth_close 101 赎回，盈 +1.23 HTB', 'closing 151 注销账号'], 'redeemed first, then the whole balance');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- The self-check (§14.1) finds a 理财本金合计 that does not match the holdings open.
update accounts set wealth_total = wealth_total + 5 where student_no = 's1';
select is(array(select concat_ws(' ', kind, key, recorded, expected) from app_private.check_balances()), array['wealth s1 15 10'],
  'check_balances: wealth_total against the principal open');

select * from finish();
rollback;
