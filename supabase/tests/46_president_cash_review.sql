-- 轧账 by the president (PHASE-2.md §3, §7): the president reviews, forces off duty and reads 轧账 like the bank admin,
-- is recorded as the reviewer, and keeps the president's other limits.
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('t2', 'teller') as t2 \gset
select tests.staff('acc', 'accountant') as acc \gset
select tests.staff('p1', 'president') as p1 \gset
select tests.staff('admin', 'teacher') as admin \gset
select tests.student('s1', 200) as s1 \gset
select id as dt2 from duty where user_id = :'t2' \gset

-- Within the test's one transaction now() stands still: t1's ended duties and transactions move back by p_by.
create function tests.age(p_user uuid, p_by interval) returns void language plpgsql as $$
begin
  perform set_config('session_replication_role', 'replica', true);
  update txns set created_at = created_at - p_by where operator_id = p_user;
  update duty set started_at = started_at - p_by, ended_at = ended_at - p_by where user_id = p_user and ended_at is not null;
  perform set_config('session_replication_role', 'origin', true);
end $$;

-- Duty 1: an even count. Duty 2: the teller is one 10 short and says why.
select id as d1 from duty where user_id = :'t1' \gset
select tests.call(:'t1', $$select end_duty(0, '{}')$$);
select tests.age(:'t1', '60 seconds');
select tests.call(:'t1', $$select start_duty('{"10":2}')$$) ->> 'id' as d2 \gset
select tests.call(:'t1', $$select end_duty(0, '{"10":1}', '少一张 10 元')$$);
select tests.age(:'t1', '50 seconds');

-- The president reads what waits for review.
select is(tests.call(:'p1', $$select cash_review_overview()$$) -> 'pending', '2', 'the president sees what waits for review');
select is(jsonb_array_length(tests.call(:'p1', format($$select cash_reviews(%L)$$, :'t1'))), 2, 'and lists the teller''s duties');
select is(tests.call(:'p1', format($$select duty_cash(%L)$$, :'d2')) #> '{expected,counts}', '{"1":0,"2":0,"5":0,"10":2}',
  'and reads a duty''s cash');
select is(tests.call(:'p1', $$select to_jsonb(count(*)) from cash_counts$$), to_jsonb((select count(*) from cash_counts)),
  'and every row of cash_counts');

-- 一致: the president agrees with the teller's count and is the reviewer.
select tests.call(:'p1', format($$select review_cash_count(%L)$$, :'d1')) as r1 \gset
select is(row(:'r1'::jsonb ->> 'status', :'r1'::jsonb -> 'balanced', :'r1'::jsonb ->> 'reviewed_by', :'r1'::jsonb ->> 'reviewer_name')::text,
  row('done', 'true'::jsonb, :'p1', 'p1')::text, 'the president''s 复核通过: 已轧账, with the president as reviewer');
select is((select reviewed_by from cash_counts where duty_id = :'d1'), :'p1'::uuid, 'reviewed_by is the president');

-- 不一致: the president's own count, with a reason when it differs from the teller's.
select is(tests.err(:'p1', format($$select review_cash_count(%L, '{"10":0}')$$, :'d2')), 'NOTE_REQUIRED',
  'a count unlike the teller''s needs a reason');
select tests.call(:'p1', format($$select review_cash_count(%L, '{"10":0}', '盒里没有 10 元')$$, :'d2')) as r2 \gset
select is(row(:'r2'::jsonb ->> 'status', :'r2'::jsonb -> 'diff_total', :'r2'::jsonb ->> 'review_note', :'r2'::jsonb ->> 'reviewer_name')::text,
  row('done', '-20'::jsonb, '盒里没有 10 元', 'p1')::text, 'the president''s count stands and the difference is counted again');

-- 强制下班, then the president counts the box.
select tests.call(:'t2', $$select deposit(gen_random_uuid(), 's1', '{"5":2}')$$);
select is(tests.call(:'p1', format($$select force_end_duty(%L, '频繁操作')$$, :'dt2')) ->> 'status', 'forced', 'the president forces t2 off duty');
select is(tests.err(:'p1', format($$select review_cash_count(%L)$$, :'dt2')), 'INVALID_INPUT', 'a forced duty needs a count');
select tests.call(:'p1', format($$select review_cash_count(%L, '{"5":2}')$$, :'dt2')) as r3 \gset
select is(row(:'r3'::jsonb ->> 'status', :'r3'::jsonb -> 'balanced', :'r3'::jsonb ->> 'forced_by', :'r3'::jsonb ->> 'reviewed_by')::text,
  row('done', 'true'::jsonb, :'p1', :'p1')::text, 'the president reviews a forced duty, still showing it was forced');

-- Once only, whoever reviewed.
select is(tests.call(:'admin', format($$select review_cash_count(%L)$$, :'d1')) ->> 'detail', '{"field": "duty_id", "status": "done"}',
  'the bank admin does not review again what the president reviewed');
select is(tests.call(:'acc', format($$select review_cash_count(%L)$$, :'d2')) ->> 'detail', '{"field": "duty_id", "status": "done"}',
  'nor the accountant');
select is(tests.call(:'p1', $$select cash_review_overview()$$) -> 'pending', '0', 'and nothing waits for review');

-- Tellers still do not review, and the president's other limits stay.
select is(tests.call(:'t1', format($$select review_cash_count(%L)$$, :'d1')),
  '{"error":"FORBIDDEN","detail":"{\"roles\": [\"accountant\", \"teacher\"]}"}', 'a teller does not review');
select is(tests.err(:'p1', $$select handle_alert(0, 'seen')$$), 'FORBIDDEN', 'the president still does not handle risk alerts');
select is(tests.err(:'p1', $$select manual_entry(gen_random_uuid(), 's1', 'adjust', now(), 'x', 1)$$), 'FORBIDDEN',
  'nor enters transactions by hand');

select * from finish();
rollback;
