-- 定期 (PHASE-2.md §9.5, §10.2, §10.9, §14, §15, §17): maturities and the anchor, 日均余额 and the jobs on fixed days in
-- 2025, a catch-up against every day on time and 结转; then at the counter today: the quote, opening, 提前支取 with the
-- 活期 rate of each day, the reversals, who reads what, the ranking, 注销 and the self-check.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('t2', 'teller') as teller2 \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select app_private.cn_date(now()) as today \gset

create function tests.at(p text) returns timestamptz language sql as $$ select (p::timestamp) at time zone 'Asia/Shanghai' $$;
-- A student opened on p_opened (8:00) with an opening balance that day.
create function tests.old(p_no text, p_opening integer, p_opened date default '2025-03-01') returns void language plpgsql as $$
begin
  perform tests.student(p_no, 0);
  update students set opened_at = (p_opened + time '08:00') at time zone 'Asia/Shanghai' where student_no = p_no;
  update accounts set balance = p_opening, total_in = p_opening where student_no = p_no;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
  values (gen_random_uuid(), 'opening', p_no, p_opening, p_opening, p_opening, (select id from profiles where login_id = 'teacher'),
    (p_opened + time '08:00') at time zone 'Asia/Shanghai');
end $$;
-- A 定期 opened at the counter at p_at.
create function tests.open(p_id text, p_no text, p_amount integer, p_weeks integer, p_at text) returns void language sql as $$
  select app_private.start_term_deposit(p_id::uuid, p_no, p_amount, p_weeks, (select id from profiles where login_id = 't1'), tests.at(p_at))
$$;

-- run_jobs (§13) through 春季, Monday 3 March to Sunday 30 March 2025, and the days after. m keeps 2 and 4 week 定期, the
-- 4 week one past the term's end; tb keeps most of its 150 in 定期; fz is frozen with a 定期 open.
savepoint jobs;
insert into terms (name, starts_on, ends_on) values ('春季', '2025-03-03', '2025-03-30');
update job_runs set done_to = '2025-03-02', last_ok = null, last_err = null;
select tests.old('m', 1000);
select tests.old('tb', 150);
select tests.old('fz', 100);
select tests.open('00000000-0000-4000-8000-0000000000c1', 'm', 100, 2, '2025-03-05 12:00');
select tests.open('00000000-0000-4000-8000-0000000000c2', 'm', 200, 4, '2025-03-03 09:00');
select tests.open('00000000-0000-4000-8000-0000000000c3', 'tb', 100, 2, '2025-03-03 08:30');
select tests.open('00000000-0000-4000-8000-0000000000c4', 'fz', 100, 2, '2025-03-03 10:00');
update students set status = 'frozen' where student_no = 'fz';
select is(array(select concat_ws(' ', student_no, principal, weeks, rate, opened_on, matures_on, status, expected_centi) from term_deposits order by id),
  array['m 100 2 2.6000 2025-03-05 2025-03-19 open 520', 'm 200 4 3.1200 2025-03-03 2025-03-31 open 2496',
    'tb 100 2 2.6000 2025-03-03 2025-03-17 open 520', 'fz 100 2 2.6000 2025-03-03 2025-03-17 open 520'],
  'the rate locked at the anchor and score of the day; 到期利息 = 本金 × 周利率 × 周数 to 0.01 HTB');
select is(array(select concat_ws(' ', student_no, balance, term_total) from accounts order by student_no), array['fz 0 100', 'm 700 300', 'tb 50 100'],
  '活期 goes into 定期');
select is(jsonb_path_query_array(app_private.term_open_items((select t from terms t where name = '春季')), '$[*].kind'),
  '["job","term_deposit","term_deposit","term_deposit","term_deposit"]', 'the 定期 open keep the term from 结转');
select is(app_private.term_open_items((select t from terms t where name = '春季')) -> 1,
  '{"kind":"term_deposit","id":"00000000-0000-4000-8000-0000000000c4","student_no":"fz","name":"学生fz","principal":100,"matures_on":"2025-03-17"}',
  'each named, the first to mature first');

create function tests.state() returns text language sql as $$
  select concat_ws(' | ',
    (select string_agg(concat_ws(' ', student_no, day, balance, rate, centi), ', ' order by student_no, day) from interest_accruals),
    (select string_agg(concat_ws(' ', student_no, type, amount, balance_after, created_at), ', ' order by student_no, created_at, type)
       from txns where type in ('interest', 'term_close')),
    (select string_agg(concat_ws(' ', id, status, interest_centi, close_txn is not null), ', ' order by id) from term_deposits),
    (select string_agg(concat_ws(' ', week_start, deposits, growth, adjust, anchor), ', ' order by week_start) from rate_weeks),
    (select string_agg(concat_ws(' ', student_no, rule, delta, score, at), ', ' order by student_no, id) from credit_events),
    (select string_agg(concat_ws(' ', student_no, interest_carry, balance, term_total), ', ' order by student_no) from accounts))
$$;
savepoint every_day;
do $$
declare d date;
begin
  for d in select generate_series('2025-03-03'::date, '2025-04-02', interval '1 day') loop
    perform app_private.run_jobs(d);
  end loop;
end $$;
select tests.state() as every_day \gset
rollback to savepoint every_day;
select is(app_private.run_jobs('2025-04-02') -> 'failed', 'null', 'catching up the whole term at once');
select is(tests.state(), :'every_day', 'gives the same maturities, interest, anchors, scores and balances as every day on time');
select is(app_private.run_jobs('2025-04-02') -> 'ran', '[]', 'and running again changes nothing');
select is(tests.state(), :'every_day', 'nothing at all');

select is(array(select concat_ws(' ', d.student_no, d.status, d.interest_centi, t.created_at, t.operator_id = app_private.system_user(), t.cash_delta)
    from term_deposits d join txns t on t.id = d.close_txn order by d.id),
  array(select concat_ws(' ', n, 'matured', c, tests.at(a), true, 0) from (values ('m', 520, '2025-03-20'), ('m', 2496, '2025-03-31'),
    ('tb', 520, '2025-03-18'), ('fz', 520, '2025-03-18')) x(n, c, a)),
  'each matures at the end of its day, dated the next midnight, by the system login; the one past the term''s end on its last day; the frozen one too');
select is(count(*)::int, 0, 'principal and the whole HTB of the interest and the 零头 before it come back as one term_close')
from term_deposits d join txns t on t.id = d.close_txn
where t.amount - d.principal not between d.interest_centi / 100 and d.interest_centi / 100 + 1;
select is(array(select t.reason from term_deposits d join txns t on t.id in (d.open_txn, d.close_txn) where d.id = '00000000-0000-4000-8000-0000000000c3' order by t.seq),
  array['2 周，3月17日 到期', '到期，利息 5.20 HTB'], 'each says what it was: the length and maturity date, then 到期 with the interest paid');
select is(array(select t.reason from term_deposits d join txns t on t.id = d.close_txn order by d.id),
  array['到期，利息 5.20 HTB', '到期，利息 24.96 HTB', '到期，利息 5.20 HTB', '到期，利息 5.20 HTB'], 'every maturity');
select is(array(select concat_ws(' ', day, balance) from interest_accruals where student_no = 'tb' and day in ('2025-03-03', '2025-03-17', '2025-03-18') order by day),
  array['2025-03-03 50', concat('2025-03-17 ', app_private.balance_on('tb', '2025-03-17')), concat('2025-03-18 ', app_private.balance_on('tb', '2025-03-17')
    + (select amount from txns where student_no = 'tb' and type = 'term_close'))],
  '活期 interest leaves out the 定期 until the day after it matures');
select is(app_private.balance_on('tb', '2025-03-17') < 60, true, 'tb kept about 50 in 活期 until then');
select is((select count(*)::int from interest_accruals where student_no = 'fz'), 0, 'the frozen account accrues no 活期 interest');
select is((select deposits from rate_weeks where week_start = '2025-03-10'), 1250, '存款余额 for the anchor counts 活期 and 定期本金: every opening, still 1250');
select is((select array_agg(rule order by rule) from credit_events where student_no = 'tb' and ref = 'weeks:2025-03-10'), array['balance_100'],
  '日均余额 counts the 定期: tb kept 150 in all, 50 of it in 活期');
select is(count(*)::int, 0, 'every accrual works out again from the 活期 of its day') from interest_accruals where balance <> app_private.balance_on(student_no, day);
select is((select sum(term_total)::int from accounts), 0, 'nothing left in 定期');
select is(count(*)::int, 0, 'the ledger checks out, 定期 interest with the 活期') from app_private.check_balances();
select is(app_private.term_open_items((select t from terms t where name = '春季')), '[]', 'nothing keeps the term from 结转');
select isnt(tests.call(:'teacher', format('select close_term(%L)', (select id from terms where name = '春季'))) ->> 'closed_at', null, 'which the bank admin does');
select is(tests.call(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')',
  (select close_txn from term_deposits where student_no = 'tb'))) ->> 'error', 'REVERSAL_NOT_ALLOWED', 'a maturity is never reversed');
select is((tests.call(:'teacher', 'select bank_report(''2025-03-01'', ''2025-04-02'')') #> '{balance,changes}') - 'opening' - 'interest',
  jsonb_build_object('term_open', -500, 'term_close', (select sum(amount) from txns where type = 'term_close')),
  'the report shows 开定期 and 定期到期 among the balance changes');
select is(jsonb_path_query_array(tests.call(:'teacher', 'select bank_report(''2025-03-01'', ''2025-04-02'')') -> 'tellers', '$[*].name'), '["t1"]',
  'and leaves the system login out of the tellers'' table');
rollback to savepoint jobs;

-- At the counter today, in a term from 10 days ago to 30 days ahead: 2 and 4 weeks end in it, 8 do not.
insert into terms (name, starts_on, ends_on) values ('本学期', :'today'::date - 10, :'today'::date + 30);
select tests.student('s1', 100) as s1 \gset
select tests.student('s2', 120) as s2 \gset
select tests.student('frz', 100);
update students set status = 'frozen' where student_no = 'frz';
select tests.student('pay', 100);
insert into staff_payroll (user_id, account) values (:'teller', 'pay');

select is(tests.call(:'teller', 'select term_quote(''s1'')') - 'deposits',
  jsonb_build_object('student_no', 's1', 'score', 600,
    'term', jsonb_build_object('id', (select id from terms where name = '本学期'), 'name', '本学期', 'ends_on', :'today'::date + 30),
    'options', jsonb_build_array(jsonb_build_object('weeks', 2, 'rate', 2.6, 'matures_on', :'today'::date + 14),
      jsonb_build_object('weeks', 4, 'rate', 3.12, 'matures_on', :'today'::date + 28)),
    'balance', 100, 'term_total', 0),
  'the quote: the lengths that end in term, each with its locked rate and maturity date');

select tests.call(:'teller', $$select open_term_deposit('00000000-0000-4000-8000-0000000000a1', 's1', 60, 2)$$) as opened \gset
select is(:'opened'::jsonb - 'id' - 'txn_no' - 'created_at' - 'term',
  '{"type":"term_open","amount":60,"balance_after":40,"denominations":null,"change_given":null}', '开定期: 60 out of 活期');
select is((:'opened'::jsonb -> 'term') - 'open_txn',
  jsonb_build_object('id', '00000000-0000-4000-8000-0000000000a1', 'student_no', 's1', 'principal', 60, 'weeks', 2, 'rate', 2.6,
    'opened_on', :'today'::date, 'matures_on', :'today'::date + 14, 'status', 'open', 'close_txn', null, 'interest_centi', null,
    'expected_centi', 312), 'into a 2 week 定期 at 2.6% a week, 3.12 HTB at maturity');
select is((select concat_ws(' ', balance_delta, cash_delta, term_id, operator_id = :'teller') from txns where id = (:'opened'::jsonb ->> 'id')::uuid),
  '-60 0 00000000-0000-4000-8000-0000000000a1 t', 'no cash moves');
select is((select concat_ws(' ', balance, term_total) from accounts where student_no = 's1'), '40 60', '定期本金合计');
select is((select reason from txns where id = (:'opened'::jsonb ->> 'id')::uuid), '2 周，' || to_char(:'today'::date + 14, 'FMMM月FMDD日') || ' 到期',
  'the term_open says the length and the maturity date');
select is(tests.call(:'teller', $$select open_term_deposit('00000000-0000-4000-8000-0000000000a1', 's1', 60, 2)$$) ->> 'id', :'opened'::jsonb ->> 'id',
  'sent again, the same result');
select is((select count(*)::int from term_deposits), 1, 'and one 定期');
select is(tests.call(:'teller', $$select open_term_deposit(gen_random_uuid(), 's1', 10, 8)$$) - 'error',
  jsonb_build_object('detail', jsonb_build_object('ends_on', :'today'::date + 30, 'max_weeks', 4)::text), 'TERM_TOO_LONG: the term ends first, 4 weeks at most');
select is(tests.call(:'teller', $$select open_term_deposit(gen_random_uuid(), 's1', 41, 2)$$),
  '{"error":"INSUFFICIENT_BALANCE","detail":"{\"short\": 1, \"balance\": 40}"}', 'not more than 活期');
select is(tests.err(:'teller', format('select open_term_deposit(gen_random_uuid(), %L, %s, %s)', n, a, w)), e, why)
from (values ('s1', 0, 2, 'INVALID_AMOUNT', '1 HTB or more'), ('s1', 10, 3, 'INVALID_INPUT', '2, 4 or 8 weeks'),
  ('frz', 10, 2, 'STUDENT_INACTIVE', 'an account in use'), ('pay', 10, 2, 'SELF_SERVICE_FORBIDDEN', 'not the teller''s own pay account'),
  ('nobody', 10, 2, 'STUDENT_NOT_FOUND', 'a student that exists')) t(n, a, w, e, why);
select is(tests.err(w, $$select open_term_deposit(gen_random_uuid(), 's1', 10, 2)$$), 'FORBIDDEN', 'the counter''s alone')
from unnest(array[:'president', :'teacher', :'accountant', :'s1']::uuid[]) w;
update duty set ended_at = now(), txns = 0 where user_id = :'teller2';
select is(tests.err(:'teller2', $$select open_term_deposit(gen_random_uuid(), 's1', 10, 2)$$), 'OFF_DUTY', 'on duty');
savepoint term_end;
update terms set ends_on = :'today'::date + 10 where name = '本学期';
select is(tests.call(:'teller', $$select open_term_deposit(gen_random_uuid(), 's1', 10, 2)$$) ->> 'detail',
  jsonb_build_object('ends_on', :'today'::date + 10, 'max_weeks', null)::text, 'no length left before the term ends');
select is(tests.call(:'teller', 'select term_quote(''s1'')') -> 'options', '[]', 'and none quoted');
update terms set starts_on = :'today'::date + 1, ends_on = :'today'::date + 60 where name = '本学期';
select is(tests.err(:'teller', $$select open_term_deposit(gen_random_uuid(), 's1', 10, 2)$$), 'NO_TERM', 'none in the holidays');
select is(tests.call(:'teller', 'select term_quote(''s1'')') -> 'term', 'null', 'the quote says there is no term');
rollback to savepoint term_end;

-- 提前支取 (§9.5): s2 opened 100 for 4 weeks 5 days ago and dropped to 500 分 2 days ago: 3 days at 600 分 (100 × 2.08% ÷ 7
-- = 0.29) and 2 at 500 分 (2.00% → 0.28).
select app_private.start_term_deposit('00000000-0000-4000-8000-0000000000b1', 's2', 100, 4, :'teller', (:'today'::date - 5 + time '12:00') at time zone 'Asia/Shanghai');
select app_private.credit_change('s2', -100, 'manual', '测试', null, null, (:'today'::date - 2 + time '10:00') at time zone 'Asia/Shanghai') is not null;
select tests.call(:'teller', $$select withdraw_term_early('00000000-0000-4000-8000-0000000000b1')$$) as early \gset
select is(:'early'::jsonb - 'id' - 'txn_no' - 'created_at' - 'term',
  '{"type":"term_close","amount":101,"balance_after":121,"denominations":null,"change_given":null}',
  '3 × 0.29 + 2 × 0.28 = 1.43: the principal and 1 HTB back to 活期');
select is(array[:'early'::jsonb #>> '{term,status}', :'early'::jsonb #>> '{term,interest_centi}'], array['early', '143'], '已提前支取, 1.43 HTB paid');
select is((select reason from txns where id = (:'early'::jsonb ->> 'id')::uuid), '提前支取，利息 1.43 HTB', 'the term_close says 提前支取 and the interest');
select is((select concat_ws(' ', balance, term_total, interest_carry) from accounts where student_no = 's2'), '121 0 43', 'the 0.43 waits as 待入账利息');
select is(tests.call(:'teller', $$select withdraw_term_early('00000000-0000-4000-8000-0000000000b1')$$) ->> 'id', :'early'::jsonb ->> 'id',
  'sent again, the same result');
select is(tests.err(:'teller', $$select withdraw_term_early(gen_random_uuid())$$), 'INVALID_INPUT', 'a 定期 that exists');
select is(tests.err(w, $$select withdraw_term_early('00000000-0000-4000-8000-0000000000b1')$$), 'FORBIDDEN', 'the counter''s alone')
from unnest(array[:'president', :'teacher', :'s2']::uuid[]) w;
select app_private.start_term_deposit('00000000-0000-4000-8000-0000000000b2', 's2', 10, 2, :'teller', (:'today'::date - 20 + time '12:00') at time zone 'Asia/Shanghai');
select is(tests.call(:'teller', $$select withdraw_term_early('00000000-0000-4000-8000-0000000000b2')$$) ->> 'detail', '{"field": "term_id", "status": "open"}',
  'not after the day it matures');
select is(tests.call(:'teller', 'select term_quote(''s2'')') -> 'deposits' -> 0 ->> 'status', 'early', 'the quote lists every 定期 of the student');

-- 冲正 (§10.9). A 结息 since used up the 0.43: 0.43 + 0.80 paid 1 HTB and left 0.23.
insert into interest_accruals (student_no, day, balance, rate, centi) values ('s2', :'today'::date - 1, 121, 2, 80);
select app_private.settle_interest(now());
select is(tests.err(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''业务选错'')', :'early'::jsonb ->> 'id')), 'REVERSAL_NOT_ALLOWED',
  'the teller does not reverse 提前支取');
select is(tests.call(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''业务选错'')', :'early'::jsonb ->> 'id')) - 'id' - 'txn_no' - 'created_at',
  '{"type":"reversal","amount":102,"balance_after":10,"denominations":null,"change_given":null}',
  'the bank admin does: the 1.43 comes back out, 1 HTB more than it paid as the 零头 left is only 0.23');
select is((select concat_ws(' ', balance, term_total, interest_carry) from accounts where student_no = 's2'), '10 110 80',
  'the 定期 restored and the 零头 back to what the 结息 left of the accruals');
select is((select concat_ws(' ', status, close_txn is null, interest_centi is null) from term_deposits where id = '00000000-0000-4000-8000-0000000000b1'),
  'open t t', 'as it was');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
select is(tests.call(:'teller', $$select withdraw_term_early('00000000-0000-4000-8000-0000000000b1')$$) ->> 'amount', '102',
  'it can be withdrawn again: 0.80 + 1.43 pays 2 HTB');
select is(tests.err(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''业务选错'')',
  (select open_txn from term_deposits where id = '00000000-0000-4000-8000-0000000000b1'))), 'REVERSAL_NOT_ALLOWED', 'a 定期 no longer open keeps its term_open');
select is(tests.err(:'teller2', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'opened'::jsonb ->> 'id')), 'REVERSAL_NOT_ALLOWED',
  'a teller reverses only their own 开定期');
select is(tests.call(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'opened'::jsonb ->> 'id')) ->> 'balance_after', '100',
  'their own of today: the principal back to 活期');
select is((select concat_ws(' ', d.status, a.term_total) from term_deposits d join accounts a using (student_no) where d.id = '00000000-0000-4000-8000-0000000000a1'),
  'reversed 0', 'the 定期 void, no interest');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- Who reads what (§3, §16).
select is(tests.call(:'s2', 'select count(*) from term_deposits'), '2', 'a student reads their own 定期');
select is(tests.call(:'s1', 'select jsonb_agg(student_no) from term_deposits'), '["s1"]', 'only their own');
select is(tests.call(w, 'select count(*) from term_deposits'), '3', 'the accountant, president and bank admin everyone''s')
from unnest(array[:'accountant', :'president', :'teacher']::uuid[]) w;
select is(tests.call(w, 'select count(*) from term_deposits'), '0', 'the others none, the counter through term_quote')
from unnest(array[:'teller', :'keeper', :'ops']::uuid[]) w;
select is(tests.call(:'teller', 'select lookup_student(''s2'')') -> 'term_total', '10', '查询 shows 定期本金合计');
select is(tests.err(:'teller', 'select term_quote(''pay'')'), 'SELF_SERVICE_FORBIDDEN', 'not of the teller''s own pay account');
select is(tests.err(w, 'select term_quote(''s1'')'), 'FORBIDDEN', 'the quote is the counter''s') from unnest(array[:'teacher', :'s1']::uuid[]) w;

-- 排名 (§16.3) by 活期 + 定期本金: ra keeps 100 of its 150 in 定期 and still comes first.
select tests.student('ra', 150, null, 'junior') as ra \gset
select tests.student('rb', 120, null, 'junior') as rb \gset
select tests.call(:'teller', $$select open_term_deposit(gen_random_uuid(), 'ra', 100, 2)$$) is not null;
select is(jsonb_path_query_array(tests.call(:'rb', 'select deposit_ranking()') -> 'top', '$[*].balance'), '[150, 120]', 'ranked by 活期 + 定期');
select is(tests.call(:'rb', 'select deposit_ranking()') #> '{me,rank}', '2', 'rb second');

-- 注销 (P1 §6.4): the 定期 still open come back without interest and leave with the balance.
select is(tests.call(:'teacher', format('select close_accounts(array[%L]::uuid[])', :'ra')), '{"closed":1,"cleared":150}', '注销 clears 活期 and 定期');
select is(array(select concat_ws(' ', type, amount, balance_after, operator_id = :'teacher') from txns where student_no = 'ra' and type in ('term_close', 'closing') order by seq),
  array['term_close 100 150 t', 'closing 150 0 t'], 'the 定期 first, then the whole balance');
select is((select concat_ws(' ', status, interest_centi) from term_deposits where student_no = 'ra'), 'early 0', 'no interest');
select is((select reason from txns where student_no = 'ra' and type = 'term_close'), '提前支取，利息 0.00 HTB', 'said as a 提前支取 with no interest');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- The self-check (§14.1) finds a 定期本金合计 that does not match the 定期 open.
update accounts set term_total = term_total + 5 where student_no = 's2';
select is(array(select concat_ws(' ', kind, key, recorded, expected) from app_private.check_balances()), array['term s2 15 10'],
  'check_balances: term_total against the principal open');

select * from finish();
rollback;
