-- 备用金 and the 下班总结 cash table (PHASE-2.md §4, §7.1, §7.3): start_duty(p_float), duty_cash, end_duty keeping the
-- expected notes.
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('t2', 'teller') as t2 \gset
select tests.staff('t3') as t3 \gset
insert into user_roles (user_id, role) values (:'t3', 'teller');
select tests.staff('acc', 'accountant') as acc \gset
select tests.staff('p1', 'president') as p1 \gset
select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.student('s1', 200) as s1 \gset
select tests.call(:'keeper', $$select upsert_product(null, '海豚书签', 7, p_listed => true)$$) ->> 'id' as a \gset
select tests.call(:'keeper', format($$select stock_in(%L, 5)$$, :'a'));

-- A duty open before 备用金 existed: 上班 answers it with no notes, 下班 keeps its expected notes.
select is(tests.call(:'t1', $$select start_duty()$$) -> 'float', '{"1":0,"2":0,"5":0,"10":0}', 'an open duty without 备用金 has none');
select is(tests.call(:'t1', $$select end_duty(0)$$) ->> 'txns', '0', 'and ends as before');
select is((select row(c.float, c.expected, c.status)::text from cash_counts c join duty d on d.id = c.duty_id where d.user_id = :'t1'),
  row('{"1":0,"2":0,"5":0,"10":0}'::jsonb, '{"1":0,"2":0,"5":0,"10":0}'::jsonb, 'pending')::text, '下班 keeps its expected notes');
update duty set started_at = now() - interval '10 seconds', ended_at = now() - interval '9 seconds' where user_id = :'t1';

-- 备用金: counts of the configured denominations, whole and not negative.
select is(tests.err(:'t1', $$select start_duty('{"3":1}')$$), 'INVALID_AMOUNT', 'a denomination not configured is refused');
select is(tests.err(:'t1', $$select start_duty('{"1":-1}')$$), 'INVALID_AMOUNT', 'a negative count is refused');
select is(tests.err(:'t1', $$select start_duty('{"1":1.5}')$$), 'INVALID_AMOUNT', 'a fraction is refused');
select is(tests.err(:'t1', $$select start_duty('[1]')$$), 'INVALID_AMOUNT', 'so is anything but an object');
select is((select count(*)::int from duty where user_id = :'t1' and ended_at is null), 0, 'and no duty opens');
select is(tests.call(:'t3', $$select start_duty()$$) -> 'float', '{"1":0,"2":0,"5":0,"10":0}', 'a first duty has no 备用金 by default');

-- Duty 1: deposit, withdrawal, cash and account purchases, and a deposit reversed within the duty.
select tests.call(:'t1', $$select start_duty('{"1":20,"2":10,"5":4}')$$) as d1 \gset
select is(:'d1'::jsonb -> 'float', '{"1":20,"2":10,"5":4,"10":0}', '上班 records the 备用金, every denomination');
select is(:'d1'::jsonb -> 'stale', 'false', 'with stale as before');
select is(tests.call(:'t1', $$select start_duty('{"1":99}')$$) - 'stale', :'d1'::jsonb - 'stale', '上班 again answers the open duty as it is');
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000081', 's1', '{"10":2,"5":1}')$$);
select tests.call(:'t1', $$select withdraw('00000000-0000-4000-8000-000000000082', 's1', 13)$$);
select tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's1', %L, 'cash', '{"10":1}')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 1))));
select tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's1', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 1))));
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000083', 's1', '{"1":5}')$$);
select tests.call(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000083', '金额录错')$$);

select tests.call(:'t1', $$select duty_cash()$$) as c1 \gset
select is(:'c1'::jsonb - 'duty_id' - 'user_id' - 'started_at', '{
  "ended_at": null, "status": "open", "denominations": [1, 2, 5, 10],
  "float":    {"counts": {"1": 20, "2": 10, "5": 4, "10": 0}, "amounts": {"1": 20, "2": 20, "5": 20, "10": 0}, "total": 60},
  "income":   {"counts": {"1": 0, "2": 0, "5": 1, "10": 3}, "amounts": {"1": 0, "2": 0, "5": 5, "10": 30}, "total": 35},
  "payout":   {"counts": {"1": 2, "2": 2, "5": 0, "10": 1}, "amounts": {"1": 2, "2": 4, "5": 0, "10": 10}, "total": 16},
  "expected": {"counts": {"1": 18, "2": 8, "5": 5, "10": 2}, "amounts": {"1": 18, "2": 16, "5": 25, "10": 20}, "total": 79}}',
  'deposits and cash received come in, withdrawals and change go out, a reversed deposit and its reversal count for nothing');
select is(:'c1'::jsonb ->> 'duty_id', :'d1'::jsonb ->> 'id', 'for the open duty');

select is(tests.call(:'t1', $$select end_duty(6)$$) ->> 'txns', '6', '下班');
select is((select row(c.expected, c.status)::text from cash_counts c where c.duty_id = (:'d1'::jsonb ->> 'id')::uuid),
  row(:'c1'::jsonb -> 'expected' -> 'counts', 'pending')::text, 'keeps the expected notes for 轧账');
select is(tests.err(:'t1', $$select duty_cash()$$), 'OFF_DUTY', 'off duty there is no open duty to count');
-- Duty 1 took place a few seconds ago.
update duty set started_at = now() - interval '5 seconds', ended_at = now() - interval '3 seconds' where id = (:'d1'::jsonb ->> 'id')::uuid;
set local session_replication_role = replica;
update txns set created_at = now() - interval '4 seconds' where operator_id = :'t1';
set local session_replication_role = origin;
select is(tests.call(:'t1', format($$select duty_cash(%L)$$, :'d1'::jsonb ->> 'id')) - 'started_at' - 'ended_at' - 'status',
  :'c1'::jsonb - 'started_at' - 'ended_at' - 'status', 'an ended duty counts as it did at 下班');

-- Duty 2: the last 备用金 by default; reversals of duty 1's deposit and withdrawal count here.
select tests.call(:'t1', $$select start_duty()$$) as d2 \gset
select is(:'d2'::jsonb -> 'float', '{"1":20,"2":10,"5":4,"10":0}', 'the next 上班 takes the last 备用金 by default');
select tests.call(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000081', '学号录错')$$);
select tests.call(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000082', '业务选错')$$);
select tests.call(:'t1', $$select duty_cash()$$) as c2 \gset
select is(:'c2'::jsonb -> 'income' -> 'counts', '{"1":1,"2":1,"5":0,"10":1}', 'a reversed withdrawal brings its notes back');
select is(:'c2'::jsonb -> 'payout' -> 'counts', '{"1":0,"2":0,"5":1,"10":2}', 'a reversed deposit pays its notes out');
select is(:'c2'::jsonb -> 'expected', '{"counts":{"1":21,"2":11,"5":3,"10":-1},"amounts":{"1":21,"2":22,"5":15,"10":-10},"total":48}',
  'a denomination can be short');
select is(tests.call(:'t1', format($$select duty_cash(%L)$$, :'d1'::jsonb ->> 'id')) -> 'expected',
  :'c1'::jsonb -> 'expected', 'and duty 1 stays as it was');

-- Who reads which duty.
select is(tests.err(:'t2', format($$select duty_cash(%L)$$, :'d1'::jsonb ->> 'id')), 'FORBIDDEN', 'a teller reads only their own duty');
select is(tests.call(:'acc', format($$select duty_cash(%L)$$, :'d1'::jsonb ->> 'id')) -> 'expected' -> 'total', '79', 'the accountant reads any');
select is(tests.call(:'p1', format($$select duty_cash(%L)$$, :'d1'::jsonb ->> 'id')) -> 'expected' -> 'total', '79', 'so does the president');
select is(tests.call(:'teacher', format($$select duty_cash(%L)$$, :'d1'::jsonb ->> 'id')) ->> 'status', 'pending', 'and the bank admin');
select is(tests.err(:'acc', $$select duty_cash()$$), 'OFF_DUTY', 'the accountant has no duty of their own');
select is(tests.err(:'acc', $$select duty_cash(gen_random_uuid())$$), 'INVALID_INPUT', 'an unknown duty');
select is(tests.err(:'keeper', format($$select duty_cash(%L)$$, :'d1'::jsonb ->> 'id')), 'FORBIDDEN', 'the storekeeper reads none');
select is(tests.call(:'t1', $$select count(*) from cash_counts$$), '3', 'a teller reads their own 轧账 rows');
select is(tests.call(:'t2', $$select count(*) from cash_counts$$), '0', 'and no one else''s');
select is(tests.call(:'acc', $$select count(*) from cash_counts$$), '4', 'the accountant reads all');
select is(tests.call(:'keeper', $$select count(*) from cash_counts$$), '0', 'the storekeeper none');

select * from finish();
rollback;
