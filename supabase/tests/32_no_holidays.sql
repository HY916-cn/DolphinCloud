-- 学期内与假期相同 (PHASE-2.md §6.2, §6.3, §10.3, §13, §17, M20): with no term registered at all, every day does all the
-- daily work and every Monday all the weekly work; the days the jobs had done before stay as they were; a loan opens on
-- any day for up to 8 weeks past a term's end, and a term closes with a loan still open; no business is refused for want
-- of a term any more.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('t1', 'teller') as teller \gset
select app_private.cn_date(now()) as today \gset
create function tests.at(p text) returns timestamptz language sql as $$ select (p::timestamp) at time zone 'Asia/Shanghai' $$;
-- A student opened at p_opened (8:00) with an opening balance.
create function tests.old(p_no text, p_opening integer, p_opened date) returns void language plpgsql as $$
begin
  perform tests.student(p_no, 0);
  update students set opened_at = tests.at(p_opened || ' 08:00') where student_no = p_no;
  update accounts set balance = p_opening, total_in = p_opening where student_no = p_no;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
  select gen_random_uuid(), 'opening', p_no, p_opening, p_opening, p_opening, (select id from profiles where login_id = 'teacher'),
    tests.at(p_opened || ' 08:00') where p_opening > 0;
end $$;

-- No term at all. The jobs had done everything up to Sunday 2 March 2025; s opened in February with 700, b on 1 March
-- with 20 and c with nothing, b borrowing 100 for 2 weeks into the account on Monday 3 March and c 50 for 8 weeks on 4 March.
delete from terms;
update job_runs set done_to = '2025-03-02', last_ok = null, last_err = null;
select tests.old('s', 700, '2025-02-03');
select tests.old('b', 20, '2025-03-01');
select tests.old('c', 0, '2025-03-01');
select app_private.start_loan('00000000-0000-4000-8000-0000000000b1', 'b', 100, '测试', 'bullet', 2, 'account', :'teller', tests.at('2025-03-03 09:00')) is not null;
select app_private.start_loan('00000000-0000-4000-8000-0000000000c1', 'c', 50, '测试', 'bullet', 8, 'account', :'teller', tests.at('2025-03-04 09:00')) is not null;

select app_private.run_jobs('2025-03-18') as ran \gset
select is(:'ran'::jsonb -> 'failed', 'null', 'catching up 3 to 17 March with no term');
select is(:'ran'::jsonb -> 'ran' -> 0, '{"job":"weekly","day":"2025-03-03","status":"done"}', 'each job says what it did and that it is done');
select is(array(select distinct e ->> 'status' from jsonb_array_elements(:'ran'::jsonb -> 'ran') e), array['done'], 'every one of them done');
select is(jsonb_array_length(:'ran'::jsonb -> 'ran'), 15 + 3, 'all 15 days and 3 Mondays');

select is(array(select day from interest_accruals where student_no = 's' order by day),
  array(select d::date from generate_series(date '2025-03-03', '2025-03-17', '1 day') d), '活期计息 every day');
select is(array(select concat_ws(' ', created_at, reason) from txns where student_no = 's' and type = 'interest' order by created_at),
  array[concat_ws(' ', tests.at('2025-03-10 00:00'), '3月3日至3月9日活期利息'), concat_ws(' ', tests.at('2025-03-17 00:00'), '3月10日至3月16日活期利息')],
  '结息 every Monday');
select is(array(select concat_ws(' ', week_start, growth is not null) from rate_weeks order by week_start),
  array['2025-03-03 f', '2025-03-10 t', '2025-03-17 t'], 'an anchor every Monday, adjusted from the second on');
select is(array(select distinct ref from credit_events where student_no = 's' order by ref), array['weeks:2025-03-03', 'weeks:2025-03-10', 'weeks:2025-03-17'],
  '信用分 every Monday');
select is((select concat_ws(' ', l.status, l.closed_on, t.created_at) from loans l join txns t on t.loan_id = l.id and t.type = 'repay' where l.student_no = 'b'),
  concat_ws(' ', 'closed', '2025-03-17', tests.at('2025-03-18 00:00')), 'b''s loan accrued and was taken back on its day');
select is((select interest_centi > 0 from loans where student_no = 'c'), true, 'c''s accrues every day');
select is((select count(*)::int from interest_accruals where day < '2025-03-03'), 0, 'the days done before stay as they were');
select is(app_private.run_jobs('2025-03-18') -> 'ran', '[]', 'and nothing is done twice');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- 结转 (§6.3): a term from 3 to 9 March, after the jobs have run through it; c's loan, paid out in it, carries over.
insert into terms (name, starts_on, ends_on) values ('三月', '2025-03-03', '2025-03-09');
select is(app_private.term_open_items((select t from terms t where name = '三月')), '[]', 'a loan still open keeps no term from 结转');
select isnt(tests.call(:'teacher', format('select close_term(%L)', (select id from terms where name = '三月'))) ->> 'closed_at', null, 'the term closes');
select is((select status from loans where student_no = 'c'), 'active', 'and the loan runs on as it was');

-- The counter today with no term: a loan for 8 weeks; then in a term ending in 3 days, 8 weeks still.
select tests.student('s2', 50);
select tests.student('s3', 50);
select is(tests.call(:'teller', 'select loan_quote(''s2'')') - 'student_no' - 'score' - 'limit' - 'rate' - 'penalty_rate' - 'balance',
  '{"term":null,"max_weeks":8,"max_periods":8,"blocked":null,"loan":null}', 'no term: the quote has nothing in the way');
select is(tests.call(:'teller', $$select open_loan(gen_random_uuid(), 's2', 40, '买书', 'installment', 8, 'account')$$) #>> '{loan,schedule,7,due_on}',
  (:'today'::date + 56)::text, 'a loan of 8 periods paid out');
insert into terms (name, starts_on, ends_on) values ('本学期', :'today'::date - 10, :'today'::date + 3);
select is(tests.call(:'teller', 'select loan_quote(''s3'')') ->> 'max_weeks', '8', 'in a term ending in 3 days, still 8 weeks');
select is(tests.call(:'teller', $$select open_loan(gen_random_uuid(), 's3', 40, '买书', 'bullet', 8, 'account')$$) #>> '{loan,schedule,0,due_on}',
  (:'today'::date + 56)::text, 'due well past the term''s end');

-- No function refuses for want of a term or for running past one.
select is(count(*)::int, 0, 'NO_TERM and TERM_TOO_LONG are gone') from pg_proc where prosrc ~ 'NO_TERM|TERM_TOO_LONG';
select hasnt_function('app_private', 'require_term', 'and so is require_term');

select * from finish();
rollback;
