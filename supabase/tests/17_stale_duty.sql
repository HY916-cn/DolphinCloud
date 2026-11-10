-- 跨天未下班 (PHASE-1.md §6.9): a duty begun before today takes no counter business until the teller ends it.
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('acct', 'accountant') as acct \gset
select tests.student('s1', 100, '张小明') as s1 \gset
select app_private.cn_date(now())::timestamp at time zone 'Asia/Shanghai' as midnight \gset

select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000071', 's1', '{"10":1}')$$);
select is(tests.call(:'t1', $$select start_duty()$$) -> 'stale', 'false', 'a duty begun today is not stale');

-- Begun at today's midnight it is today's; a second earlier it is yesterday's.
update duty set started_at = :'midnight'::timestamptz where user_id = :'t1' and ended_at is null;
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"1":1}')$$), null, 'from midnight on, the duty is today''s');
update duty set started_at = :'midnight'::timestamptz - interval '1 second' where user_id = :'t1' and ended_at is null;
select id as duty from duty where user_id = :'t1' and ended_at is null \gset

-- No counter business on yesterday's duty, a reversal included.
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":1}')$$), 'STALE_DUTY', 'a duty begun yesterday takes no deposit');
select is(tests.err(:'t1', $$select withdraw(gen_random_uuid(), 's1', 1)$$), 'STALE_DUTY', 'nor a withdrawal');
select is(tests.err(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000071', '金额录错')$$), 'STALE_DUTY',
  'nor a reversal');
select is(tests.call(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":1}')$$) ->> 'detail',
  jsonb_build_object('started_at', :'midnight'::timestamptz - interval '1 second')::text, 'the error says when the duty began');
select is(tests.err(:'t1', $$select deposit('00000000-0000-4000-8000-000000000072', 's1', '{"1":3}', true, now())$$), null,
  'an offline deposit still comes in');

-- 上班 answers the stale duty; 下班 ends it as any duty; the next 上班 opens today's.
select tests.call(:'t1', $$select start_duty()$$) as again \gset
select is(row(:'again'::jsonb ->> 'id', :'again'::jsonb -> 'stale')::text, row(:'duty', 'true'::jsonb)::text,
  '上班 answers the open duty, marked stale');
select is(:'again'::jsonb ->> 'started_at', to_jsonb(:'midnight'::timestamptz - interval '1 second') #>> '{}', 'with when it began');
select is((select count(*)::int from duty where user_id = :'t1'), 1, 'and opens no other');
select is(jsonb_array_length(tests.call(:'t1', $$select duty_txns()$$)), 3, 'the summary lists the whole duty');
select is(tests.err(:'t1', $$select end_duty(1)$$), 'SUMMARY_STALE', '下班 still checks the summary');
select is(tests.call(:'t1', $$select end_duty(3)$$) -> 'txns', '3', 'and ends yesterday''s duty');
select is(tests.call(:'t1', $$select start_duty()$$) -> 'stale', 'false', 'the next 上班 opens today''s duty');
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":1}')$$), null, 'and the teller serves again');

select is(tests.err(:'acct', $$select start_duty()$$), 'FORBIDDEN', 'only tellers go on duty');
select is(tests.err(:'acct', $$select end_duty(0)$$), 'FORBIDDEN', 'or end one');

select * from finish();
rollback;
