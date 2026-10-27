-- Reversal rules (PHASE-1.md §6.3).
\ir helpers/setup.psql

select tests.staff('t1', '{teller}') as t1 \gset
select tests.staff('t2', '{teller}') as t2 \gset
select tests.staff('teacher', '{teacher}') as teacher \gset
select tests.staff('keeper', '{storekeeper}') as keeper \gset
select tests.student('s1', 100) as s1 \gset
select tests.student('s2') as s2 \gset

select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000021', 's1', '{"10":1}')$$);
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000022', 's1', '{"10":1}')$$);
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000023', 's1', '{"10":1}')$$);

-- Teller, own transaction, today
select is(tests.err(:'s1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000021', '金额录错')$$), 'FORBIDDEN',
  'a student cannot reverse');
select is(tests.err(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000021', '')$$), 'INVALID_INPUT', 'reason is required');
select is(tests.err(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000021', '其他')$$), 'INVALID_INPUT',
  '"other" needs an explanation');
select is(tests.err(:'t1', $$select reverse_txn(gen_random_uuid(), gen_random_uuid(), '金额录错')$$), 'TXN_NOT_FOUND', 'unknown transaction');
select is(tests.call(:'t1', $$select reverse_txn('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000021', '金额录错')$$)
  - 'id' - 'txn_no' - 'created_at', '{"type":"reversal","amount":10,"balance_after":120,"change_given":null}', 'teller reverses own deposit today');
select is((select row(balance_delta, cash_delta, reversal_of, reason)::text from txns where id = '00000000-0000-4000-8000-000000000031'),
  row(-10, -10, '00000000-0000-4000-8000-000000000021'::uuid, '金额录错')::text, 'the reversal mirrors the original');
select is((select status from txns where id = '00000000-0000-4000-8000-000000000021'), 'reversed', 'the original is marked reversed');
select is((select row(balance, total_in)::text from accounts where student_no = 's1'), '(120,120)', 'balance and totals restored');
select is(tests.call(:'t1', $$select reverse_txn('00000000-0000-4000-8000-000000000031', '00000000-0000-4000-8000-000000000021', '金额录错')$$) ->> 'type',
  'reversal', 'resubmitting a reversal returns the first result');
select is(tests.err(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000021', '金额录错')$$), 'REVERSAL_NOT_ALLOWED',
  'a transaction is reversed only once');
select is(tests.err(:'teacher', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000031', '金额录错')$$), 'REVERSAL_NOT_ALLOWED',
  'a reversal cannot be reversed');
select is((select count(*)::int from audit_log where action = 'txn.reverse' and actor_id = :'t1'), 1, 'the reversal is in the audit log');

-- Another teller's or an earlier day's transaction: only a teacher
select is(tests.err(:'t2', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000022', '学号录错')$$), 'REVERSAL_NOT_ALLOWED',
  'a teller cannot reverse another teller''s transaction');
select is(tests.call(:'teacher', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000022', '学号录错')$$) ->> 'balance_after', '110',
  'a teacher can');
set local session_replication_role = replica;
update txns set created_at = created_at - interval '1 day' where id = '00000000-0000-4000-8000-000000000023';
set local session_replication_role = origin;
select is(tests.err(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000023', '业务选错')$$), 'REVERSAL_NOT_ALLOWED',
  'a teller cannot reverse yesterday''s transaction');
select is(tests.call(:'teacher', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000023', '其他：昨天录重复')$$) ->> 'balance_after', '100',
  'a teacher can');

-- Opening balance: teacher only
select tests.call(:'teacher', $$select set_roles(id, '{teacher,teller}') from profiles where login_id = 'teacher'$$);
select id as opening from txns where student_no = 's1' and type = 'opening' \gset
select is(tests.err(:'t1', format($$select reverse_txn(gen_random_uuid(), %L, '金额录错')$$, :'opening')),
  'REVERSAL_NOT_ALLOWED', 'a teller cannot reverse an opening balance');
select is(tests.call(:'teacher', format($$select reverse_txn(gen_random_uuid(), %L, '金额录错')$$, :'opening')) ->> 'balance_after',
  '0', 'a teacher can (also when they hold teller too)');

-- A deposit reversal never overdraws
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000024', 's2', '{"10":5}')$$);
select tests.call(:'t1', $$select withdraw('00000000-0000-4000-8000-000000000025', 's2', 40)$$);
select is(tests.call(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000024', '金额录错')$$) - 'error',
  jsonb_build_object('detail', '{"amount": 50, "balance": 10}'), 'reversing a deposit larger than the balance is refused');
select is(tests.call(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000025', '金额录错')$$) ->> 'balance_after', '50',
  'reverse the withdrawal first');
select is((select row(total_out, balance)::text from accounts where student_no = 's2'), '(0,50)', 'withdrawal total restored');
select is(tests.call(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000024', '金额录错')$$) ->> 'balance_after', '0',
  'then the deposit');

-- Purchases come back into stock
select tests.call(:'keeper', $$select upsert_product(null, '海豚书签', 10, p_listed => true)$$) ->> 'id' as a \gset
select tests.call(:'keeper', format($$select stock_in(%L, 2)$$, :'a'));
select tests.call(:'t1', $$select deposit(gen_random_uuid(), 's2', '{"10":3}')$$);
select tests.call(:'t1', format($$select purchase('00000000-0000-4000-8000-000000000026', 's2', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 2))));
select is(tests.call(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000026', '业务选错')$$) ->> 'balance_after', '30',
  'account purchase reversal refunds the balance');
select is((select row(stock, (select total_spent from accounts where student_no = 's2'))::text from products where id = :'a'), '(2,0)',
  'stock and total spent restored');
select is((select qty_delta from stock_movements where product_id = :'a' and kind = 'reversal'), 2, 'restock recorded as a movement');
select tests.call(:'t1', format($$select purchase('00000000-0000-4000-8000-000000000028', 's2', %L, 'cash', '{"10":1}')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 1))));
select tests.call(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000028', '业务选错')$$) ->> 'id' as r \gset
select is((select row(balance_delta, cash_delta)::text from txns where id = :'r'), '(0,-10)',
  'cash purchase reversal returns the cash, not the balance');
select is((select stock from products where id = :'a'), 2, 'and the stock');

select is((select count(*)::int from app_private.check_balances()), 0, 'balances and stock match the ledger');

select * from finish();
rollback;
