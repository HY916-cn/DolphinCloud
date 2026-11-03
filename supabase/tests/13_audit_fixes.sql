-- 下班总结 across midnight, the last 运维员, the 工资账户's status, a currency issue's date (PHASE-1.md §6.4, §6.9).
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.staff('t1', 'teller') as t1 \gset
select tests.student('s1', 10, '张小明') as s1 \gset
select tests.student('s2', 0, '李四') as s2 \gset

-- 下班总结: the server counts what the teller cannot read, a transaction of yesterday on a duty begun yesterday.
delete from duty where user_id = :'t1';
select is(tests.err(:'t1', $$select duty_txns()$$), 'OFF_DUTY', 'the summary needs an open duty');
select app_private.cn_date(now())::timestamp at time zone 'Asia/Shanghai' as midnight \gset
insert into duty (user_id, started_at) values (:'t1', :'midnight'::timestamptz - interval '2 hours');
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000061', 's2', '{"10":1}')$$);
-- Rows are immutable; the test moves this one back past midnight with the triggers off.
set session_replication_role = replica;
update txns set created_at = :'midnight'::timestamptz - interval '1 hour' where id = '00000000-0000-4000-8000-000000000061';
set session_replication_role = origin;
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000062', 's2', '{"1":2}')$$);
select is(tests.call(:'t1', $$select count(*) from txns where operator_id = auth.uid()$$)::int, 1, 'the teller reads only today''s 流水');
select is(jsonb_array_length(tests.call(:'t1', $$select duty_txns()$$)), 2, 'duty_txns lists the whole duty');
select is(tests.call(:'t1', $$select duty_txns()$$) -> 0 ->> 'name', '李四', 'by time, with the student''s name');
select is(tests.call(:'t1', $$select end_duty(2)$$) -> 'txns', '2', 'so 下班 across midnight goes through');

-- The last 运维员 in use stays.
select is(tests.err(:'teacher', format($$select set_user_disabled(%L, true)$$, :'ops')), 'LAST_SYSADMIN', 'the last one is not stopped');
select is(tests.err(:'teacher', format($$select close_accounts(array[%L]::uuid[])$$, :'ops')), 'LAST_SYSADMIN', 'nor closed');
select is(tests.err(:'teacher', format($$select set_role(%L, 'teller')$$, :'ops')), 'LAST_SYSADMIN', 'nor given another role');
select tests.staff('ops2', 'sysadmin') as ops2 \gset
select is(tests.err(:'teacher', format($$select set_user_disabled(%L, true)$$, :'ops')), null, 'with a second one, either may be stopped');
select is(tests.err(:'teacher', format($$select set_role(%L, 'teller')$$, :'ops2')), 'LAST_SYSADMIN', 'but then not the other');
select is(tests.err(:'teacher', format($$select set_user_disabled(%L, false)$$, :'ops')), null, 'started again');
select is(tests.err(:'teacher', format($$select set_role(%L, 'teller')$$, :'ops2')), null, 'the second may change role');

-- A 工资账户 is an account in use.
select tests.call(:'teacher', $$select set_student_status('s1', 'frozen')$$);
select is(tests.err(:'t1', $$select bind_salary_account(auth.uid(), 's1', '123456')$$), 'STUDENT_INACTIVE', 'a frozen account is not bound');
select tests.call(:'teacher', $$select set_student_status('s1', 'normal')$$);
select is(tests.call(:'t1', $$select bind_salary_account(auth.uid(), 's1', '123456')$$) ->> 'account', 's1', 'one in use is');

-- A currency issue is dated today at the latest.
select is(tests.err(:'teacher', $$select register_issue('F1', app_private.cn_date(now()) + 1, '{"10":1}', '开学发行', '王老师')$$),
  'INVALID_INPUT', 'a currency issue is not dated in the future');
select is(tests.call(:'teacher', $$select register_issue('F2', app_private.cn_date(now()), '{"10":1}', '开学发行', '王老师')$$) ->> 'total',
  '10', 'today''s is registered');

select * from finish();
rollback;
