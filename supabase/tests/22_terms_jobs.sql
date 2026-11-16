-- 学期 and the scheduled jobs (PHASE-2.md §6, §13, §17): upsert_term and close_term with their rules and roles,
-- current_term, and run_daily / run_weekly / run_jobs on fixed days, every day and every Monday alike in term and in the
-- holidays.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.student('s1', 10) as student \gset
select app_private.cn_date(now()) as today \gset
create function tests.d(p_days integer) returns date language sql as $$ select app_private.cn_date(now()) + p_days $$;
create function tests.term(p_user uuid, p_id text, p_name text, p_starts date, p_ends date) returns jsonb language sql as $$
  select tests.call(p_user, format('select upsert_term(%L, %L, %L, %L)', p_id, p_name, p_starts, p_ends))
$$;

-- 登记 (§6.1): the bank admin alone.
select tests.term(:'teacher', null, '本学期', tests.d(-30), tests.d(30)) as a \gset
select is(:'a'::jsonb - 'id', jsonb_build_object('name', '本学期', 'starts_on', tests.d(-30), 'ends_on', tests.d(30),
  'closed_at', null, 'closed_by', null), 'the bank admin registers a term, which may have started already');
select is(tests.term(:'president', null, '行长的学期', tests.d(100), tests.d(110)) ->> 'error', 'FORBIDDEN', 'the president may not');
select is(tests.term(:'ops', null, '运维的学期', tests.d(100), tests.d(110)) ->> 'error', 'FORBIDDEN', 'nor the sysadmin');
select is(tests.term(:'teller', null, '柜员的学期', tests.d(100), tests.d(110)) ->> 'error', 'FORBIDDEN', 'nor a teller');
select is(tests.call(:'president', format('select close_term(%L)', :'a'::jsonb ->> 'id')) ->> 'error', 'FORBIDDEN', 'the president closes no term');
select is((select count(*)::int from terms), 1, 'only the bank admin''s term is there');
select is(count(*)::int, 1, 'the term is audited') from audit_log where action = 'terms.insert';

-- The rules.
select is(tests.term(:'teacher', null, '倒序', tests.d(100), tests.d(99)) ->> 'detail', '{"field": "ends_on"}', 'the end is not before the start');
select is(tests.term(:'teacher', null, '一天', tests.d(100), tests.d(100)) ->> 'ends_on', tests.d(100)::text, 'a term may be one day');
select is(tests.term(:'teacher', null, ' ', tests.d(200), tests.d(210)) ->> 'detail', '{"field": "name"}', 'a term has a name');
select is(tests.term(:'teacher', null, '本学期', tests.d(200), tests.d(210)) ->> 'error', 'ALREADY_EXISTS', 'one name per term');
select is(tests.term(:'teacher', null, '下学期', tests.d(30), tests.d(60)) ->> 'detail', '{"term": "本学期"}',
  'terms do not overlap, not even on one day: the other term is named');
select is(tests.term(:'teacher', null, '下学期', tests.d(30), tests.d(60)) ->> 'error', 'TERM_OVERLAP', 'with its own code');
select tests.term(:'teacher', null, '下学期', tests.d(36), tests.d(60)) as b \gset
select ok(:'b'::jsonb ? 'id', 'the next term starts the day after it ends at the earliest');

select is(tests.term(:'teacher', :'a'::jsonb ->> 'id', '本学期', tests.d(-29), tests.d(30)) ->> 'detail', '{"field": "starts_on"}',
  'a term that has started keeps its start');
select is(tests.term(:'teacher', :'a'::jsonb ->> 'id', '2026 学年第一学期', tests.d(-30), tests.d(25)) - 'id',
  jsonb_build_object('name', '2026 学年第一学期', 'starts_on', tests.d(-30), 'ends_on', tests.d(25), 'closed_at', null, 'closed_by', null),
  'but may be renamed and end on another day still to come');
select is(tests.term(:'teacher', :'a'::jsonb ->> 'id', '2026 学年第一学期', tests.d(-30), tests.d(-1)) ->> 'detail', '{"field": "ends_on"}',
  'not on a day already past');
select is(tests.term(:'teacher', :'b'::jsonb ->> 'id', '下学期', tests.d(-1), tests.d(60)) ->> 'detail', '{"field": "starts_on"}',
  'a term to come does not start in the past');
select is(tests.term(:'teacher', :'b'::jsonb ->> 'id', '下学期', tests.d(40), tests.d(60)) ->> 'starts_on', tests.d(40)::text,
  'but moves its start to a day to come');
select tests.term(:'teacher', null, '上学期', tests.d(-100), tests.d(-50)) as c \gset
select ok(:'c'::jsonb ? 'id', 'a term may be registered after the fact');
select is(tests.term(:'teacher', :'c'::jsonb ->> 'id', '上学期', tests.d(-100), tests.d(-49)) ->> 'detail', '{"field": "ends_on"}',
  'and keeps the end it had once that is past');
select is(tests.term(:'teacher', gen_random_uuid()::text, '新学期', tests.d(300), tests.d(310)) ->> 'name', '新学期',
  'an id not yet used registers a new term');

-- Everyone signed in reads the terms; the job progress is the sysadmin's and the bank admin's (and president's).
select is(tests.call(w, 'select count(*) from terms'), '5', 'terms readable') from unnest(array[:'student', :'teller', :'keeper', :'ops']::uuid[]) w;
select is(tests.call(w, 'select count(*) from job_runs'), '2', 'job_runs readable') from unnest(array[:'ops', :'teacher', :'president']::uuid[]) w;
select is(tests.call(w, 'select count(*) from job_runs'), '0', 'job_runs hidden') from unnest(array[:'student', :'teller', :'keeper']::uuid[]) w;

-- 当前学期.
select is((app_private.current_term(:'today')).id::text, :'a'::jsonb ->> 'id', 'today is in the current term');
select is((app_private.current_term(tests.d(25))).name, '2026 学年第一学期', 'its last day too');
select ok((app_private.current_term(tests.d(26))).id is null, 'the days between terms are the holidays');

-- 结转 (§6.3).
select count(*) as txns_before from txns \gset
select is(tests.call(:'teacher', format('select close_term(%L)', :'a'::jsonb ->> 'id')) ->> 'detail',
  jsonb_build_object('ends_on', tests.d(25))::text, 'a term closes only after its last day');
select is(tests.call(:'teacher', format('select close_term(%L)', :'a'::jsonb ->> 'id')) ->> 'error', 'TERM_NOT_ENDED', 'TERM_NOT_ENDED');
select is(tests.call(:'teacher', format('select close_term(%L)', gen_random_uuid())) ->> 'detail', '{"field": "term_id"}', 'an unknown term');
-- Until the daily job has done the term's last day, that day's work is still to come.
update job_runs set done_to = tests.d(-51) where job = 'daily';
select is(tests.call(:'teacher', format('select close_term(%L)', :'c'::jsonb ->> 'id')) ->> 'error', 'TERM_OPEN_ITEMS', 'TERM_OPEN_ITEMS');
select is(tests.call(:'teacher', format('select close_term(%L)', :'c'::jsonb ->> 'id')) ->> 'detail',
  jsonb_build_object('items', jsonb_build_array(jsonb_build_object('kind', 'job', 'job', 'daily', 'done_to', tests.d(-51))))::text,
  'listing what is open');
update job_runs set done_to = tests.d(-1) where job = 'daily';
select tests.call(:'teacher', format('select close_term(%L)', :'c'::jsonb ->> 'id')) as closed \gset
select is(:'closed'::jsonb ->> 'closed_by', :'teacher', 'the bank admin closes an ended term');
select ok((:'closed'::jsonb ->> 'closed_at')::timestamptz = now(), 'closed now');
select is(count(*)::int, 1, 'closing is logged as term.close') from audit_log
  where action = 'term.close' and target = 'terms:' || (:'c'::jsonb ->> 'id') and actor_id = :'teacher' and after ->> 'closed_at' is not null;
select is((select count(*) from txns), :'txns_before'::bigint, 'and makes no transaction');
select is(tests.call(:'teacher', format('select close_term(%L)', :'c'::jsonb ->> 'id')) ->> 'error', 'TERM_CLOSED', 'a term closes once');
select is(tests.term(:'teacher', :'c'::jsonb ->> 'id', '改名', tests.d(-100), tests.d(-50)) ->> 'error', 'TERM_CLOSED',
  'and a closed term no longer changes');

-- The jobs (§13, §17), on fixed days in 2025. 本学期 and 下学期 are far from these days.
-- 春季: Monday 3 March to Thursday 20 March; 夏季: Wednesday 26 March to 30 April.
insert into terms (name, starts_on, ends_on) values ('春季', '2025-03-03', '2025-03-20'), ('夏季', '2025-03-26', '2025-04-30');
update job_runs set done_to = '2025-02-27', last_ok = null, last_err = null;
create table tests.ran (run text, n serial, line text);
-- One line per job a run_jobs did: job, day, status.
create function tests.run(p_run text, p_today date) returns jsonb language plpgsql as $$
declare v jsonb := app_private.run_jobs(p_today);
begin
  insert into tests.ran (run, line)
  select p_run, concat_ws(' ', e ->> 'job', e ->> 'day', e ->> 'status')
  from jsonb_array_elements(v -> 'ran') with ordinality x(e, i) order by i;
  return v;
end $$;
create function tests.lines(p_run text) returns text[] language sql as $$ select array(select line from tests.ran where run = p_run order by n) $$;
create function tests.progress() returns text language sql as $$
  select string_agg(job || ' ' || done_to || ' ' || coalesce(last_err, 'ok'), ', ' order by job) from job_runs
$$;

select is(tests.run('start', '2025-03-05') -> 'failed', 'null', 'catching up from 28 February to 5 March');
select is(tests.lines('start'), array['daily 2025-02-28 done', 'daily 2025-03-01 done', 'daily 2025-03-02 done',
  'weekly 2025-03-03 done', 'daily 2025-03-03 done', 'daily 2025-03-04 done'],
  'the days up to yesterday and the Mondays up to today, in time order, the holidays as the days in term');
select is(tests.progress(), 'daily 2025-03-04 ok, weekly 2025-03-03 ok', 'job_runs records how far each job has got');
select ok((select bool_and(last_ok = now()) from job_runs), 'and when it last succeeded');
select is(app_private.run_jobs('2025-03-05'), '{"ran": [], "failed": null}', 'running again the same day does nothing');
select is(app_private.run_daily('2025-03-03') ->> 'status', 'skipped', 'a day already done is skipped');
select is(app_private.run_weekly('2025-03-03') ->> 'status', 'skipped', 'and a Monday already done');
select is(tests.progress(), 'daily 2025-03-04 ok, weekly 2025-03-03 ok', 'so job_runs is as it was');
select throws_ok($$select app_private.run_daily('2025-03-06')$$, 'P0001', 'INVALID_INPUT', 'no day is left out');
select throws_ok($$select app_private.run_weekly('2025-03-11')$$, 'P0001', 'INVALID_INPUT', 'the weekly job runs on Mondays');
select throws_ok($$select app_private.run_weekly('2025-03-10')$$, 'P0001', 'INVALID_INPUT', 'after the daily job for the Sunday');
select throws_ok(format('select app_private.run_jobs(%L)', tests.d(1)), 'P0001', 'INVALID_INPUT', 'and never ahead of today');

-- Every day to 1 April, against a server down on 15, 16 and 17 March (a Monday among them): the same jobs, the same days.
select count(tests.run('every day', d::date)) from generate_series(date '2025-03-06', '2025-04-01', '1 day') d;
select tests.progress() as every_day \gset
update job_runs set done_to = '2025-03-04' where job = 'daily';
update job_runs set done_to = '2025-03-03' where job = 'weekly';
select count(tests.run('down', d::date)) from generate_series(date '2025-03-06', '2025-04-01', '1 day') d
where d not between '2025-03-15' and '2025-03-17';
select is(tests.lines('down'), tests.lines('every day'), 'catching up after three days down does what running every day does');
select is(tests.progress(), :'every_day', 'and gets as far');
select is(tests.progress(), 'daily 2025-03-31 ok, weekly 2025-03-31 ok', 'to yesterday, and to today''s Monday');
select is(array(select line from tests.ran where run = 'down' and line like 'weekly%' order by n), array['weekly 2025-03-10 done',
  'weekly 2025-03-17 done', 'weekly 2025-03-24 done', 'weekly 2025-03-31 done'],
  'every Monday is worked, the one in the holidays and the first of a term too');
select is(array(select line from tests.ran where run = 'down' and line like 'daily 2025-03-2%' order by n), array['daily 2025-03-20 done',
  'daily 2025-03-21 done', 'daily 2025-03-22 done', 'daily 2025-03-23 done', 'daily 2025-03-24 done',
  'daily 2025-03-25 done', 'daily 2025-03-26 done', 'daily 2025-03-27 done', 'daily 2025-03-28 done',
  'daily 2025-03-29 done'], 'and every day, the days between terms too');
select is((select line from tests.ran where run = 'down' and n = (select min(n) from tests.ran where run = 'down' and line like '% 2025-03-17%')),
  'weekly 2025-03-17 done', 'on a Monday the weekly job runs before that day''s daily job');

-- A day that fails stops the run there and is recorded; the days before it stay done.
update job_runs set done_to = '2025-03-04' where job = 'daily';
update job_runs set done_to = '2025-03-03' where job = 'weekly';
create function tests.fail_on() returns trigger language plpgsql as $$
begin
  if new.job = 'daily' and new.done_to = '2025-03-07' then raise exception 'disk full'; end if;
  return new;
end $$;
create trigger fail_on before update on job_runs for each row execute function tests.fail_on();
select is(tests.run('failing', '2025-03-12') -> 'failed', '{"job": "daily", "day": "2025-03-07", "error": "disk full"}',
  'run_jobs reports the job and day that failed');
select is(tests.lines('failing'), array['daily 2025-03-05 done', 'daily 2025-03-06 done'], 'after doing the days before it');
select is(tests.progress(), 'daily 2025-03-06 2025-03-07: disk full, weekly 2025-03-03 ok', 'and stops there: neither 7 March nor the Monday after is done');
select is((select last_err from job_runs where job = 'daily'), '2025-03-07: disk full', 'the error is kept in job_runs');
select is((select after from audit_log where action = 'job.failed' order by id desc limit 1),
  '{"job": "daily", "day": "2025-03-07", "error": "disk full"}', 'and logged as job.failed');
drop trigger fail_on on job_runs;
select is(tests.run('fixed', '2025-03-12') -> 'failed', 'null', 'the next run goes on from the day that failed');
select is(tests.lines('fixed'), array['daily 2025-03-07 done', 'daily 2025-03-08 done', 'daily 2025-03-09 done',
  'weekly 2025-03-10 done', 'daily 2025-03-10 done', 'daily 2025-03-11 done'], 'up to yesterday');
select is(tests.progress(), 'daily 2025-03-11 ok, weekly 2025-03-10 ok', 'and clears the error');

select * from finish();
rollback;
