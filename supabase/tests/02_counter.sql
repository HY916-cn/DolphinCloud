-- Deposit, withdraw and lookup: roles, amounts, limits, idempotency (PHASE-1.md §6.2).
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('acc', 'accountant') as acc \gset
select tests.student('s1', 100) as s1 \gset
select tests.student('s3', 50) as s3 \gset
select tests.student('s4', 1000) as s4 \gset
select tests.student('frozen', 10);
update students set status = 'frozen' where student_no = 'frozen';

-- Roles
select is(tests.err(:'s1', $$select deposit(gen_random_uuid(), 's3', '{"10":1}')$$), 'FORBIDDEN', 'a student cannot deposit');
select is(tests.err(:'acc', $$select deposit(gen_random_uuid(), 's3', '{"10":1}')$$), 'FORBIDDEN', 'an accountant cannot deposit');
select is(tests.err(:'s1', $$select lookup_student('s3')$$), 'FORBIDDEN', 'a student cannot look up others');

-- Deposit
select set_config('request.headers', '{"x-device-id":"pad-1"}', false);
select is(tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000002', 's1', '{"10":2,"5":1}')$$) - 'id' - 'txn_no' - 'created_at',
  '{"type":"deposit","amount":25,"balance_after":125,"denominations":{"5":1,"10":2},"change_given":null}', 'deposit sums the denominations');
select is((select row(balance_delta, cash_delta, device_id, offline)::text from txns where id = '00000000-0000-4000-8000-000000000002'),
  row(25, 25, 'pad-1', false)::text, 'deposit adds to balance and counter cash and records the device');
select is(tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000002', 's1', '{"10":2,"5":1}')$$) ->> 'balance_after', '125',
  'resubmitting the same id returns the first result');
select is((select row(balance, total_in)::text from accounts where student_no = 's1'), '(125,125)', 'the resubmission is not booked twice');

select is(tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000003', 's1', '{"1":3}', true, '2026-10-28 09:00+08')$$) ->> 'amount', '3',
  'offline deposit');
select is((select row(offline, client_created_at)::text from txns where id = '00000000-0000-4000-8000-000000000003'),
  row(true, '2026-10-28 09:00+08'::timestamptz)::text, 'offline flag and device time are kept');

select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"3":1}')$$), 'INVALID_AMOUNT', 'unknown denomination');
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":-1}')$$), 'INVALID_AMOUNT', 'negative count');
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":1.5}')$$), 'INVALID_AMOUNT', 'fractional count');
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":0}')$$), 'INVALID_AMOUNT', 'zero amount');
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '[10]')$$), 'INVALID_AMOUNT', 'not an object');
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 'nobody', '{"10":1}')$$), 'STUDENT_NOT_FOUND', 'unknown student');
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 'frozen', '{"10":1}')$$), 'STUDENT_INACTIVE', 'frozen account');
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":100001}')$$), 'INVALID_AMOUNT', 'a count over 100000');
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":1e30}')$$), 'INVALID_AMOUNT', 'a huge count is not an overflow');
update settings set value = '[1,2,5,10,1000]' where key = 'denominations';
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"1000":10001}')$$), 'INVALID_AMOUNT', 'a total over 10000000');
update settings set value = '[1,2,5,10]' where key = 'denominations';

-- Student status: the teacher freezes, graduates and restores a student
select tests.staff('teacher', 'teacher') as teacher \gset
select is(tests.err(:'t1', $$select set_student_status('s3', 'frozen')$$), 'FORBIDDEN', 'only the teacher sets a student''s status');
select is(tests.call(:'teacher', $$select set_student_status('s3', 'frozen')$$), '{"status":"frozen","student_no":"s3"}', 'freeze');
select is(tests.err(:'t1', $$select withdraw(gen_random_uuid(), 's3', 1)$$), 'STUDENT_INACTIVE', 'a frozen student cannot be served');
select is((select after ->> 'status' from audit_log where action = 'students.update' and target = 'students:s3' and actor_id = :'teacher'),
  'frozen', 'the change is audited');
select is(tests.call(:'teacher', $$select set_student_status('s3', 'normal')$$) ->> 'status', 'normal', 'and back to normal');
select is(tests.err(:'teacher', $$select set_student_status('s3', 'left')$$), 'INVALID_INPUT', 'status is normal, frozen or graduated');
select is(tests.err(:'teacher', $$select set_student_status('nobody', 'graduated')$$), 'STUDENT_NOT_FOUND', 'unknown student');

-- Withdraw
select is(tests.err(:'t1', $$select withdraw(gen_random_uuid(), 's4', 201)$$), 'WITHDRAW_SINGLE_LIMIT', 'over the single limit');
select is(tests.call(:'t1', $$select withdraw(gen_random_uuid(), 's4', 201)$$) ->> 'detail', '{"limit": 200}', 'single limit in the detail');
select is(tests.err(:'t1', $$select withdraw(gen_random_uuid(), 's4', 0)$$), 'INVALID_AMOUNT', 'zero withdrawal');
select is(tests.call(:'t1', $$select withdraw(gen_random_uuid(), 's3', 60)$$) ->> 'detail', '{"short": 10, "balance": 50}',
  'overdraft is refused with balance and shortfall');
select is(tests.call(:'t1', $$select withdraw('00000000-0000-4000-8000-000000000004', 's4', 200)$$) ->> 'balance_after', '800', 'withdraw');
select is((select row(balance_delta, cash_delta, denominations)::text from txns where id = '00000000-0000-4000-8000-000000000004'),
  '(-200,-200,"{""10"": 20}")', 'withdraw takes from balance and counter cash, and records the notes paid out');
select is(tests.call(:'t1', $$select withdraw('00000000-0000-4000-8000-000000000004', 's4', 200)$$) -> 'denominations', '{"10": 20}',
  'the result names the notes');
select is(tests.call(:'t1', $$select withdraw(gen_random_uuid(), 's4', 200)$$) ->> 'balance_after', '600', 'second withdrawal today');
select is(tests.call(:'t1', $$select withdraw(gen_random_uuid(), 's4', 150)$$) ->> 'detail', '{"limit": 500, "remaining": 100}',
  'over the daily limit shows what is left today');
select is(tests.call(:'t1', $$select lookup_student('s4')$$) - 'name' - 'cohort',
  '{"grade":4,"class_no":4,"division":"primary","status":"normal","balance":600,"class_label":"四年级(4)班","student_no":"s4","withdrawn_today":400}',
  'lookup shows balance and today''s withdrawals');
select is(tests.call(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000004', '金额录错')$$) ->> 'balance_after', '800',
  'reverse one withdrawal');
select is(tests.call(:'t1', $$select withdraw(gen_random_uuid(), 's4', 300)$$) ->> 'error', 'WITHDRAW_SINGLE_LIMIT', 'the single limit still applies');
select is(tests.call(:'t1', $$select withdraw(gen_random_uuid(), 's4', 200)$$) ->> 'balance_after', '600',
  'reversed withdrawals do not count toward the daily limit');
select is(tests.call(:'t1', $$select withdraw(gen_random_uuid(), 's4', 101)$$) ->> 'error', 'WITHDRAW_DAILY_LIMIT', 'daily limit reached');

-- Limits are set per division
update settings set value = '{"primary":200,"junior":300}' where key = 'withdraw_single_limit';
select tests.student('j1', 1000, p_division => 'junior');
select is(tests.call(:'t1', $$select withdraw(gen_random_uuid(), 'j1', 300)$$) ->> 'balance_after', '700', 'junior single limit');
select is(tests.call(:'t1', $$select withdraw(gen_random_uuid(), 's1', 201)$$) ->> 'detail', '{"limit": 200}', 'primary keeps its own');

-- A disabled teller loses the role at once
update profiles set disabled = true where id = :'t1';
select is(tests.err(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":1}')$$), 'FORBIDDEN', 'a disabled teller cannot deposit');

select is((select count(*)::int from app_private.check_balances()), 0, 'balances match the ledger');

select * from finish();
rollback;
