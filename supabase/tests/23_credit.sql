-- 海豚信用分 (PHASE-2.md §8, §17): the curve of §8.1, credit_change, the weekly rules on fixed days, run_weekly's
-- catch-up, 手动调整, the credit settings and who reads what. Ends with one term of a steady saver.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.student('s1', 0) as s1 \gset
select tests.student('s2', 0) as s2 \gset

-- §8.1: every score of the table, and the points to the next 5 HTB.
select is(array[app_private.credit_limit(s)::text, app_private.loan_factor(s)::text, app_private.saving_factor(s)::text],
  array[l, f, g], format('score %s: limit, loan factor, saving factor', s))
from (values (0, null, null, '0.8000'), (399, null, null, '0.9596'), (400, '50', '1.8000', '0.9600'), (600, '130', '1.5667', '1.0400'),
  (750, '195', '1.3917', '1.1000'), (900, '255', '1.2167', '1.1600'), (1000, '300', '1.1000', '1.2000')) t(s, l, f, g);
select is(array(select app_private.credit_next(s) from unnest(array[0, 399, 400, 600, 604, 999, 1000]) s), array[null, null, 12, 4, 12, 1, null],
  'points to the next 5 HTB: none below 400 or at the top limit');
select ok(app_private.credit_limit(600 + app_private.credit_next(600)) = 135 and app_private.credit_limit(600 + app_private.credit_next(600) - 1) = 130,
  'and exactly that many');

-- 600 for every student, from 开户.
select is((select count(*) from students s left join credit_scores c using (student_no) where c.score is distinct from 600), 0::bigint,
  'every student starts at 600');
select is(tests.call(:'s1', 'select credit_profile()'),
  '{"student_no":"s1","score":600,"loan_limit":130,"points_to_next":4,"loan_factor":1.5667,"saving_factor":1.04}', 'a student reads their own');

-- credit_change: 0–1000, the change applied, a rule's own points, once per ref.
update credit_scores set score = 990 where student_no = 's2';
select is(app_private.credit_change('s2', 30, 'manual', '测试') - 'id' - 'at',
  '{"student_no":"s2","delta":10,"score":1000,"rule":"manual","reason":"测试","ref":null,"actor_id":null}', 'kept at 1000, recording +10');
select ok(app_private.credit_change('s2', 5, 'manual', '测试') is null, 'a change of nothing writes nothing');
select is(app_private.credit_change('s2', -1200, 'manual', '测试') ->> 'delta', '-1000', 'kept at 0');
select is(app_private.credit_change('s2', null, 'deposit_week', '上周有存款', 'weeks:2000-01-03') ->> 'delta', '3', 'a rule''s points by default');
select ok(app_private.credit_change('s2', null, 'deposit_week', '上周有存款', 'weeks:2000-01-03') is null, 'counted once per ref');
select is((select score from credit_scores where student_no = 's2'), 3, 'the score follows its events');
select throws_ok($$select app_private.credit_change('s2', 1, 'nonsense', '测试')$$, 'P0001', 'INVALID_INPUT', 'an unknown rule');
select throws_ok($$select app_private.credit_change('s2', 1, 'manual', ' ')$$, 'P0001', 'INVALID_INPUT', 'every change has a reason');
select throws_ok($$select app_private.credit_change('nobody', 1, 'manual', '测试')$$, 'P0001', 'STUDENT_NOT_FOUND', 'an unknown student');
select throws_ok($$update credit_events set delta = 0$$, '42501', null, 'events are never changed');
update credit_scores set score = 600 where student_no = 's2';

-- The weekly rules (§8.2) for the week of Monday 10 March 2025, counted on Monday 17 March. Transactions are written at noon
-- of their day; each student shows one rule.
create function tests.tx(p_no text, p_type txn_type, p_amount integer, p_day date) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_delta integer := case when p_type = 'withdraw' then -p_amount else p_amount end;
  v_balance integer;
begin
  update accounts set balance = balance + v_delta where student_no = p_no returning balance into v_balance;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
  values (v_id, p_type, p_no, p_amount, v_delta, v_balance, (select id from profiles where login_id = 'teacher'),
    (p_day + time '12:00') at time zone 'Asia/Shanghai');
  return v_id;
end $$;
create function tests.reverse(p_id uuid, p_day date) returns void language plpgsql as $$
declare
  v txns := (select t from txns t where id = p_id);
  v_balance integer;
begin
  update accounts set balance = balance - v.balance_delta where student_no = v.student_no returning balance into v_balance;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, reversal_of, reason, operator_id, created_at)
  values (gen_random_uuid(), 'reversal', v.student_no, v.amount, -v.balance_delta, v_balance, p_id, '测试', v.operator_id,
    (p_day + time '15:00') at time zone 'Asia/Shanghai');
  update txns set status = 'reversed' where id = p_id;
end $$;
-- A student opened on p_opened (default 1 January 2025) with an opening balance that day.
create function tests.old(p_no text, p_opening integer default 0, p_opened date default '2025-01-01') returns void language plpgsql as $$
begin
  perform tests.student(p_no, 0);
  update students set opened_at = (p_opened + time '08:00') at time zone 'Asia/Shanghai' where student_no = p_no;
  if p_opening > 0 then
    perform tests.tx(p_no, 'opening', p_opening, p_opened);
  end if;
end $$;
create function tests.events(p_no text) returns text[] language sql as $$
  select coalesce(array_agg(rule || ' ' || delta || ' ' || reason order by id), '{}') from credit_events where student_no = p_no
$$;

select tests.old('dep');            select tests.tx('dep', 'deposit', 10, '2025-03-12');
select tests.old('none');           select tests.tx('none', 'deposit', 10, '2025-03-08');
select tests.old('rev');            select tests.reverse(tests.tx('rev', 'deposit', 10, '2025-03-12'), '2025-03-13');
select tests.old('late');           select tests.reverse(tests.tx('late', 'deposit', 10, '2025-03-14'), '2025-03-17');
select tests.old('salary');         select tests.tx('salary', 'salary', 10, '2025-03-12');
select tests.old('streak4');        select tests.tx('streak4', 'deposit', 1, d) from unnest('{2025-02-04,2025-02-18,2025-02-27,2025-03-03,2025-03-16}'::date[]) d;
select tests.old('streak5');        select tests.tx('streak5', 'deposit', 1, d) from unnest('{2025-02-10,2025-02-18,2025-02-27,2025-03-03,2025-03-16}'::date[]) d;
select tests.old('gap');            select tests.tx('gap', 'deposit', 1, d) from unnest('{2025-02-18,2025-02-27,2025-03-16}'::date[]) d;
select tests.old('wd', 98);         select tests.tx('wd', 'withdraw', 25, '2025-03-11'); select tests.tx('wd', 'withdraw', 25, '2025-03-13');
select tests.old('half', 98);       select tests.tx('half', 'withdraw', 49, '2025-03-11');
select tests.old('wdrev', 98);      select tests.tx('wdrev', 'withdraw', 49, '2025-03-11'); select tests.reverse(tests.tx('wdrev', 'withdraw', 10, '2025-03-12'), '2025-03-12');
select tests.old('empty');          select tests.tx('empty', 'opening', 10, '2025-03-10'); select tests.tx('empty', 'withdraw', 10, '2025-03-11');
select tests.old('age4', 0, '2025-02-17');
select tests.old('age3', 0, '2025-02-18');
select tests.old('age8', 0, '2025-01-14');
select tests.old('b100', 100);
select tests.old('b99', 99);
select tests.old('avg', 0);         select tests.tx('avg', 'opening', 140, '2025-03-12'); -- 0, 0, then 140 for 5 days: 100 a day
select tests.old('b300', 300);
select tests.old('frozen', 300);    select tests.tx('frozen', 'deposit', 10, '2025-03-12');
select tests.old('grad', 300);      select tests.tx('grad', 'deposit', 10, '2025-03-12');
select tests.old('closed', 300);    select tests.tx('closed', 'deposit', 10, '2025-03-12');
select tests.old('new', 300, '2025-03-17');
update students set status = 'frozen' where student_no = 'frozen';
update students set status = 'graduated' where student_no = 'grad';
update students set status = 'closed' where student_no = 'closed';

select app_private.credit_weekly('2025-03-17') as n \gset
select is(tests.events('dep'), '{"deposit_week 3 上周有存款"}', 'a 柜台存款 last week: +3');
select is(tests.events('none'), '{}', 'one the week before does not count');
select is(tests.events('rev'), '{}', 'nor one reversed');
select is(tests.events('late'), '{"deposit_week 3 上周有存款"}', 'unless reversed only after the Monday: what the Monday saw');
select is(tests.events('salary'), '{}', 'nor 工资, which is no deposit');
select is(tests.events('streak4'), '{"deposit_week 3 上周有存款","deposit_streak 10 连续 4 周都有存款"}',
  'four weeks in a row with a deposit: +10 more');
select is(tests.events('streak5'), '{"deposit_week 3 上周有存款"}', 'the fifth week in a row has no more');
select is(tests.events('gap'), '{"deposit_week 3 上周有存款"}', 'a week without one starts the count again');
select is(tests.events('wd'), '{"withdraw_half -5 上周取款超过周初余额的一半"}', 'withdrawing more than half the balance the week began with: −5');
select is(tests.events('half'), '{}', 'half of it or less: nothing');
select is(tests.events('wdrev'), '{}', 'a reversed withdrawal does not count');
select is(tests.events('empty'), '{"withdraw_half -5 上周取款超过周初余额的一半"}', 'any withdrawal from a week begun at 0');
select is(tests.events('age4'), '{"account_age 2 开户满 4 周"}', 'four weeks since 开户: +2');
select is(tests.events('age3'), '{}', 'a day short: nothing yet');
select is(tests.events('age8'), '{"account_age 2 开户满 8 周"}', 'and every four weeks after');
select is(tests.events('b100'), '{"balance_100 2 上周日均余额不少于 100 HTB"}', 'a daily balance of 100 on average: +2');
select is(tests.events('b99'), '{}', '99: nothing');
select is(tests.events('avg'), '{"balance_100 2 上周日均余额不少于 100 HTB"}', 'the average of each day''s closing balance');
select is(tests.events('b300'), '{"balance_100 2 上周日均余额不少于 100 HTB","balance_300 2 上周日均余额不少于 300 HTB"}',
  '300 on average: +2 more');
select is(tests.events(s), '{}', format('%s: no change', s)) from unnest(array['frozen', 'grad', 'closed']) s;
select is(tests.events('new'), '{}', 'nor for an account opened on the Monday');
select is((select score from credit_scores where student_no = 'streak4'), 613, 'the score moves with the events');
select is(count(*)::int, 0, 'one ref per week') from credit_events where ref is distinct from 'weeks:2025-03-17' and student_no <> 's2';
select count(*) as week_events from credit_events \gset
select app_private.credit_weekly('2025-03-17') as n \gset
select is((select count(*) from credit_events), :'week_events'::bigint, 'counting the week again changes nothing');

-- run_weekly (§13): every Monday, in term and in the holidays alike. 春季 runs from Monday 3 March to Sunday 6 July 2025
-- (18 weeks); 夏季 from Wednesday 16 July.
update students set status = 'frozen' where status = 'normal';
insert into terms (name, starts_on, ends_on) values ('春季', '2025-03-03', '2025-07-06'), ('夏季', '2025-07-16', '2025-08-31');
-- No 活期利息 here (an anchor of 0): the scores below count the deposits alone.
update settings set value = value || '{"initial":0,"min":0,"max":0}' where key = 'anchor_params';
update job_runs set done_to = '2025-03-01', last_ok = null, last_err = null;
-- 一学期 (§8.2): no loan, a deposit every Wednesday, never below 100: opened the first day of term with 120.
select tests.old('saver', 120, '2025-03-03');
select tests.tx('saver', 'deposit', 10, d::date) from generate_series('2025-03-05'::date, '2025-07-02', interval '7 day') d;
-- Another with the same deposits into the holidays, who withdraws 150 near the end of the term.
select tests.old('busy', 120, '2025-03-03');
select tests.tx('busy', 'deposit', 10, d::date) from generate_series('2025-03-05'::date, '2025-08-06', interval '7 day') d;
select tests.tx('busy', 'withdraw', 150, '2025-06-24');

-- Each day as it comes, kept as text; then the same days caught up at once after a server that was down all term.
savepoint every_week;
do $$
declare d date;
begin
  for d in select generate_series('2025-03-02'::date, '2025-08-12', interval '1 day') loop
    perform app_private.run_jobs(d);
  end loop;
end $$;
select string_agg(concat_ws(' ', student_no, rule, delta, score, ref), ', ' order by student_no, id) as every_week
from credit_events where ref like 'weeks:%' and ref <> 'weeks:2025-03-17' \gset
rollback to savepoint every_week;
select is(app_private.run_jobs('2025-08-12') -> 'failed', 'null', 'catching up the whole term at once');
select is(string_agg(concat_ws(' ', student_no, rule, delta, score, ref), ', ' order by student_no, id), :'every_week',
  'gives the same changes, in the same order, as every Monday on time')
from credit_events where ref like 'weeks:%' and ref <> 'weeks:2025-03-17';
select is(count(*)::int, 0, 'nothing on the Monday the accounts opened, nor for the frozen') from credit_events
  where ref = 'weeks:2025-03-03' or student_no not in ('saver', 'busy') and ref <> 'weeks:2025-03-17' and student_no <> 's2';
select is(array(select distinct ref from credit_events where student_no = 'busy' and ref > 'weeks:2025-07' order by ref),
  array['weeks:2025-07-07', 'weeks:2025-07-14', 'weeks:2025-07-21', 'weeks:2025-07-28', 'weeks:2025-08-04', 'weeks:2025-08-11'],
  'every Monday counts, those of the holidays and the first of the next term too');
select is((select count(distinct ref)::int from credit_events where student_no = 'saver' and ref <= 'weeks:2025-07-07'), 18,
  'the 18 weeks of 春季 count 18 times, the last on the Monday after it');
select is((select array[score, app_private.credit_limit(score)] from credit_events where student_no = 'saver' and ref <= 'weeks:2025-07-07'
  order by id desc limit 1), array[738, 190],
  'a steady saver goes from 600 to 738 in a term: 18 × (3 + 2) + 4 × 10 + 4 × 2, a limit of 190 HTB instead of 130');

-- 手动调整 (§8.3): the bank admin alone, with a reason.
select is(tests.err(w, 'select adjust_credit(''s1'', 10, ''表现好'')'), 'FORBIDDEN', 'refused')
from unnest(array[:'president', :'accountant', :'teller', :'keeper', :'ops', :'s1']::uuid[]) w;
select is(tests.call(:'teacher', 'select adjust_credit(''s1'', 10, '' '')') ->> 'detail', '{"field": "reason"}', 'a reason is required');
select is(tests.call(:'teacher', 'select adjust_credit(''s1'', 0, ''表现好'')') ->> 'detail', '{"field": "delta"}', 'and a change');
select is(tests.call(:'teacher', 'select adjust_credit(''s1'', 1001, ''表现好'')') ->> 'detail', '{"field": "delta"}', 'of at most 1000');
select is(tests.err(:'teacher', 'select adjust_credit(''nobody'', 10, ''表现好'')'), 'STUDENT_NOT_FOUND', 'of a student');
select is(tests.err(:'teacher', 'select adjust_credit(''closed'', 10, ''表现好'')'), 'ACCOUNT_CLOSED', 'not closed');
select tests.call(:'teacher', 'select adjust_credit(''s1'', -30, '' 损坏公物 '')') as adj \gset
select is((:'adj'::jsonb -> 'event') - 'id' - 'at', jsonb_build_object('student_no', 's1', 'delta', -30, 'score', 570, 'rule', 'manual',
  'reason', '银行管理员调整：损坏公物', 'ref', null, 'actor_id', :'teacher'), 'recorded as manual, by the bank admin, the reason marked');
select is(:'adj'::jsonb -> 'credit', '{"student_no":"s1","score":570,"loan_limit":120,"points_to_next":10,"loan_factor":1.6017,"saving_factor":1.028}',
  'returning the new score');
select is(count(*)::int, 1, 'and logged as credit.adjust') from audit_log
  where action = 'credit.adjust' and target = 'students:s1' and actor_id = :'teacher' and after ->> 'delta' = '-30';
select is(tests.call(:'teacher', 'select adjust_credit(''s1'', 1000, ''表现好'')') #>> '{event,delta}', '430', 'kept at 1000');
select is(tests.call(:'teacher', 'select adjust_credit(''s1'', 1, ''表现好'')') ->> 'detail', '{"field": "delta"}', 'and no further');
select tests.call(:'teacher', 'select adjust_credit(''s1'', -400, ''恢复'')') is not null as restored \gset

-- The settings (§14.3): the bank admin, checked for shape, range and the order of each pair.
select is(tests.err(:'president', $$select set_setting('credit_curve', '{}')$$), 'FORBIDDEN', 'not the president');
select is(tests.call(:'teacher', $$select set_setting('credit_curve', '{"min_score":300,"limit_min":40,"limit_max":400,"limit_step":10,"loan_max":2,"loan_min":1,"saving_min":0.5,"saving_max":1.5}')$$) ->> 'key',
  'credit_curve', 'the bank admin changes the curve');
select is(array[app_private.credit_limit(600), app_private.loan_factor(600), app_private.saving_factor(600)], array[190, 1.5714, 1.1],
  'and the scores follow it at once');
select is(tests.call(:'teacher', format('select set_setting(''credit_curve'', %L)', c)) ->> 'detail', '{"field": "credit_curve"}', why)
from (values ('{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8}', 'every key'),
  ('{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8,"saving_max":1.2,"x":1}', 'no other'),
  ('{"min_score":1000,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8,"saving_max":1.2}', 'a score below 1000'),
  ('{"min_score":400.5,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8,"saving_max":1.2}', 'a whole score'),
  ('{"min_score":400,"limit_min":"50","limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8,"saving_max":1.2}', 'numbers'),
  ('{"min_score":400,"limit_min":4,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8,"saving_max":1.2}', 'the step within the lowest limit'),
  ('{"min_score":400,"limit_min":350,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8,"saving_max":1.2}', 'the limits in order'),
  ('{"min_score":400,"limit_min":50,"limit_max":10001,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8,"saving_max":1.2}', 'limits up to 10000'),
  ('{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.1,"loan_min":1.8,"saving_min":0.8,"saving_max":1.2}', 'the loan factors in order'),
  ('{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":1.3,"saving_max":1.2}', 'the saving factors in order'),
  ('{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":0,"saving_min":0.8,"saving_max":1.2}', 'factors from 0.1'),
  ('{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.80001,"saving_max":1.2}', 'with 4 decimals'),
  ('[]', 'an object')) t(c, why);
select is(tests.call(:'teacher', $$select set_settings('{"credit_curve":{"min_score":400,"limit_min":50,"limit_max":300,"limit_step":5,"loan_max":1.8,"loan_min":1.1,"saving_min":0.8,"saving_max":1.2},"credit_rules":{"repay_on_time":5,"repay_early":10,"overdue":-50,"overdue_week":-30,"deposit_week":4,"deposit_streak":10,"withdraw_half":-5,"account_age":2,"balance_100":2,"balance_300":2}}')$$) #>> '{credit_rules,deposit_week}',
  '4', 'the bank admin changes both at once');
select is(app_private.credit_change('s1', null, 'deposit_week', '上周有存款') ->> 'delta', '4', 'the rules follow at once');
select is(tests.call(:'teacher', format('select set_setting(''credit_rules'', %L)', c)) ->> 'detail', '{"field": "credit_rules"}', why)
from (values ('{"repay_on_time":5,"repay_early":10,"overdue":-50,"overdue_week":-30,"deposit_week":3,"deposit_streak":10,"withdraw_half":-5,"account_age":2,"balance_100":2}', 'every rule'),
  ('{"repay_on_time":5,"repay_early":10,"overdue":50,"overdue_week":-30,"deposit_week":3,"deposit_streak":10,"withdraw_half":-5,"account_age":2,"balance_100":2,"balance_300":2}', 'a loss is not a gain'),
  ('{"repay_on_time":5,"repay_early":10,"overdue":-50,"overdue_week":-30,"deposit_week":-3,"deposit_streak":10,"withdraw_half":-5,"account_age":2,"balance_100":2,"balance_300":2}', 'nor a gain a loss'),
  ('{"repay_on_time":5,"repay_early":101,"overdue":-50,"overdue_week":-30,"deposit_week":3,"deposit_streak":10,"withdraw_half":-5,"account_age":2,"balance_100":2,"balance_300":2}', 'at most 100'),
  ('{"repay_on_time":5,"repay_early":10,"overdue":-101,"overdue_week":-30,"deposit_week":3,"deposit_streak":10,"withdraw_half":-5,"account_age":2,"balance_100":2,"balance_300":2}', 'at least −100'),
  ('{"repay_on_time":5.5,"repay_early":10,"overdue":-50,"overdue_week":-30,"deposit_week":3,"deposit_streak":10,"withdraw_half":-5,"account_age":2,"balance_100":2,"balance_300":2}', 'whole points')) t(c, why);
select is(tests.err(w, $$select set_setting('credit_rules', '{}')$$), 'FORBIDDEN', 'not the others')
from unnest(array[:'accountant', :'teller', :'keeper', :'ops', :'s1']::uuid[]) w;

-- Who reads what (§3, §16): the student their own; the accountant, president and bank admin everyone's; the teller the
-- student at the counter, through lookup_student.
select is(tests.call(:'s1', 'select count(*) from credit_scores'), '1', 'a student reads their own score');
select is(tests.call(:'s1', 'select count(distinct student_no) from credit_events'), '1', 'and their own changes');
select is(tests.call(:'s1', 'select credit_profile(''s1'')') ->> 'student_no', 's1', 'also by their own number');
select is(tests.err(:'s1', 'select credit_profile(''s2'')'), 'FORBIDDEN', 'but no one else''s');
select is(tests.call(w, 'select to_jsonb(count(*) > 2) from credit_scores'), 'true', 'everyone''s scores') from unnest(array[:'accountant', :'president', :'teacher']::uuid[]) w;
select is(tests.call(w, 'select to_jsonb(count(distinct student_no) > 2) from credit_events'), 'true', 'and changes') from unnest(array[:'accountant', :'president', :'teacher']::uuid[]) w;
select is(tests.call(w, 'select credit_profile(''s2'')') ->> 'score', '600', 'and any student''s profile') from unnest(array[:'accountant', :'president', :'teacher']::uuid[]) w;
select is(tests.err(:'teacher', 'select credit_profile(''nobody'')'), 'STUDENT_NOT_FOUND', 'of a student that exists');
select is(tests.err(:'teacher', 'select credit_profile()'), 'FORBIDDEN', 'staff name the student');
select is(tests.call(w, 'select count(*) from credit_scores')::text || tests.call(w, 'select count(*) from credit_events')::text, '00', 'nothing for the others')
from unnest(array[:'teller', :'keeper', :'ops']::uuid[]) w;
select is(tests.err(w, 'select credit_profile(''s2'')'), 'FORBIDDEN', 'nor a profile') from unnest(array[:'teller', :'keeper', :'ops']::uuid[]) w;
select is(tests.call(:'teller', 'select lookup_student(''s2'')') -> 'credit',
  '{"score":600,"loan_limit":130,"points_to_next":4,"loan_factor":1.5667,"saving_factor":1.04}', 'the teller sees it on the student''s card');

select * from finish();
rollback;
