-- 信用分开关 (PHASE-2.md §8.5, §15, §17): who may turn it, every score at 600 while off and the limit and rates with it,
-- no change recorded by the weekly rules, the loans or by hand, a term of jobs on time and caught up, each score back
-- when on again, and asking twice changing nothing.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.student('s1', 0) as s1 \gset

create function tests.at(p text) returns timestamptz language sql as $$ select (p::timestamp) at time zone 'Asia/Shanghai' $$;
-- A student opened on 1 March 2025 (8:00) with an opening balance that day, if any, and a score.
create function tests.old(p_no text, p_opening integer, p_score integer) returns void language plpgsql as $$
begin
  perform tests.student(p_no, 0);
  update students set opened_at = tests.at('2025-03-01 08:00') where student_no = p_no;
  update accounts set balance = p_opening, total_in = p_opening where student_no = p_no;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
  select gen_random_uuid(), 'opening', p_no, p_opening, p_opening, p_opening, (select id from profiles where login_id = 'teacher'),
    tests.at('2025-03-01 08:00') where p_opening > 0;
  perform app_private.credit_change(p_no, p_score - 600, 'manual', '测试');
end $$;
create function tests.deposit(p_no text, p_amount integer, p_at text) returns void language plpgsql as $$
declare v integer;
begin
  update accounts set balance = balance + p_amount, total_in = total_in + p_amount where student_no = p_no returning balance into v;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, operator_id, created_at)
  values (gen_random_uuid(), 'deposit', p_no, p_amount, p_amount, v, p_amount, (select id from profiles where login_id = 'teacher'), tests.at(p_at));
end $$;
-- The scores not at 600 (other test files leave students of their own, all at 600).
create function tests.scores() returns text language sql as $$
  select coalesce(string_agg(student_no || ' ' || score, ', ' order by student_no), 'all 600') from credit_scores where score <> 600
$$;
create function tests.turn(p_on boolean) returns jsonb language sql as $$
  select tests.call((select id from profiles where login_id = 'teacher'), format('select set_credit_enabled(%L, ''期中检查'')', p_on))
$$;

-- 春季, Monday 3 March to Sunday 13 April 2025: a (700 分) borrows 100 in 4 periods and pays each on its day from 活期;
-- b (450 分) borrows 50 in cash for 2 weeks with nothing in 活期 and falls 逾期; c (350 分, 冻结) and d (600 分) deposit
-- every Wednesday.
insert into terms (name, starts_on, ends_on) values ('春季', '2025-03-03', '2025-04-13');
update job_runs set done_to = '2025-03-02', last_ok = null, last_err = null;
select tests.old('a', 200, 700);
select tests.old('b', 0, 450);
select tests.old('c', 100, 350);
select tests.old('d', 100, 600);
select app_private.start_loan('00000000-0000-4000-8000-0000000000a1', 'a', 100, '测试', 'installment', 4, 'account', :'teller', tests.at('2025-03-03 09:00'));
select app_private.start_loan('00000000-0000-4000-8000-0000000000b1', 'b', 50, '测试', 'bullet', 2, 'cash', :'teller', tests.at('2025-03-03 10:00'));
select tests.deposit(s, 10, d::date || ' 12:00') from unnest(array['c', 'd']) s, generate_series('2025-03-05'::date, '2025-04-09', interval '7 day') d;
update students set status = 'frozen' where student_no = 'c';
select is(tests.scores(), 'a 700, b 450, c 350', 'the scores before');
select is(tests.call(:'teacher', 'select credit_profile(''c'')') ->> 'loan_limit', null, 'c cannot borrow at 350');

-- The term with 信用分 on records the weekly rules and the loans' points.
savepoint on_all_term;
select is(app_private.run_jobs('2025-04-14') -> 'failed', 'null', 'the term run with 信用分 on');
select is(array(select distinct rule from credit_events where rule <> 'manual' order by rule),
  array['account_age', 'balance_100', 'deposit_streak', 'deposit_week', 'overdue', 'overdue_week', 'repay_on_time'],
  'records the weekly rules, 按时还款 and 逾期');
rollback to savepoint on_all_term;

-- Who turns it (§3): the bank admin alone, with a reason.
select is(tests.err(w, 'select set_credit_enabled(false, ''期中检查'')'), 'FORBIDDEN', 'refused')
from unnest(array[:'president', :'accountant', :'teller', :'keeper', :'ops', :'s1']::uuid[]) w;
select is(tests.call(:'teacher', 'select set_credit_enabled(false, '' '')') ->> 'detail', '{"field": "reason"}', 'a reason is required to turn it off');
select is(tests.call(:'teacher', 'select set_credit_enabled(null, ''期中检查'')') ->> 'detail', '{"field": "on"}', 'and on or off');
select is(app_private.setting('credit_enabled'), 'true', 'on from the start');
select is(tests.turn(true), '{"enabled":true,"changed":false,"students":0}', 'turning it on while on changes nothing');
select is((select count(*)::int from audit_log where action = 'credit.switch'), 0, 'and logs nothing');

-- Off (§8.5): every score at 600, by an event the student reads.
select is(tests.turn(false), '{"enabled":false,"changed":true,"students":3}', 'turned off: three scores were not 600');
select is(tests.scores(), 'all 600', 'every student at 600, 冻结 too');
select is(array(select concat_ws(' ', student_no, delta, score, reason, actor_id = :'teacher') from credit_events where rule = 'switch_off' order by student_no),
  array['a -100 600 信用分暂停，按 600 分计 t', 'b 150 600 信用分暂停，按 600 分计 t', 'c 250 600 信用分暂停，按 600 分计 t'],
  'each a switch_off by the bank admin');
select is((select array[value::text, (updated_by = :'teacher')::text] from settings where key = 'credit_enabled'), array['false', 'true'],
  'settings.credit_enabled reads false');
select is((select after from audit_log where action = 'credit.switch' and target = 'settings:credit_enabled' and actor_id = :'teacher'),
  '{"enabled":false,"reason":"期中检查","students":3}', 'logged as credit.switch with the reason');
select is(tests.call(:'s1', 'select value from settings where key = ''credit_enabled'''), 'false', 'a student reads it too');
select is(tests.call(:'teacher', 'select credit_profile(''c'')'),
  '{"student_no":"c","score":600,"loan_limit":130,"points_to_next":4,"loan_factor":1.5667}',
  'the limit and the factors are those of 600');
select is(tests.call(:'teacher', 'select interest_profile(''a'') -> ''rates'''), tests.call(:'teacher', 'select interest_profile(''d'') -> ''rates'''),
  'and so are the rates, for every student');
select is(tests.call(:'teller', 'select lookup_student(''a'')') #>> '{credit,score}', '600', 'the counter''s card shows 600');

select is(tests.turn(false), '{"enabled":false,"changed":false,"students":0}', 'turning it off again changes nothing');
select is((select count(*)::int from credit_events where rule = 'switch_off'), 3, 'no further event');
select is((select count(*)::int from audit_log where action = 'credit.switch'), 1, 'nor log');

-- While off: no change by any rule, nor by hand; the jobs run as usual.
select is(array[app_private.credit_change('a', null, 'deposit_week', '上周有存款', 'weeks:2025-03-10'),
    app_private.credit_change('a', null, 'repay_on_time', '按时还清', 'loans:x:1'), app_private.credit_change('a', null, 'overdue', '逾期', 'loans:x:2'),
    app_private.credit_change('a', 30, 'manual', '测试')], array[null, null, null, null]::jsonb[], 'credit_change records nothing');
select is(tests.err(:'teacher', 'select adjust_credit(''a'', 10, ''表现好'')'), 'CREDIT_DISABLED', 'adjust_credit is refused');
select tests.student('late', 0) is not null as late \gset
select is((select score from credit_scores where student_no = 'late'), 600, 'a student opened while off starts at 600');

-- Each day on time, kept as text; then the term caught up at once: the same, with no change of score.
create function tests.state() returns text language sql as $$
  select concat_ws(' | ',
    (select string_agg(concat_ws(' ', student_no, rule, delta, score, ref), ', ' order by student_no, id) from credit_events),
    (select string_agg(concat_ws(' ', id, remaining, interest_centi, status), ', ' order by id) from loans),
    (select string_agg(concat_ws(' ', job, done_to, last_err), ', ' order by job) from job_runs), tests.scores())
$$;
savepoint every_day;
do $$
declare d date;
begin
  for d in select generate_series('2025-03-02'::date, '2025-04-14', interval '1 day') loop
    perform app_private.run_jobs(d);
  end loop;
end $$;
select tests.state() as every_day \gset
rollback to savepoint every_day;
select is(app_private.run_jobs('2025-04-14') -> 'failed', 'null', 'catching up the whole term at once');
select is(tests.state(), :'every_day', 'gives what every day on time gives');
select is((select count(*)::int from credit_events where rule not in ('manual', 'switch_off')), 0, 'no weekly rule, 按时还款 or 逾期 recorded');
select is((select array[status, (select count(*) from loan_periods where overdue_at is not null and loan_id = l.id)::text] from loans l where student_no = 'b'),
  array['overdue', '1'], 'b''s loan falls 逾期 all the same');
select is((select status from loans where student_no = 'a'), 'closed', 'and a''s is paid off by its days');
select is((select done_to from job_runs where job = 'weekly'), '2025-04-14'::date, 'the weekly job reaches the last Monday');
select is(app_private.run_jobs('2025-04-14') -> 'ran', '[]', 'running again does nothing');

-- On again: each student back at their score from before, the weeks missed not made up.
select is(tests.turn(true), '{"enabled":true,"changed":true,"students":3}', 'turned on: three scores restored');
select is(tests.scores(), 'a 700, b 450, c 350', 'each score back, 600 for one opened while off');
select is(array(select concat_ws(' ', student_no, delta, score, reason, ref = (select ref from credit_events where rule = 'switch_off' limit 1))
  from credit_events where rule = 'switch_on' order by student_no),
  array['a 100 700 信用分重新开启，恢复暂停前的分数 t', 'b -150 450 信用分重新开启，恢复暂停前的分数 t', 'c -250 350 信用分重新开启，恢复暂停前的分数 t'],
  'each a switch_on, by the ref of the switch_off it undoes');
select is(app_private.setting('credit_enabled'), 'true', 'settings.credit_enabled reads true');
select is(tests.turn(true), '{"enabled":true,"changed":false,"students":0}', 'turning it on again changes nothing');
select is(tests.scores(), 'a 700, b 450, c 350', 'nor any score');
select is(app_private.run_jobs('2025-04-14') -> 'ran', '[]', 'the weeks already run are not made up');
select is(app_private.credit_change('d', null, 'deposit_week', '上周有存款', 'weeks:2025-04-21') ->> 'score', '603', 'the rules count again');
select is(tests.call(:'teacher', 'select adjust_credit(''d'', -3, ''测试'')') #>> '{credit,score}', '600', 'and so does adjust_credit');

-- A second turn off and on, in the same transaction: its own ref, from the scores of then.
select is(tests.turn(false) ->> 'students', '3', 'off again');
select is(tests.call(:'teacher', 'select adjust_credit(''a'', 10, ''表现好'')') ->> 'error', 'CREDIT_DISABLED', 'refused again');
select is(tests.call(:'teacher', 'select set_credit_enabled(true, null)') ->> 'students', '3', 'and on, which needs no reason');
select is(tests.scores(), 'a 700, b 450, c 350', 'the same scores back');
select is((select count(distinct ref)::int from credit_events where rule like 'switch%'), 2, 'one ref per turn off');

select * from finish();
rollback;
