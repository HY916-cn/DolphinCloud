-- 定期定值 (PHASE-2.md §9.2, §9.5, §10.2, §14.3, §17): the fixed weekly rate of each length in term_rates, who sets it,
-- the 定期 already open keeping theirs; 定期 running past the term into the holidays and the next term, maturing there,
-- and carried over by 结转; 提前支取 paying 活期 interest for the days in term only.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.student('s1', 500) as s1 \gset
create function tests.at(p text) returns timestamptz language sql as $$ select (p::timestamp) at time zone 'Asia/Shanghai' $$;

-- term_rates (§14.3): the defaults, every length the same for every anchor and score.
select is(app_private.setting('term_rates'), '{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5}', 'the default weekly rates, longer higher');
select is((select count(*)::int from settings where key = 'term_multipliers'), 0, 'no 定期 multipliers');
select is(array[app_private.rates(1, 0) -> 'term', app_private.rates(4, 1000) -> 'term'],
  array[app_private.setting('term_rates'), app_private.setting('term_rates')], 'the anchor and the score do not move them');
select is(tests.call(:'s1', 'select interest_profile()') #> '{rates,term}', app_private.setting('term_rates'), 'the student reads them');
select ok(app_private.term_rate(2) > app_private.saving_rate(2, 1000) and app_private.term_rate(48) < app_private.loan_rate(2, 1000),
  'at the initial anchor, above the best 活期 rate and below the lowest loan rate');

-- Who sets them, and what they take.
select is(tests.call(:'teacher', $$select set_setting('term_rates', '{"2":2.6,"4":2.8,"12":3.1,"24":3.3,"48":3.6}')$$) -> 'value',
  '{"2":2.6,"4":2.8,"12":3.1,"24":3.3,"48":3.6}', 'the bank admin sets them');
select is(tests.call(:'president', $$select set_settings('{"term_rates":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5}}')$$),
  '{"term_rates":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5}}', 'so does the president');
select is(tests.err(w, $$select set_setting('term_rates', '{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5}')$$), 'FORBIDDEN', 'not the others')
from unnest(array[:'accountant', :'teller', :'ops', :'s1']::uuid[]) w;
select is(tests.call(:'teacher', format('select set_setting(''term_rates'', %L)', v)) ->> 'detail', '{"field": "term_rates"}', why)
from (values ('{"2":2.5,"4":2.75,"12":3,"24":3.25}', 'every length'),
  ('{"2":2.5,"4":2.75,"8":3,"12":3,"24":3.25,"48":3.5}', 'no other'),
  ('{"2":0,"4":2.75,"12":3,"24":3.25,"48":3.5}', 'from 0.01'),
  ('{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":100.01}', 'up to 100'),
  ('{"2":2.5,"4":2.75,"12":3.00001,"24":3.25,"48":3.5}', 'up to 4 decimals'),
  ('{"2":"2.5","4":2.75,"12":3,"24":3.25,"48":3.5}', 'numbers'),
  ('[2.5,2.75,3,3.25,3.5]', 'by length')) t(v, why);

-- A 定期 locks the rate of its day: one opened before a change keeps it.
select app_private.start_term_deposit('00000000-0000-4000-8000-0000000000a1', 's1', 100, 12, :'teller', now()) is not null;
select tests.call(:'teacher', $$select set_setting('term_rates', '{"2":2.5,"4":2.75,"12":4,"24":3.25,"48":3.5}')$$) is not null;
select is(tests.call(:'teller', 'select term_quote(''s1'')') -> 'options' -> 2 -> 'rate', '4', 'a new 12 week 定期 at the new rate');
select is((select concat_ws(' ', rate, expected_centi) from term_deposits where id = '00000000-0000-4000-8000-0000000000a1'), '3.0000 3600',
  'the one open keeps 3% for 12 weeks: 36.00 HTB');
select is(tests.call(:'teller', $$select open_term_deposit('00000000-0000-4000-8000-0000000000a2', 's1', 100, 12)$$) #>> '{term,expected_centi}', '4800',
  'the new one 48.00 HTB');

-- Across the holidays: 春季 Monday 3 March to Sunday 30 March 2025, 夏季 from Monday 14 April. Opened on 24 March: a 2 week
-- 定期 matures in the holidays, a 4 week one in 夏季, a 48 week one is still open after both; e withdraws early in 夏季.
savepoint holidays;
insert into terms (name, starts_on, ends_on) values ('春季', '2025-03-03', '2025-03-30'), ('夏季', '2025-04-14', '2025-05-11');
update job_runs set done_to = '2025-03-02', last_ok = null, last_err = null;
update settings set value = '{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5}' where key = 'term_rates';
select tests.student('h', 0);
update students set opened_at = tests.at('2025-03-01 08:00') where student_no = 'h';
insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
values (gen_random_uuid(), 'opening', 'h', 1000, 1000, 1000, :'teacher', tests.at('2025-03-01 08:00'));
update accounts set balance = 1000, total_in = 1000 where student_no = 'h';
select app_private.start_term_deposit(('00000000-0000-4000-8000-0000000000b' || w)::uuid, 'h', 100, w, :'teller', tests.at('2025-03-24 12:00')) is not null
from unnest(array[2, 4]) w;
select app_private.start_term_deposit('00000000-0000-4000-8000-0000000000b8', 'h', 100, 48, :'teller', tests.at('2025-03-24 12:00')) is not null;
select app_private.start_term_deposit('00000000-0000-4000-8000-0000000000e1', 'h', 100, 4, :'teller', tests.at('2025-03-24 12:00')) is not null;

-- 提前支取 on 16 April: 活期 interest for the 7 days in 春季 and the 2 in 夏季 before the day, none for the holidays: 9 ×
-- ⌊100 × 2.08% ÷ 7⌋ (the initial anchor, 600 分) = 9 × 0.29.
select is(app_private.early_interest(d, '2025-04-16'), 9 * 29, '提前支取 pays the days in term only')
from term_deposits d where id = '00000000-0000-4000-8000-0000000000e1';
select is(app_private.early_interest(d, '2025-04-10'), 7 * 29, 'nothing for the days in the holidays')
from term_deposits d where id = '00000000-0000-4000-8000-0000000000e1';

select is(app_private.run_jobs('2025-04-23') -> 'failed', 'null', 'the jobs run through the term, the holidays and into 夏季');
select is(array(select concat_ws(' ', d.weeks, d.status, d.interest_centi, t.created_at) from term_deposits d left join txns t on t.id = d.close_txn
    where d.student_no = 'h' and d.id::text like '%b_' order by d.weeks),
  array[concat_ws(' ', 2, 'matured', 500, tests.at('2025-04-08')), concat_ws(' ', 4, 'matured', 1100, tests.at('2025-04-22')), '48 open'],
  'the 2 week one matures in the holidays, the 4 week one in 夏季, each with 本金 × 周利率 × 周数');
select is((select term_total from accounts where student_no = 'h'), 100, 'only the 48 week one still in 定期');
select is(app_private.term_open_items((select t from terms t where name = '春季')), '[]', 'a 定期 open does not keep 春季 from 结转');
select isnt(tests.call(:'teacher', format('select close_term(%L)', (select id from terms where name = '春季'))) ->> 'closed_at', null,
  'it carries over as it is');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
rollback to savepoint holidays;

select * from finish();
rollback;
