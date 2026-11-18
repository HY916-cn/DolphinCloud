-- 轧账 (PHASE-2.md §7): 下班 with the teller's count compared by denomination, a reason when it differs, the
-- review, 强制下班, the next 上班 from the last count, the 轧账 page's list, and the cash of reversals made
-- later or by the bank admin (§7.3).
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('t2', 'teller') as t2 \gset
select tests.staff('acc', 'accountant') as acc \gset
select tests.staff('t3', 'teller') as t3 \gset
select tests.staff('p1', 'president') as p1 \gset
select tests.staff('teacher', 'teacher') as teacher \gset
select tests.student('s1', 200) as s1 \gset
select id as d0 from duty where user_id = :'t1' \gset
select id as dt2 from duty where user_id = :'t2' \gset

-- Within the test's one transaction now() stands still: a teller's ended duties and their transactions move back by p_by.
create function tests.age(p_user uuid, p_by interval) returns void language plpgsql as $$
begin
  perform set_config('session_replication_role', 'replica', true);
  update txns set created_at = created_at - p_by where operator_id = p_user;
  update duty set started_at = started_at - p_by, ended_at = ended_at - p_by where user_id = p_user and ended_at is not null;
  perform set_config('session_replication_role', 'origin', true);
end $$;

-- 下班 without a count, as before: nothing compared, the accountant counts at review.
select tests.call(:'t1', $$select end_duty(0)$$) as e0 \gset
select is(row(:'e0'::jsonb ->> 'status', :'e0'::jsonb -> 'teller_count', :'e0'::jsonb -> 'diff', :'e0'::jsonb -> 'balanced')::text,
  row('pending', 'null'::jsonb, 'null'::jsonb, 'null'::jsonb)::text, '下班 without a count compares nothing and waits for review');
select tests.age(:'t1', '60 seconds');

-- Duty 1: 备用金 1×20 2×10 5×4; a deposit of 10×2 5×1 and a withdrawal of 13 (10 + 2 + 1).
select tests.call(:'t1', $$select start_duty('{"1":20,"2":10,"5":4}')$$) ->> 'id' as d1 \gset
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000081', 's1', '{"10":2,"5":1}')$$);
select tests.call(:'t1', $$select withdraw('00000000-0000-4000-8000-000000000082', 's1', 13)$$);

select is(tests.err(:'t1', $$select end_duty(2, '{"3":1}')$$), 'INVALID_AMOUNT', 'a count is of the configured denominations');
select is(tests.err(:'t1', $$select end_duty(2, '{"1":-1}')$$), 'INVALID_AMOUNT', 'and not negative');
select is(tests.call(:'t1', $$select end_duty(2, '{"1":19,"2":9,"5":5}')$$),
  '{"error":"NOTE_REQUIRED","detail":"{\"diff\": {\"1\": 0, \"2\": 0, \"5\": 0, \"10\": -1}}"}',
  'a count short of the expected notes needs a reason, and the error says the difference');
select is(tests.err(:'t1', $$select end_duty(2, '{"1":19,"2":9,"5":5}', '  ')$$), 'NOTE_REQUIRED', 'a blank reason is none');
select is(tests.err(:'t1', format($$select end_duty(2, '{"1":19,"2":9,"5":5}', %L)$$, repeat('长', 201))), 'INVALID_INPUT',
  'a reason is 200 characters at most');
select is((select ended_at from duty where id = :'d1'), null, 'the duty stays open');

select tests.call(:'t1', $$select end_duty(2, '{"1":19,"2":9,"5":5,"10":1}')$$) as e1 \gset
select is(:'e1'::jsonb - 'cash_txns' - 'started_at' - 'ended_at', jsonb_build_object('id', :'d1', 'duty_id', :'d1', 'user_id', :'t1',
    'name', 't1', 'txns', 2, 'status', 'pending', 'float', '{"1":20,"2":10,"5":4,"10":0}'::jsonb,
    'expected', '{"1":19,"2":9,"5":5,"10":1}'::jsonb, 'teller_count', '{"1":19,"2":9,"5":5,"10":1}'::jsonb, 'teller_note', null,
    'review_count', null, 'review_note', null, 'count', '{"1":19,"2":9,"5":5,"10":1}'::jsonb,
    'diff', '{"1":0,"2":0,"5":0,"10":0}'::jsonb, 'balanced', true, 'expected_total', 72, 'teller_total', 72, 'count_total', 72, 'diff_total', 0, 'reviewed_by', null, 'reviewer_name', null, 'reviewed_at', null,
    'forced_by', null, 'forced_reason', null, 'overdue', false, 'reversed', '[]'::jsonb),
  '平账: 下班 with no reason, waiting for review');
select is(jsonb_path_query_array(:'e1'::jsonb, '$.cash_txns[*] ? (@.type == "deposit").income'), '[{"5":1,"10":2}]',
  'with each transaction that moved cash: the deposit''s notes in');
select is(jsonb_path_query_array(:'e1'::jsonb, '$.cash_txns[*] ? (@.type == "withdraw").payout'), '[{"1":1,"2":1,"10":1}]',
  'the withdrawal''s out');
select tests.age(:'t1', '50 seconds');

-- Duty 2 begins from duty 1's count; reversing duty 1's deposit pays 10×2 5×1 out here (§7.3).
select tests.call(:'t1', $$select start_duty()$$) as s2 \gset
select :'s2'::jsonb ->> 'id' as d2 \gset
select is(:'s2'::jsonb -> 'float', '{"1":19,"2":9,"5":5,"10":1}', '上班 begins from the last count by default');
select tests.call(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000081', '学号录错')$$);
select tests.call(:'t1', $$select end_duty(1, '{"1":19,"2":9,"5":4}', ' 少找了一张 10 元 ')$$) as e2 \gset
select is(row(:'e2'::jsonb ->> 'status', :'e2'::jsonb -> 'diff', :'e2'::jsonb -> 'balanced', :'e2'::jsonb ->> 'teller_note')::text,
  row('pending', '{"1":0,"2":0,"5":0,"10":1}'::jsonb, 'false'::jsonb, '少找了一张 10 元')::text,
  '不平: 下班 with the reason, the difference by denomination');
select is(jsonb_path_query_array(:'e2'::jsonb, '$.cash_txns[*].payout'), '[{"5":1,"10":2}]', 'the reversal is among its cash');
select tests.age(:'t1', '40 seconds');

-- 复核
select is(tests.err(:'t1', format($$select review_cash_count(%L)$$, :'d1')), 'FORBIDDEN', 'a teller does not review');
select is(tests.err(:'p1', format($$select review_cash_count(%L)$$, :'d1')), 'FORBIDDEN', 'nor the president');
select is(tests.call(:'acc', $$select review_cash_count(gen_random_uuid())$$) ->> 'detail', '{"field": "duty_id"}', 'an unknown duty');
select tests.call(:'acc', format($$select review_cash_count(%L)$$, :'d1')) as r1 \gset
select is(row(:'r1'::jsonb ->> 'status', :'r1'::jsonb -> 'review_count', :'r1'::jsonb -> 'count', :'r1'::jsonb ->> 'reviewer_name',
    (:'r1'::jsonb ->> 'reviewed_at')::timestamptz = now())::text,
  row('done', 'null'::jsonb, :'e1'::jsonb -> 'teller_count', 'acc', true)::text, '复核通过 agreeing with the teller: 已轧账');
select is(tests.call(:'acc', format($$select review_cash_count(%L)$$, :'d1')) ->> 'detail', '{"field": "duty_id", "status": "done"}',
  'a duty is reviewed once');
select is(tests.err(:'acc', format($$select review_cash_count(%L)$$, :'d0')), 'INVALID_INPUT', 'agreeing needs a teller''s count');
select is(tests.call(:'acc', format($$select review_cash_count(%L, '{}')$$, :'d0')) -> 'balanced', 'true',
  'without one the accountant enters theirs; no reason when it is even');

savepoint same;
select is(tests.call(:'acc', format($$select review_cash_count(%L, '{"1":19,"2":9,"5":4}')$$, :'d2')) -> 'diff_total', '10',
  'the accountant''s count the same as the teller''s needs no reason of theirs, even or not');
rollback to savepoint same;
select is(tests.err(:'acc', format($$select review_cash_count(%L, '{"1":18,"2":9,"5":4}')$$, :'d2')), 'NOTE_REQUIRED',
  'the accountant''s count differing from the teller''s needs a reason');
select tests.call(:'acc', format($$select review_cash_count(%L, '{"1":18,"2":9,"5":4}', '盒里少一张 1 元')$$, :'d2')) as r2 \gset
select is(row(:'r2'::jsonb ->> 'status', :'r2'::jsonb -> 'count', :'r2'::jsonb -> 'diff', :'r2'::jsonb ->> 'review_note',
    :'r2'::jsonb ->> 'teller_note')::text,
  row('done', '{"1":18,"2":9,"5":4,"10":0}'::jsonb, '{"1":-1,"2":0,"5":0,"10":1}'::jsonb, '盒里少一张 1 元', '少找了一张 10 元')::text,
  'the accountant''s count stands and the difference is counted again');

-- Duty 3 begins from the accountant's count; the bank admin reverses one of its deposits, and its cash stays here.
select is(tests.call(:'t1', $$select default_float()$$), '{"1":18,"2":9,"5":4,"10":0}', 'the 上班 card reads the default 备用金');
select is(tests.err(:'acc', $$select default_float()$$), 'FORBIDDEN', 'a teller''s own');
select is(tests.call(:'t1', $$select start_duty()$$) -> 'float', '{"1":18,"2":9,"5":4,"10":0}',
  'the next 上班 begins from the accountant''s count');
select is(tests.call(:'acc', format($$select review_cash_count(%L)$$, (select id from duty where user_id = :'t1' and ended_at is null))) ->> 'detail',
  '{"field": "duty_id", "status": "open"}', 'a duty still on is not reviewed');
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000084', 's1', '{"10":1}')$$);
select tests.call(:'teacher', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000084', '金额录错')$$);
select is(tests.call(:'t1', $$select duty_cash()$$) #> '{expected,counts}', '{"1":18,"2":9,"5":4,"10":1}',
  'the bank admin''s reversal is in no duty: the deposit stays in the teller''s');
select is(tests.call(:'t1', $$select duty_cash()$$) #> '{cash_txns,0,status}', '"reversed"', 'shown reversed');
select is((select count(*)::int from duty where user_id = :'teacher'), 0, 'and the bank admin has no duty');

-- 强制下班: t2 deposits 5×2, is counted for attendance and has no shift signed yet.
insert into staff_payroll (user_id, attendance) values (:'t2', true);
select tests.call(:'t2', $$select deposit(gen_random_uuid(), 's1', '{"5":2}')$$);
select is(tests.err(:'t1', format($$select force_end_duty(%L, '频繁操作')$$, :'dt2')), 'FORBIDDEN', 'a teller forces no one off duty');
select is(tests.err(:'acc', format($$select force_end_duty(%L, '频繁操作')$$, :'dt2')), 'FORBIDDEN', 'nor the accountant');
select is(tests.call(:'p1', format($$select force_end_duty(%L, ' ')$$, :'dt2')) ->> 'detail', '{"field": "reason"}', 'with a reason');
select is(tests.call(:'p1', $$select force_end_duty(gen_random_uuid(), '频繁操作')$$) ->> 'detail', '{"field": "duty_id"}', 'an unknown duty');
select tests.call(:'p1', format($$select force_end_duty(%L, ' 频繁操作 ')$$, :'dt2')) as f \gset
select is(row(:'f'::jsonb ->> 'status', :'f'::jsonb -> 'expected', :'f'::jsonb -> 'teller_count', :'f'::jsonb ->> 'forced_by',
    :'f'::jsonb ->> 'forced_reason', :'f'::jsonb -> 'balanced', :'f'::jsonb ->> 'ended_at' is not null)::text,
  row('forced', '{"1":0,"2":0,"5":2,"10":0}'::jsonb, 'null'::jsonb, :'p1', '频繁操作', 'null'::jsonb, true)::text,
  'the president ends the duty: 强制下班, the expected notes and no count');
select is((select txns from duty where id = :'dt2'), 1, 'with its transactions counted');
select is((select count(*)::int from attendance where user_id = :'t2'), 0, 'no shift is signed for the teller');
select is(tests.call(:'teacher', format($$select force_end_duty(%L, '再强制')$$, :'dt2')) ->> 'detail',
  '{"field": "duty_id", "status": "forced"}', 'an ended duty is not ended again');
select is(tests.err(:'t2', $$select deposit(gen_random_uuid(), 's1', '{"5":1}')$$), 'OFF_DUTY', 'the teller serves no more');
select is(tests.err(:'t2', $$select end_duty(1)$$), 'OFF_DUTY', 'and has no duty to end');
select is(tests.err(:'acc', format($$select review_cash_count(%L)$$, :'dt2')), 'INVALID_INPUT', 'the accountant counts a forced duty');
select is(tests.err(:'acc', format($$select review_cash_count(%L, '{"5":1}')$$, :'dt2')), 'NOTE_REQUIRED',
  'with a reason when it differs from the expected');
select is(tests.call(:'acc', format($$select review_cash_count(%L, '{"5":2}')$$, :'dt2')) ->> 'forced_reason', '频繁操作',
  'and reviews it, still showing it was forced');
select is(tests.call(:'teacher', format($$select force_end_duty((select id from duty where user_id = %L and ended_at is null), '频繁操作')$$, :'t3'))
  ->> 'status', 'forced', 'the bank admin forces too');
select tests.call(:'t3', $$select start_duty()$$) ->> 'id' as d3 \gset
select is(tests.call(:'t3', $$select end_duty(0, '{}')$$) -> 'balanced', 'true', 'an empty count of an empty box is even');

-- The 轧账 page.
select is(tests.err(:'t1', $$select cash_reviews()$$), 'FORBIDDEN', 'a teller does not list 轧账');
select is(tests.err(:'acc', $$select cash_reviews(p_status => '{late}')$$), 'INVALID_INPUT', 'statuses are open, pending, done and forced');
select is(jsonb_path_query_array(tests.call(:'acc', format($$select cash_reviews(%L)$$, :'t1')), '$[*].status'),
  '["open", "done", "done", "done"]', 'a teller''s duties, the latest first');
select is(jsonb_array_length(tests.call(:'p1', $$select cash_reviews(p_status => '{forced,pending}')$$)), 2, 'by status, for the president');
select is(jsonb_array_length(tests.call(:'teacher', format($$select cash_reviews(p_from => %L, p_to => %L)$$, app_private.cn_date(now()), app_private.cn_date(now())))),
  jsonb_array_length(tests.call(:'teacher', $$select cash_reviews()$$)), 'by the day 上班 began, for the bank admin');
select is(tests.call(:'acc', format($$select cash_reviews(p_from => %L)$$, app_private.cn_date(now()) + 1)), '[]', 'none from tomorrow');
select is(tests.call(:'acc', format($$select cash_reviews(%L)$$, :'t1')) -> 2 -> 'reversed', jsonb_build_array(jsonb_build_object(
    'txn_no', (select txn_no from txns where id = '00000000-0000-4000-8000-000000000081'),
    'reversed_at', (select created_at from txns where reversal_of = '00000000-0000-4000-8000-000000000081'))),
  'duty 1 says which of its transactions were reversed later, and when');
select is(tests.call(:'acc', format($$select cash_reviews(%L)$$, :'t1')) #> '{0,reversed,0,txn_no}',
  to_jsonb((select txn_no from txns where id = '00000000-0000-4000-8000-000000000084')), 'and so does a duty the bank admin reversed in');
update duty set started_at = now() - interval '1 day 1 hour', ended_at = now() - interval '1 day' where id = :'d3';
select is(jsonb_path_query_array(tests.call(:'acc', format($$select cash_reviews(%L)$$, :'t3')), '$[*].overdue'), '[false, true]',
  'a duty still waiting for review the day after 下班 is overdue');


-- 财务总览: what waits for review, the overdue, the 5 waiting longest.
select is(tests.err(:'t1', $$select cash_review_overview()$$), 'FORBIDDEN', 'not for a teller');
select tests.call(:'acc', $$select cash_review_overview()$$) as o \gset
select is(row(:'o'::jsonb -> 'pending', :'o'::jsonb -> 'overdue', jsonb_path_query_array(:'o'::jsonb, '$.oldest[*].status'))::text,
  row('2'::jsonb, '1'::jsonb, '["pending", "forced"]'::jsonb)::text, 'the duties waiting for review, the longest first');

select * from finish();
rollback;
