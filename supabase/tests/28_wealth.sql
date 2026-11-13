-- 理财 (PHASE-2.md §9.6, §10.10, §13, §14, §15, §17): the weekly rates from eastmoney's klines and by hand, the jobs on
-- fixed days in 2025 (the weeks applied in order, maturity in the holidays, a missing week holding a holding up until it
-- is entered, a catch-up against every day on time); then at the counter today: buying, redeeming at the value, the
-- reversals, who reads what, the ranking, 注销 and the self-check.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('t2', 'teller') as teller2 \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select app_private.cn_date(now()) as today \gset
create function tests.at(p text) returns timestamptz language sql as $$ select (p::timestamp) at time zone 'Asia/Shanghai' $$;

-- wealth_params (§14.3) and the rate of a week: the change × 2, within ±5%.
select is(app_private.setting('wealth_params'), '{"secid":"100.SPX","name":"标普 500","factor":2,"min":-5,"max":5}', 'the default index, factor and bounds');
select is(array[app_private.wealth_rate(1.2345, p), app_private.wealth_rate(-0.4, p), app_private.wealth_rate(3, p), app_private.wealth_rate(-7.5, p)],
  array[2.469, -0.8, 5, -5]::numeric[], 'the change doubled, within −5% and +5%')
from (select app_private.setting('wealth_params') p) x;

-- eastmoney's klines (§10.10): each week over by today's Monday after the week before it; the week not over waits, and a
-- week with no week before it in the list has nothing to compare with.
savepoint klines;
select is(app_private.record_wealth_klines('["2025-02-28,5954.50","2025-03-07,5770.20","2025-03-14,5638.94","2025-03-28,5580.94","2025-04-04,5074.08"]',
  '2025-04-03'), 2, 'two weeks added');
select is(array(select concat_ws(' ', week_start, close, prev_close, change, rate, source, created_by is null) from wealth_weeks
    where week_start < '2025-06-01' order by week_start),
  array['2025-03-03 5770.2000 5954.5000 -3.0951 -5.0000 eastmoney t', '2025-03-10 5638.9400 5770.2000 -2.2748 -4.5496 eastmoney t'],
  'each with its close, the close before, the change and the rate; 24 March has no week before it, 31 March is not over');
select is(app_private.record_wealth_klines('["2025-03-07,1","2025-03-14,1","2025-03-21,2"]', '2025-03-24'), 1, 'a week already in is kept as it was');
select is((select rate from wealth_weeks where week_start = '2025-03-10'), -4.5496, 'kept');
select throws_ok($$select app_private.record_wealth_klines('null')$$, 'no klines');
select throws_ok($$select app_private.record_wealth_klines('["2025-03-28;1"]')$$);
select throws_ok($$update wealth_weeks set rate = 0$$, '42501', null, 'a week entered is never changed');
rollback to savepoint klines;

-- wealth_params: the bank admin and the president.
select is(tests.call(:'teacher', $$select set_setting('wealth_params', '{"secid":"1.000300","name":"沪深 300","factor":1.5,"min":-3,"max":3}')$$) -> 'value',
  '{"secid":"1.000300","name":"沪深 300","factor":1.5,"min":-3,"max":3}', 'the bank admin changes the index, factor and bounds');
select is(tests.call(:'president', $$select set_setting('wealth_params', '{"secid":"100.SPX","name":"标普 500","factor":2,"min":-5,"max":5}')$$) -> 'value',
  '{"secid":"100.SPX","name":"标普 500","factor":2,"min":-5,"max":5}', 'so does the president');
select is(tests.err(w, $$select set_setting('wealth_params', '{"secid":"100.SPX","name":"标普 500","factor":2,"min":-5,"max":5}')$$), 'FORBIDDEN', 'not the others')
from unnest(array[:'accountant', :'teller', :'ops']::uuid[]) w;
select is(tests.call(:'teacher', format('select set_setting(''wealth_params'', %L)', v)) ->> 'detail', '{"field": "wealth_params"}', why)
from (values ('{"secid":"100.SPX","name":"标普 500","factor":2,"min":-5}', 'every key'),
  ('{"secid":"100.SPX","name":"标普 500","factor":2,"min":-5,"max":5,"x":1}', 'no other'),
  ('{"secid":"SPX","name":"标普 500","factor":2,"min":-5,"max":5}', 'an eastmoney secid'),
  ('{"secid":"100.SPX&x=1","name":"标普 500","factor":2,"min":-5,"max":5}', 'nothing more in it'),
  ('{"secid":"100.SPX","name":"","factor":2,"min":-5,"max":5}', 'a name'),
  ('{"secid":"100.SPX","name":"标普 500","factor":0,"min":-5,"max":5}', 'a factor from 0.01'),
  ('{"secid":"100.SPX","name":"标普 500","factor":2,"min":1,"max":5}', 'min 0 or below'),
  ('{"secid":"100.SPX","name":"标普 500","factor":2,"min":-5,"max":50.5}', 'max up to 50')) t(v, why);

-- The jobs (§10.10, §13) from Monday 3 March 2025: 春季 to Sunday 30 March, holidays, 夏季 from Monday 14 April. w1 buys
-- a (100, 2 weeks) on Wednesday 5 March, b (200, 2 weeks) and c (300, 4 weeks) on Wednesday 26 March; wf buys 100 for 2
-- weeks on 5 March and is frozen. The rates: 10 March +2%, 17 March −1.5%, 24 March +0.5%, 31 March +3%, 7 April −0.8%
-- (the one that may be missing), 14 April −2%, 21 April +1%.
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
  select app_private.start_wealth(('00000000-0000-4000-8000-0000000000' || p_id)::uuid, p_no, p_amount, p_weeks, (select id from profiles where login_id = 't1'), tests.at(p_at))
$$;
create function tests.rates(p_with_april_7 boolean) returns void language sql as $$
  insert into wealth_weeks (week_start, rate, source, params)
  select w::date, r, 'eastmoney', app_private.setting('wealth_params')
  from (values ('2025-03-10', 2), ('2025-03-17', -1.5), ('2025-03-24', 0.5), ('2025-03-31', 3), ('2025-04-07', -0.8), ('2025-04-14', -2), ('2025-04-21', 1)) x(w, r)
  where p_with_april_7 or w <> '2025-04-07'
$$;
select tests.old('w1', 1000);
select tests.old('wf', 100);
select tests.buy('a1', 'w1', 100, 2, '2025-03-05 12:00');
select tests.buy('f1', 'wf', 100, 2, '2025-03-05 12:00');
update students set status = 'frozen' where student_no = 'wf';
select tests.buy('b1', 'w1', 200, 2, '2025-03-26 12:00');
select tests.buy('c1', 'w1', 300, 4, '2025-03-26 12:00');
select is(array(select concat_ws(' ', id, principal, weeks, opened_on, starts_on, matures_on, value_centi, valued_to, status) from wealth_holdings order by id),
  array['00000000-0000-4000-8000-0000000000a1 100 2 2025-03-05 2025-03-10 2025-03-23 10000 2025-03-10 open',
    '00000000-0000-4000-8000-0000000000b1 200 2 2025-03-26 2025-03-31 2025-04-13 20000 2025-03-31 open',
    '00000000-0000-4000-8000-0000000000c1 300 4 2025-03-26 2025-03-31 2025-04-27 30000 2025-03-31 open',
    '00000000-0000-4000-8000-0000000000f1 100 2 2025-03-05 2025-03-10 2025-03-23 10000 2025-03-10 open'],
  'from the next Monday, to the Sunday of the last week; the value starts at the principal');
select is(array(select concat_ws(' ', student_no, balance, wealth_total) from accounts order by student_no), array['w1 400 600', 'wf 0 100'],
  '活期 goes into 理财');
select is((select reason from txns where wealth_id = '00000000-0000-4000-8000-0000000000c1'), '4 周，4月27日 到期', 'the wealth_buy says the length and the last day');

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
select tests.rates(true);
do $$
declare d date;
begin
  for d in select generate_series('2025-03-03'::date, '2025-04-30', interval '1 day') loop
    perform app_private.run_jobs(d);
  end loop;
end $$;
select tests.state() as every_day \gset
rollback to savepoint every_day;
savepoint catch_up;
select tests.rates(true);
select is(app_private.run_jobs('2025-04-30') -> 'failed', 'null', 'catching up the whole term and the holidays at once');
select is(tests.state(), :'every_day', 'gives the same values, maturities, interest, anchors, scores and balances as every day on time');
select is(array(select concat_ws(' ', h.id, h.value_centi, h.status, t.created_at, t.reason, t.operator_id = app_private.system_user())
    from wealth_holdings h join txns t on t.id = h.close_txn order by h.id),
  array[concat_ws(' ', '00000000-0000-4000-8000-0000000000a1', 10047, 'matured', tests.at('2025-03-24'), '到期，盈 +0.47 HTB', true),
    concat_ws(' ', '00000000-0000-4000-8000-0000000000b1', 20435, 'matured', tests.at('2025-04-14'), '到期，盈 +4.35 HTB', true),
    concat_ws(' ', '00000000-0000-4000-8000-0000000000c1', 30338, 'matured', tests.at('2025-04-28'), '到期，盈 +3.38 HTB', true),
    concat_ws(' ', '00000000-0000-4000-8000-0000000000f1', 10047, 'matured', tests.at('2025-03-24'), '到期，盈 +0.47 HTB', true)],
  'each week in order to 0.01 HTB (10000 × 1.02 × 0.985); matured at the end of its last day, in term or in the holidays, the frozen one too');
select is((select concat_ws(' ', amount, balance_after) from txns where wealth_id = '00000000-0000-4000-8000-0000000000f1' and type = 'wealth_close'), '100 100',
  'the whole HTB back to 活期');
select is((select interest_carry from accounts where student_no = 'wf'), 47, 'and the 0.47 kept as 零头');
select is((select deposits from rate_weeks where week_start = '2025-03-10'), 1100, '存款余额 for the anchor counts 理财本金: every opening, still 1100');
select is(count(*)::int, 0, 'the ledger checks out, 理财 with the interest') from app_private.check_balances();
rollback to savepoint catch_up;

-- 7 April missing: b and c wait at it, b past its last day; a and f mature as before.
select tests.rates(false);
select is(app_private.run_jobs('2025-04-25') -> 'failed', 'null', 'a week missing stops no job');
select is(array(select concat_ws(' ', id, value_centi, valued_to, status) from wealth_holdings where id::text like '%b1' or id::text like '%c1' order by id),
  array['00000000-0000-4000-8000-0000000000b1 20600 2025-04-07 open', '00000000-0000-4000-8000-0000000000c1 30900 2025-04-07 open'],
  'the holdings that need it wait there, past the last day too');
select is(tests.call(:'accountant', 'select wealth_overview()') -> 'missing', '["2025-04-07"]', 'the 理财 page lists the week missing');
select is(tests.call(:'teacher', 'select wealth_overview()') -> 'open', '{"count": 2, "principal": 500, "value_centi": 51500}', 'and the holdings open');
select tests.call(:'teacher', $$select record_wealth_week('2025-04-07', -0.8, '东方财富网页上的周涨跌 −0.40%')$$) as entered \gset
select is(:'entered'::jsonb - 'created_at', jsonb_build_object('week_start', '2025-04-07', 'close', null, 'prev_close', null, 'change', null, 'rate', -0.8,
  'source', 'manual', 'note', '东方财富网页上的周涨跌 −0.40%', 'created_by', :'teacher'), 'the bank admin enters the rate by hand');
select is(app_private.run_jobs('2025-04-30') -> 'failed', 'null', 'the next jobs');
select is(array(select concat_ws(' ', id, value_centi, status) from wealth_holdings where id::text like '%b1' or id::text like '%c1' order by id),
  array['00000000-0000-4000-8000-0000000000b1 20435 matured', '00000000-0000-4000-8000-0000000000c1 30338 matured'], 'apply it and the weeks after, then mature');
select is((select created_at from txns where wealth_id = '00000000-0000-4000-8000-0000000000b1' and type = 'wealth_close'), tests.at('2025-04-26'),
  'b at the end of the first day after it was entered');
select is(tests.call(:'accountant', 'select wealth_overview()') -> 'missing', '[]', 'nothing missing');
select is(tests.call(:'teacher', $$select record_wealth_week('2025-04-07', 1, 'x')$$) ->> 'error', 'ALREADY_EXISTS', 'a week entered is never changed');
select is(tests.call(:'teacher', format('select record_wealth_week(%L, %s, %L)', w, r, n)) ->> 'detail', d, why)
from (values ('2025-04-08', '1', 'x', '{"field": "week"}', 'a Monday'),
  (app_private.week_of(:'today'::date)::text, '1', 'x', '{"field": "week"}', 'a week over'),
  ('2025-03-03', '5.5', 'x', '{"max": 5, "min": -5, "field": "rate"}', 'within the bounds'),
  ('2025-03-03', '1.00001', 'x', '{"max": 5, "min": -5, "field": "rate"}', 'up to 4 decimals'),
  ('2025-03-03', '1', ' ', '{"field": "note"}', 'where it came from')) t(w, r, n, d, why);
select is(tests.err(w, $$select record_wealth_week('2025-03-03', 1, 'x')$$), 'FORBIDDEN', 'the bank admin and the president alone')
from unnest(array[:'accountant', :'teller', :'ops']::uuid[]) w;
select is(tests.call(:'president', $$select record_wealth_week('2025-03-03', 1, 'x')$$) ->> 'source', 'manual', 'the president too');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
rollback to savepoint jobs;

-- At the counter today.
select tests.student('s1', 500) as s1 \gset
select tests.student('s2', 100) as s2 \gset
select tests.student('frz', 100);
update students set status = 'frozen' where student_no = 'frz';
select tests.student('pay', 100);
insert into staff_payroll (user_id, account) values (:'teller', 'pay');
select app_private.week_of(:'today'::date) + 7 as monday \gset

select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d1', 's1', 100, 12)$$) as bought \gset
select is(:'bought'::jsonb - 'id' - 'txn_no' - 'created_at' - 'holding',
  '{"type":"wealth_buy","amount":100,"balance_after":400,"denominations":null,"change_given":null}', '买理财: 100 out of 活期');
select is((:'bought'::jsonb -> 'holding') - 'open_txn',
  jsonb_build_object('id', '00000000-0000-4000-8000-0000000000d1', 'student_no', 's1', 'principal', 100, 'weeks', 12, 'opened_on', :'today'::date,
    'starts_on', :'monday'::date, 'matures_on', :'monday'::date + 83, 'value_centi', 10000, 'valued_to', :'monday'::date, 'status', 'open',
    'close_txn', null), 'a 12 week holding from next Monday');
select is((select concat_ws(' ', balance_delta, cash_delta, wealth_id, operator_id = :'teller', reason) from txns where id = (:'bought'::jsonb ->> 'id')::uuid),
  concat_ws(' ', -100, 0, '00000000-0000-4000-8000-0000000000d1', true, '12 周，' || to_char(:'monday'::date + 83, 'FMMM月FMDD日') || ' 到期'),
  'no cash moves; the length and the last day');
select is(tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d1', 's1', 100, 12)$$) ->> 'id', :'bought'::jsonb ->> 'id',
  'sent again, the same result');
select is(tests.call(:'teller', $$select buy_wealth(gen_random_uuid(), 's1', 401, 2)$$),
  '{"error":"INSUFFICIENT_BALANCE","detail":"{\"short\": 1, \"balance\": 400}"}', 'not more than 活期');
select is(tests.err(:'teller', format('select buy_wealth(gen_random_uuid(), %L, %s, %s)', n, a, w)), e, why)
from (values ('s1', 0, 2, 'INVALID_AMOUNT', '1 HTB or more'), ('s1', 10, 8, 'INVALID_INPUT', '2, 4, 12, 24 or 48 weeks'),
  ('frz', 10, 2, 'STUDENT_INACTIVE', 'an account in use'), ('pay', 10, 2, 'SELF_SERVICE_FORBIDDEN', 'not the teller''s own pay account'),
  ('nobody', 10, 2, 'STUDENT_NOT_FOUND', 'a student that exists')) t(n, a, w, e, why);
select is(tests.err(w, $$select buy_wealth(gen_random_uuid(), 's1', 10, 2)$$), 'FORBIDDEN', 'the counter''s alone')
from unnest(array[:'president', :'teacher', :'accountant', :'s1']::uuid[]) w;
update duty set ended_at = now(), txns = 0 where user_id = :'teller2';
select is(tests.err(:'teller2', $$select buy_wealth(gen_random_uuid(), 's1', 10, 2)$$), 'OFF_DUTY', 'on duty');
savepoint loan;
select app_private.start_loan(gen_random_uuid(), 's2', 10, '测试', 'bullet', 1, 'account', :'teller', now()) is not null;
select is(tests.err(:'teller', $$select buy_wealth(gen_random_uuid(), 's2', 10, 2)$$), 'LOAN_OUTSTANDING', 'none while a loan is not paid off');
rollback to savepoint loan;

-- The quote and 查询.
select is(tests.call(:'teller', 'select wealth_quote(''s1'')') - 'holdings' - 'latest' - 'recent',
  jsonb_build_object('student_no', 's1', 'index', jsonb_build_object('secid', '100.SPX', 'name', '标普 500'),
    'options', (select jsonb_agg(jsonb_build_object('weeks', w, 'starts_on', :'monday'::date, 'matures_on', :'monday'::date + 7 * w - 1) order by w)
      from unnest(array[2, 4, 12, 24, 48]) w),
    'balance', 400, 'wealth_total', 100), 'the quote: the index, each length from next Monday, 活期 and 理财本金');
select is(jsonb_array_length(tests.call(:'teller', 'select wealth_quote(''s1'')') -> 'holdings'), 1, 'and the student''s holdings');
select is(tests.call(:'teller', 'select wealth_quote(''s1'')') -> 'recent', app_private.wealth_recent(6), 'and the latest 6 weeks');
select is(tests.err(:'teller', 'select wealth_quote(''pay'')'), 'SELF_SERVICE_FORBIDDEN', 'not of the teller''s own pay account');
select is(tests.err(w, 'select wealth_quote(''s1'')'), 'FORBIDDEN', 'the quote is the counter''s') from unnest(array[:'teacher', :'s1']::uuid[]) w;
update wealth_holdings set value_centi = 10350, valued_to = :'monday'::date + 7 where id = '00000000-0000-4000-8000-0000000000d1';
select is(tests.call(:'teller', 'select lookup_student(''s1'')') - 'credit' - 'name' - 'division' - 'cohort' - 'class_no' - 'grade' - 'class_label'
  - 'status' - 'withdrawn_today' - 'loan_remaining' - 'loan_overdue',
  '{"student_no":"s1","balance":400,"term_total":0,"wealth_total":100,"wealth_value_centi":10350}', '查询 shows 理财本金 and its value');

-- 赎回 (§10.10) at the value: 103.50 pays 103 HTB and keeps 0.50.
select tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d1')$$) as redeemed \gset
select is(:'redeemed'::jsonb - 'id' - 'txn_no' - 'created_at' - 'holding',
  '{"type":"wealth_close","amount":103,"balance_after":503,"denominations":null,"change_given":null}', '103 back to 活期');
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
select is(tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d1')$$) ->> 'amount', '103', 'it can be redeemed again');

-- A loss: 50 worth 46.50 pays the 0.50 零头 and 46.50, 47 HTB.
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d2', 's1', 50, 2)$$) is not null;
update wealth_holdings set value_centi = 4650 where id = '00000000-0000-4000-8000-0000000000d2';
select is(tests.call(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d2')$$) ->> 'amount', '47', 'a loss pays less than the principal');
select is((select reason from txns where wealth_id = '00000000-0000-4000-8000-0000000000d2' and type = 'wealth_close'), '赎回，亏 −3.50 HTB', 'and says so');
select is(tests.err(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d2')$$) , null, 'sent again, the same result');

-- 1 HTB worth 0.95 with no 零头 pays 0 HTB: the 0.95 waits as 零头.
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d6', 's2', 1, 2)$$) is not null;
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
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d3', 's1', 20, 4)$$) as third \gset
select is(tests.err(:'teller2', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'third'::jsonb ->> 'id')), 'REVERSAL_NOT_ALLOWED',
  'a teller reverses only their own');
select is(tests.call(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'third'::jsonb ->> 'id')) ->> 'amount', '20',
  'their own of today: the principal back to 活期');
select is((select concat_ws(' ', h.status, a.wealth_total) from wealth_holdings h join accounts a using (student_no) where h.id = '00000000-0000-4000-8000-0000000000d3'),
  'reversed 0', 'the holding void');
select tests.call(:'teller', $$select buy_wealth('00000000-0000-4000-8000-0000000000d4', 's1', 10, 2)$$) as fourth \gset
update wealth_holdings set valued_to = valued_to + 7, value_centi = 1020 where id = '00000000-0000-4000-8000-0000000000d4';
select is(tests.err(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'fourth'::jsonb ->> 'id')), 'REVERSAL_NOT_ALLOWED',
  'not once a week has moved it');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- A frozen account keeps its holding and cannot redeem it.
select app_private.start_wealth('00000000-0000-4000-8000-0000000000d5', 'frz', 10, 2, :'teller', now()) is not null;
select is(tests.err(:'teller', $$select redeem_wealth('00000000-0000-4000-8000-0000000000d5')$$), 'STUDENT_INACTIVE', 'no 赎回 while frozen');

-- Who reads what (§3, §16).
select is(tests.call(:'s1', 'select count(*) from wealth_holdings'), '4', 'a student reads their own holdings');
select is(tests.call(:'s2', 'select count(*) from wealth_holdings'), '1', 'only their own');
select is(tests.call(w, 'select count(*) from wealth_holdings'), '6', 'the accountant, president and bank admin everyone''s')
from unnest(array[:'accountant', :'president', :'teacher']::uuid[]) w;
select is(tests.call(w, 'select count(*) from wealth_holdings'), '0', 'the others none, the counter through wealth_quote')
from unnest(array[:'teller', :'ops']::uuid[]) w;
select is(tests.call(w, 'select to_jsonb(count(*) = (select count(*) from wealth_weeks)) from wealth_weeks'), 'true', 'everyone reads the weekly rates')
from unnest(array[:'s1', :'teller', :'ops']::uuid[]) w;
select is(tests.err(w, 'select wealth_overview()'), 'FORBIDDEN', 'the 理财 page is the back office''s') from unnest(array[:'teller', :'s1', :'ops']::uuid[]) w;

-- 排名 (§16.3) by 活期 + 定期 + 理财本金: ra keeps 100 of its 150 in 理财 and still comes first.
select tests.student('ra', 150, null, 'junior') as ra \gset
select tests.student('rb', 120, null, 'junior') as rb \gset
select tests.call(:'teller', $$select buy_wealth(gen_random_uuid(), 'ra', 100, 2)$$) is not null;
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
