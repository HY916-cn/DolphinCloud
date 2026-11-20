-- 活期只随锚点 (PHASE-2.md §8.1, §9.2–9.3, §10.11, §14.3, §17): 活期 at every score and anchor is the anchor; the loan
-- rates stay on the score; credit_curve holds the loan side alone; the days accrued before 20261209000000_saving_rate_anchor.sql keep their rate and interest through
-- 补录 dated before them and after them; a catch-up gives what every day on time gives. The days are counted back from
-- today, since run_jobs and 补录 may not be dated after now.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select app_private.cn_date(now()) as today \gset

-- §9.2: 活期 is the anchor whatever the score; 贷款 is the anchor × 2 × 贷款系数 as before.
select is(app_private.saving_rate(a, s), round(a, 4), format('anchor %s%%, %s 分: 活期 = the anchor', a, s))
from unnest(array[1, 1.5, 2, 2.25, 4]::numeric[]) a, unnest(array[0, 399, 400, 600, 750, 900, 1000]) s;
select is(app_private.rates(2, s), r::jsonb, format('score %s at an anchor of 2%%: 活期 2%%, 定期 fixed, 贷款 by the score', s))
from (values (0, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":null}'),
  (400, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":7.2}'),
  (600, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":6.2667}'),
  (750, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":5.5667}'),
  (900, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":4.8667}'),
  (1000, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":4.4}')) t(s, r);
select is(app_private.loan_rate(1.5, 600), 4.7, 'the loan rate still moves with the anchor: 1.5 × 2 × 1.5666… = 4.7');
select hasnt_function('app_private', 'saving_factor', array['integer'], 'no 储蓄系数');
select hasnt_function('app_private', 'saving_factor_raw', array['integer'], 'nor its unrounded form');

-- §14.3: credit_curve has the six keys of the loan side (20261211000000_credit_curve_no_saving.sql).
select is((select array_agg(k order by k) from jsonb_object_keys(app_private.setting('credit_curve')) k),
  array['limit_max', 'limit_min', 'limit_step', 'loan_max', 'loan_min', 'min_score'], 'the saved curve has no 储蓄系数');
select is(tests.call(:'teacher', $$select set_setting('credit_curve', '{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8,"saving_max":1.2}')$$),
  '{"error":"INVALID_INPUT","detail":"{\"field\": \"credit_curve\"}"}', 'a curve with the 储蓄系数 is refused');
savepoint curve;
select is(tests.call(:'teacher', $$select set_setting('credit_curve', '{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.2}')$$),
  '{"key":"credit_curve","value":{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.2}}',
  'the six keys are saved');
select is(app_private.loan_factor(1000), 1.2, 'and the loan rates follow them');
rollback to savepoint curve;

-- One anchor all along (2%) and no rule moves a score, so a before the migration (600 分) and b (1000 分) differ only
-- by the rule their days were accrued under.
update settings set value = value || '{"initial":2,"min":2,"max":2}' where key = 'anchor_params';
update settings set value = (select jsonb_object_agg(key, 0) from jsonb_each(value)) where key = 'credit_rules';

create function tests.noon(p_day date) returns timestamptz language sql as $$ select (p_day + time '12:00') at time zone 'Asia/Shanghai' $$;
-- A student opened at 8:00 on p_opened with 100 HTB (as in 31_manual_entries.sql).
create function tests.old(p_no text, p_opened date) returns void language plpgsql as $$
begin
  perform tests.student(p_no, 0);
  update students set opened_at = (p_opened + time '08:00') at time zone 'Asia/Shanghai' where student_no = p_no;
  update accounts set balance = 100, total_in = 100 where student_no = p_no;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
  values (gen_random_uuid(), 'opening', p_no, 100, 100, 100, (select id from profiles where login_id = 'teacher'), tests.noon(p_opened));
end $$;
-- A 补录 of a 50 HTB deposit at noon of p_day by the bank admin; its transaction's id.
create function tests.entry(p_no text, p_day date) returns uuid language sql as $$
  select (tests.call((select id from profiles where login_id = 'teacher'),
    format('select manual_entry(%L, %L, ''deposit'', %L, ''系统故障，柜台手写登记'', null, null, ''{"10":5}'')',
      gen_random_uuid(), p_no, tests.noon(p_day))) ->> 'id')::uuid
$$;
create function tests.state() returns text language sql as $$
  select concat_ws(' | ',
    (select string_agg(concat_ws(' ', student_no, day, balance, rate, centi, (select created_at from txns where id = settled_txn)), ', '
       order by student_no, day) from interest_accruals),
    (select string_agg(concat_ws(' ', student_no, amount, balance_after, created_at, reason), ', ' order by student_no, created_at)
       from txns where type = 'interest'),
    (select string_agg(concat_ws(' ', student_no, interest_carry, balance), ', ' order by student_no) from accounts))
$$;

select tests.old(n, :'today'::date - 25) from unnest(array['a', 'b']) n;
update credit_scores set score = 1000 where student_no = 'b';
select is(app_private.credit_info('a'), '{"student_no":"a","score":600,"loan_limit":130,"points_to_next":4,"loan_factor":1.5667}',
  'credit_profile, lookup_student and loan_quote show the loan side alone');

-- What accrue_interest wrote before the migration, 20 to 11 days ago: 2% × 储蓄系数 (0.8 + 分数 ÷ 1000 × 0.4), 2.08% at
-- 600 分 and 2.4% at 1000 分. The jobs run from 10 days ago.
insert into interest_accruals (student_no, day, balance, rate, centi)
select n, d::date, 100, r, floor(100 * r / 7) from (values ('a', 2.08), ('b', 2.4)) t(n, r),
  generate_series(:'today'::date - 20, :'today'::date - 11, interval '1 day') d;
update job_runs set done_to = :'today'::date - 11, last_ok = null, last_err = null;
select string_agg(concat_ws(' ', student_no, day, balance, rate, centi), ', ' order by student_no, day) as before
from interest_accruals \gset

-- Every day on time against one catch-up (§9.3).
savepoint every_day;
do $$
declare d date;
begin
  for d in select generate_series(app_private.cn_date(now()) - 10, app_private.cn_date(now()), interval '1 day') loop
    perform app_private.run_jobs(d);
  end loop;
end $$;
select tests.state() as every_day \gset
rollback to savepoint every_day;
select is(app_private.run_jobs(:'today') -> 'failed', 'null', 'catching up ten days at once');
select is(tests.state(), :'every_day', 'gives the same accruals, interest and balances as every day on time');

select is((select array_agg(distinct rate) from interest_accruals where day > :'today'::date - 11), array[2.0000],
  'every day accrued after the migration is at the anchor, 600 分 and 1000 分 alike');
select is(count(*)::int, 0, 'each at ⌊balance × 2 ÷ 7⌋') from interest_accruals where day > :'today'::date - 11 and centi <> floor(balance * 2 / 7);

-- 补录 dated before the migration's days and after them (§10.11): each accrued day is worked out again at the rate it
-- was accrued at; the rows themselves never change.
select tests.entry('a', :'today'::date - 15) as early_a \gset
select tests.entry('b', :'today'::date - 15) as early_b \gset
select tests.entry('a', :'today'::date - 5) as late_a \gset
select is((select string_agg(concat_ws(' ', student_no, day, balance, rate, centi), ', ' order by student_no, day)
  from interest_accruals where day <= :'today'::date - 11), :'before', 'the days accrued before the migration keep their rows');
select is(array(select concat_ws(' ', student_no, centi, count(*)) from interest_adjustments where day between :'today'::date - 15 and :'today'::date - 11
    group by student_no, centi order by student_no),
  array['a 15 5', 'b 17 5'],
  'and their old rates: a ⌊150 × 2.08 ÷ 7⌋ − ⌊100 × 2.08 ÷ 7⌋ = 0.15, b ⌊150 × 2.4 ÷ 7⌋ − ⌊100 × 2.4 ÷ 7⌋ = 0.17 a day');
select is((select count(*)::int from interest_adjustments where day < :'today'::date - 5 and txn_id = :'late_a'), 0,
  'a 补录 after them corrects nothing before its day');
select is((select count(*)::int from interest_adjustments where day <= :'today'::date - 11 and txn_id = :'late_a'), 0,
  'so nothing before the migration');
select is((select count(*)::int from interest_adjustments where day >= :'today'::date - 5 and txn_id = :'late_a'), 5,
  'and each day from its own');
select is(count(*)::int, 0, 'every accrued day: its accrual and corrections = ⌊活期 at its end × the rate it was accrued at ÷ 7⌋')
from interest_accruals a
where a.centi + coalesce((select sum(j.centi) from interest_adjustments j where j.student_no = a.student_no and j.day = a.day), 0)
  <> floor(app_private.balance_on(a.student_no, a.day) * a.rate / 7);
select is(app_private.settle_interest(now()), 2, 'the next 结息 pays the corrections');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

select * from finish();
rollback;
