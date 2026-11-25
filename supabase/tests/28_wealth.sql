-- 按期限买入的理财 (PHASE-2.md §10.10, §13, §14, §17): the holdings bought for a term before the six products, by 沪深 300's
-- daily closes from Tencent, Sina and eastmoney and by hand; the rate of a day by length and tier; the jobs on fixed days
-- in 2025 (every day applied in order, weekends and a holiday at the base, maturity in the school holidays, a trading day
-- missing holding the holdings up until it is entered, a catch-up against every day on time). The products are in
-- 47_wealth_products.sql.
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

-- The parameters such a holding was bought under: 沪深 300; the weekly base of each length such that an index that never
-- moves pays what the 定期 of the length plus 1.5 points pays in simple interest; factor 2; three tiers with daily bounds.
create function tests.old_params() returns jsonb language sql as $$
  select '{"symbol":"sh000300","name":"沪深 300","factor":2,"base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},"tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},{"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},{"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}'::jsonb
$$;
-- A holding bought for a term at p_at under p (as start_wealth did): from the next day for 7 × p_weeks days.
create function tests.term(p_id uuid, p_no text, p_amount integer, p_weeks integer, p_tier text, p_at timestamptz, p jsonb default tests.old_params())
returns void language plpgsql as $$
declare
  v_day date := app_private.cn_date(p_at);
  v_tier jsonb := (select t from jsonb_array_elements(p -> 'tiers') t where t ->> 'key' = p_tier);
  v_txn uuid := gen_random_uuid();
  v_balance integer;
begin
  update accounts set balance = balance - p_amount, wealth_total = wealth_total + p_amount where student_no = p_no returning balance into v_balance;
  insert into wealth_holdings (id, student_no, principal, product, weeks, opened_on, starts_on, matures_on, value_centi, valued_to, open_txn,
    tier, tier_name, multiplier, factor, base, min_rate, max_rate)
  values (p_id, p_no, p_amount, 'csi300', p_weeks, v_day, v_day + 1, v_day + 7 * p_weeks, 100 * p_amount, v_day + 1, v_txn,
    p_tier, v_tier ->> 'name', (v_tier ->> 'multiplier')::numeric, (p ->> 'factor')::numeric,
    (p -> 'base' ->> p_weeks::text)::numeric, (v_tier ->> 'min')::numeric, (v_tier ->> 'max')::numeric);
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, wealth_id, created_at)
  values (v_txn, 'wealth_buy', p_no, p_amount, -p_amount, v_balance, p_weeks || ' 周', (select id from profiles where login_id = 't1'), p_id, p_at);
end $$;

select is(array(select round(((1 + ((app_private.setting('term_rates') ->> w::text)::numeric + 1.5) * w / 100) ^ (1.0 / w) - 1) * 100, 4)
  from unnest(array[2, 4, 12, 24, 48]) w),
  array(select (tests.old_params() -> 'base' ->> w::text)::numeric from unnest(array[2, 4, 12, 24, 48]) w),
  'weekly base = (1 + (定期 rate + 1.5) × weeks / 100)^(1 / weeks) − 1');
select is(array(select app_private.day_base((tests.old_params() -> 'base' ->> w::text)::numeric) from unnest(array[2, 4, 12, 24, 48]) w),
  array[0.5512, 0.5623, 0.5153, 0.4539, 0.3649]::numeric[], 'the daily base: (1 + weekly)^(1/7) − 1');
create function tests.hold(p_weeks integer, p_tier jsonb) returns wealth_holdings language sql as $$
  select row(null, null, 1, p_weeks, null, null, null, 10000, null, 'open', null, null, p_tier ->> 'key', p_tier ->> 'name', (p_tier ->> 'multiplier')::numeric,
    2, (tests.old_params() -> 'base' ->> p_weeks::text)::numeric, (p_tier ->> 'min')::numeric, (p_tier ->> 'max')::numeric, null, 'csi300', null)::wealth_holdings
$$;
select is(array(select app_private.holding_rate(tests.hold(2, t), c)
  from jsonb_array_elements(tests.old_params() -> 'tiers') with ordinality x(t, i), unnest(array[1, -1, 3, -3, 0]) with ordinality y(c, j)
  order by i, j), array[2.5512, -1.4488, 5, -5, 0.5512, 4.5512, -3.4488, 10, -10, 0.5512, 8.5512, -7.4488, 20, -20, 0.5512]::numeric[],
  'a day of +1% / −1% / +3% / −3% / closed for 2 weeks: 稳健 2, 平衡 4, 进取 8 times the index on the daily base, within ±5 / ±10 / ±20');
-- Under the defaults an index that never moves pays 108 / 117 / 154 / 214 / 340 HTB on 100 HTB.
select is(array(select (with recursive v(n, c) as (select 0, 10000::numeric union all
    select n + 1, round(c * (100 + app_private.day_base((tests.old_params() -> 'base' ->> w::text)::numeric)) / 100) from v where n < 7 * w)
  select round(c / 100) from v where n = 7 * w) from unnest(array[2, 4, 12, 24, 48]) w), array[108, 117, 154, 214, 340]::numeric[],
  'flat, each length ends 1.5 points a week of simple interest above its 定期');

-- The daily closes (§10.10): each trading day with the one before it in the list, today's from 15:30; the first in the
-- list has nothing to compare with; a day already in is kept.
savepoint closes;
select is(app_private.record_wealth_days('csi300', 'tencent',
  '{"code":0,"data":{"sh000300":{"day":[["2025-03-03","3900","3900.00","3910","3890","1"],["2025-03-04","3900","3939.00","3950","3890","1"],["2025-03-05","3939","3919.305","3950","3900","1"]]}}}',
  tests.at('2025-03-05 15:00')), 1, 'Tencent: 4 March in; 5 March waits for 15:30');
select is(app_private.record_wealth_days('csi300', 'sina',
  '[{"day":"2025-03-04","close":"3939.000"},{"day":"2025-03-05","close":"3919.305"},{"day":"2025-03-07","close":"3958.498"}]', tests.at('2025-03-07 15:30')), 2,
  'Sina: 5 and 7 March from 15:30');
select is(app_private.record_wealth_days('csi300', 'tencent', '{"data":{"sh000300":{"day":[["2025-03-03","1","3000"],["2025-03-04","1","9999"]]}}}', tests.at('2025-03-12 09:00')), 0,
  'a day already in is kept as it was');
select is(app_private.record_wealth_days('csi300', 'eastmoney', '{"data":{"klines":["2025-03-07,3958.50","2025-03-10,3919.10"]}}', tests.at('2025-03-11 09:00')), 1,
  'eastmoney: 10 March');
select is(array(select concat_ws(' ', day, close, prev_close, change, source, created_by is null) from wealth_days where product = 'csi300' and day < '2025-06-01' order by day),
  array['2025-03-04 3939.0000 3900.0000 1.0000 tencent t', '2025-03-05 3919.3050 3939.0000 -0.5000 sina t', '2025-03-07 3958.4980 3919.3050 1.0000 sina t',
    '2025-03-10 3919.1000 3958.5000 -0.9953 eastmoney t'], 'each with its close, the close before and the change');
select is(array(select coalesce(app_private.wealth_day_change('csi300', d::date)::text, 'null') from generate_series('2025-03-04'::date, '2025-03-11', interval '1 day') d),
  array['1.0000', '-0.5000', '0', '1.0000', '0', '0', '-0.9953', 'null'],
  'a weekday without a close and a later trading day in (6 March) is closed, as are weekends; 11 March is not known yet');
select throws_ok($$select app_private.record_wealth_days('csi300', 'tencent', '{"code":0,"data":{}}')$$, 'no daily closes of csi300 from tencent');
select throws_ok($$select app_private.record_wealth_days('csi300', 'sina', '[{"day":"2025-03-28","close":"x"}]')$$);
select throws_ok($$update wealth_days set change = 0$$, '42501', null, 'a day entered is never changed');
rollback to savepoint closes;

-- The jobs (§10.10, §13) from Monday 3 March 2025: 春季 to Sunday 30 March, school holidays, 夏季 from Monday 14 April.
-- w1 buys a (100, 2 weeks) on Wednesday 5 March, b (200, 2 weeks) and c (300, 4 weeks) on Wednesday 26 March; wf buys 100
-- for 2 weeks on 5 March and is frozen. A plain rule for these: no base, factor 1, one tier ×1 within ±50, so a holding
-- moves by the index's change. The index moves on 7 March +2%, 12 March −1.5%, 31 March +3%, 8 April −0.8% (the day
-- that may be missing), 14 April −2%, 22 April +1%, and not at all on the other trading days; Friday 4 April is a holiday.
savepoint jobs;
insert into terms (name, starts_on, ends_on) values ('春季', '2025-03-03', '2025-03-30'), ('夏季', '2025-04-14', '2025-05-11');
update job_runs set done_to = '2025-03-02', last_ok = null, last_err = null;
create function tests.old(p_no text, p_opening integer) returns void language plpgsql as $$
begin
  perform tests.student(p_no, 0);
  update students set opened_at = tests.at('2025-03-01 08:00') where student_no = p_no;
  update accounts set balance = p_opening, total_in = p_opening where student_no = p_no;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
  values (gen_random_uuid(), 'opening', p_no, p_opening, p_opening, p_opening, (select id from profiles where login_id = 'teacher'), tests.at('2025-03-01 08:00'));
end $$;
create function tests.buy(p_id text, p_no text, p_amount integer, p_weeks integer, p_at text) returns void language sql as $$
  select tests.term(('00000000-0000-4000-8000-0000000000' || p_id)::uuid, p_no, p_amount, p_weeks, 'plain', tests.at(p_at),
    '{"factor":1,"base":{"2":0,"4":0,"12":0,"24":0,"48":0},"tiers":[{"key":"plain","name":"测试","multiplier":1,"min":-50,"max":50}]}')
$$;
-- The trading days from 3 March to p_to, as the fetch would have them.
create function tests.days(p_to date) returns void language sql as $$
  insert into wealth_days (product, day, change, source, params)
  select 'csi300', d::date, coalesce(c, 0), 'tencent', '{}'
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
select tests.call(:'teacher', $$select record_wealth_day('csi300', '2025-04-08', -0.8, '中证指数官网收盘行情')$$) as entered \gset
select is(:'entered'::jsonb - 'created_at', jsonb_build_object('product', 'csi300', 'day', '2025-04-08', 'close', null, 'prev_close', null, 'change', -0.8,
  'source', 'manual', 'note', '中证指数官网收盘行情', 'created_by', :'teacher'), 'the bank admin enters the day''s change by hand');
select tests.days('2025-04-29');
select is(app_private.run_jobs('2025-04-30') -> 'failed', 'null', 'the next jobs, the closes in again');
select is(array(select concat_ws(' ', id, value_centi, status) from wealth_holdings where id::text like '%b1' or id::text like '%c1' order by id),
  array['00000000-0000-4000-8000-0000000000b1 20435 matured', '00000000-0000-4000-8000-0000000000c1 30340 matured'], 'apply it and the days after, then mature');
select is((select created_at from txns where wealth_id = '00000000-0000-4000-8000-0000000000b1' and type = 'wealth_close'), tests.at('2025-04-26'),
  'b at the end of the first day after');
select is(tests.call(:'teacher', $$select record_wealth_day('csi300', '2025-04-08', 1, 'x')$$) ->> 'error', 'ALREADY_EXISTS', 'a day entered is never changed');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
rollback to savepoint jobs;

-- The tiers (§10.10) at the defaults: 100 each in 稳健, 平衡 and 进取 for 2 weeks, bought on Wednesday 5 March 2025; the
-- index +1% on 6 March, −3% on 7 March (each tier at its lower bound), then flat.
savepoint tiers;
select tests.student('tier', 300);
select tests.term(('00000000-0000-4000-8000-0000000000e' || i)::uuid, 'tier', 100, 2, k, '2025-03-05 12:00+08') is not null
from unnest(array['steady', 'balanced', 'bold']) with ordinality x(k, i);
select is(array(select concat_ws(' ', tier, tier_name, multiplier, factor, base, min_rate, max_rate) from wealth_holdings where student_no = 'tier' order by id),
  array['steady 稳健 1.0000 2.0000 3.9230 -5.0000 5.0000', 'balanced 平衡 2.0000 2.0000 3.9230 -10.0000 10.0000', 'bold 进取 4.0000 2.0000 3.9230 -20.0000 20.0000'],
  'each locks its tier, the factor and the weekly base of its length');
insert into wealth_days (product, day, change, source, params)
select 'csi300', d::date, case d::date when '2025-03-06' then 1 when '2025-03-07' then -3 else 0 end, 'tencent', '{}'
from generate_series('2025-03-06'::date, '2025-03-20', interval '1 day') d where extract(isodow from d) <= 5;
select is(app_private.value_wealth('2025-03-19'), 42, 'fourteen days each');
select is(array(select value_centi from wealth_holdings where student_no = 'tier' order by id), array[10407, 10051, 9276],
  'more won, more lost: 稳健 ×1.025512 ×0.95, 平衡 ×1.045512 ×0.90, 进取 ×1.085512 ×0.80 (each at its lower bound on 7 March), then 12 days at 0.5512%');
select is(app_private.mature_wealth('2025-03-19'), 3, 'all mature');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
rollback to savepoint tiers;

select * from finish();
rollback;
