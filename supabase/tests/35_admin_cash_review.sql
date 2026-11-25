-- 复核轧账 by the bank admin (PHASE-2.md §3, §7.1): the accountant and the bank admin review, the reviewer is recorded,
-- tellers are refused, and each duty is reviewed once.
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('t2', 'teller') as t2 \gset
select tests.staff('acc', 'accountant') as acc \gset
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

-- Duty 1: an even count. Duty 2: the teller is one 10 short and says why. Duty 3: an even count again.
select id as d1 from duty where user_id = :'t1' \gset
select tests.call(:'t1', $$select end_duty(0, '{}')$$);
select tests.age(:'t1', '60 seconds');
select tests.call(:'t1', $$select start_duty('{"10":2}')$$) ->> 'id' as d2 \gset
select tests.call(:'t1', $$select end_duty(0, '{"10":1}', '少一张 10 元')$$);
select tests.age(:'t1', '50 seconds');
select tests.call(:'t1', $$select start_duty('{"5":2}')$$) ->> 'id' as d3 \gset
select tests.call(:'t1', $$select end_duty(0, '{"5":2}')$$);
select tests.age(:'t1', '40 seconds');

-- Who reviews.
select is(tests.call(:'t1', format($$select review_cash_count(%L)$$, :'d1')),
  '{"error":"FORBIDDEN","detail":"{\"roles\": [\"accountant\", \"teacher\"]}"}', 'a teller does not review');
select is((select status from cash_counts where duty_id = :'d1'), 'pending', 'and the duty still waits for review');
select is(tests.call(:'admin', $$select cash_review_overview()$$) -> 'pending', '3', 'the bank admin sees what waits for review');

-- 一致: the bank admin agrees with the teller's count.
select tests.call(:'admin', format($$select review_cash_count(%L)$$, :'d1')) as r1 \gset
select is(row(:'r1'::jsonb ->> 'status', :'r1'::jsonb -> 'review_count', :'r1'::jsonb -> 'balanced', :'r1'::jsonb ->> 'reviewed_by',
    :'r1'::jsonb ->> 'reviewer_name', (:'r1'::jsonb ->> 'reviewed_at')::timestamptz = now())::text,
  row('done', 'null'::jsonb, 'true'::jsonb, :'admin', 'admin', true)::text, 'the bank admin''s 复核通过: 已轧账, with the bank admin as reviewer');
select is((select reviewed_by from cash_counts where duty_id = :'d1'), :'admin'::uuid, 'reviewed_by is the bank admin');

-- 不一致: the bank admin's own count, with a reason when it differs from the teller's.
select is(tests.err(:'admin', format($$select review_cash_count(%L, '{"10":0}')$$, :'d2')), 'NOTE_REQUIRED',
  'a count unlike the teller''s needs a reason');
select tests.call(:'admin', format($$select review_cash_count(%L, '{"10":0}', '盒里没有 10 元')$$, :'d2')) as r2 \gset
select is(row(:'r2'::jsonb ->> 'status', :'r2'::jsonb #> '{review_count,10}', :'r2'::jsonb -> 'diff_total', :'r2'::jsonb ->> 'review_note',
    :'r2'::jsonb ->> 'reviewer_name')::text,
  row('done', '0'::jsonb, '-20'::jsonb, '盒里没有 10 元', 'admin')::text, 'the bank admin''s count stands and the difference is counted again');

-- 强制下班: the bank admin forces t2 off duty, then counts the box.
select tests.call(:'t2', $$select deposit(gen_random_uuid(), 's1', '{"5":2}')$$);
select tests.call(:'admin', format($$select force_end_duty(%L, '频繁操作')$$, :'dt2'));
select is(tests.err(:'admin', format($$select review_cash_count(%L)$$, :'dt2')), 'INVALID_INPUT', 'a forced duty needs a count');
select is(tests.err(:'admin', format($$select review_cash_count(%L, '{"5":1}')$$, :'dt2')), 'NOTE_REQUIRED',
  'with a reason when it differs from the expected');
select tests.call(:'admin', format($$select review_cash_count(%L, '{"5":2}')$$, :'dt2')) as r3 \gset
select is(row(:'r3'::jsonb ->> 'status', :'r3'::jsonb -> 'balanced', :'r3'::jsonb ->> 'forced_by', :'r3'::jsonb ->> 'reviewed_by')::text,
  row('done', 'true'::jsonb, :'admin', :'admin')::text, 'the bank admin reviews a forced duty, still showing it was forced');

-- Once only, whoever reviewed.
select is(tests.call(:'acc', format($$select review_cash_count(%L)$$, :'d1')) ->> 'detail', '{"field": "duty_id", "status": "done"}',
  'the accountant does not review again what the bank admin reviewed');
select is(tests.call(:'acc', format($$select review_cash_count(%L)$$, :'d3')) ->> 'reviewer_name', 'acc', 'the accountant still reviews');
select is(tests.call(:'admin', format($$select review_cash_count(%L)$$, :'d3')) ->> 'detail', '{"field": "duty_id", "status": "done"}',
  'and the bank admin does not review again what the accountant reviewed');
select is((select reviewed_by from cash_counts where duty_id = :'d3'), :'acc'::uuid, 'the first reviewer stays');

-- The 轧账 page names each reviewer.
select is(jsonb_path_query_array(tests.call(:'admin', format($$select cash_reviews(%L)$$, :'t1')), '$[*].reviewer_name'),
  '["acc", "admin", "admin"]', 'the list shows who reviewed each duty');
select is(tests.call(:'admin', $$select cash_review_overview()$$) -> 'pending', '0', 'and nothing waits for review');

select * from finish();
rollback;
