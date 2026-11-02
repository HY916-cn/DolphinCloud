-- 柜员查询 and 报表 (PHASE-1.md §6.8).
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('t2', 'teller') as t2 \gset
select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('acct', 'accountant') as acct \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.student('s1', 100, '张小明') as s1 \gset
select tests.student('s2', 0, '李四', 'junior') as s2 \gset
select tests.student('s3', 50, '王五') as s3 \gset
select app_private.cn_date(now()) as d \gset

-- The opening balances were three days ago (txns are append-only, so the test moves them as the superuser).
set session_replication_role = replica;
update txns set created_at = now() - interval '3 days' where type = 'opening';
update students set opened_at = now() - interval '3 days' where student_no <> 's3'; -- s3's opened_at is later than its opening
set session_replication_role = origin;

select tests.call(:'keeper', $$select upsert_product(null, '海豚书签', 10, 4, p_listed => true)$$) ->> 'id' as a \gset
select tests.call(:'keeper', format($$select stock_in(%L, 5)$$, :'a'));
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000041', 's1', '{"10":2}')$$);
select tests.call(:'t1', $$select withdraw('00000000-0000-4000-8000-000000000042', 's1', 30)$$);
select tests.call(:'t2', $$select deposit('00000000-0000-4000-8000-000000000043', 's2', '{"5":1}')$$);
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000044', 's2', '{"10":1}')$$);
select tests.call(:'teacher', $$select reverse_txn('00000000-0000-4000-8000-000000000045', '00000000-0000-4000-8000-000000000044', '学号录错')$$);
select tests.call(:'t1', format($$select purchase('00000000-0000-4000-8000-000000000046', 's3', %L, 'account')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 2))));
select tests.call(:'t2', format($$select purchase('00000000-0000-4000-8000-000000000047', 's2', %L, 'cash', '{"10":1}')$$,
  jsonb_build_array(jsonb_build_object('product_id', :'a', 'qty', 1))));
insert into currency_issues (batch_no, issued_on, denominations, total, purpose, approver_name, created_by)
values ('FX-01', :'d', '{"10":20}', 200, '开学发行', '王老师', :'teacher');

-- 查询 at the counter
select is(tests.err(:'acct', $$select student_txns('s1')$$), 'FORBIDDEN', 'only a teller uses the counter''s 查询');
select is(tests.err(:'t1', $$select student_txns('nobody')$$), 'STUDENT_NOT_FOUND', 'unknown student');
select is(tests.err(:'t1', $$select student_txns('s1', null, 0)$$), 'INVALID_INPUT', 'a page holds 1 to 50 transactions');
select is((select array_agg(t ->> 'type') from jsonb_array_elements(tests.call(:'t2', $$select student_txns('s1')$$)) t),
  '{withdraw,deposit,opening}', 'a teller sees every transaction of the student, also other tellers'' and earlier days'', newest first');
select is(tests.call(:'t2', $$select student_txns('s1')$$) -> 1 ->> 'operator', 't1', 'with the teller who served it');
select is(tests.call(:'t1', $$select student_txns('s3')$$) -> 0 -> 'items', '[{"qty": 2, "name": "海豚书签"}]', 'and the products exchanged');
select tests.call(:'t1', $$select student_txns('s1', null, 2)$$) -> 1 ->> 'seq' as before \gset
select is((select array_agg(t ->> 'type') from jsonb_array_elements(tests.call(:'t1', format($$select student_txns('s1', %s, 2)$$, :before))) t),
  '{opening}', 'the next page starts after the last one shown');
select is(tests.call(:'t1', $$select student_txns('s2')$$) -> 2 ->> 'status', 'reversed', 'a reversed transaction says so');

-- 报表: who and which period
select is(tests.err(:'t1', format($$select bank_report(%L, %L)$$, :'d', :'d')), 'FORBIDDEN', 'a teller reads no reports');
select is(tests.err(:'keeper', format($$select bank_report(%L, %L)$$, :'d', :'d')), 'FORBIDDEN', 'nor a storekeeper');
select is(tests.err(:'acct', format($$select bank_report(%L, %L::date - 1)$$, :'d', :'d')), 'INVALID_INPUT', 'the period ends after it starts');
select is(tests.err(:'acct', format($$select bank_report(%L::date - 367, %L)$$, :'d', :'d')), 'INVALID_INPUT', 'at most a year');

select tests.call(:'acct', format($$select bank_report(%L, %L)$$, :'d', :'d')) as r \gset
select is(:'r'::jsonb -> 'business', '{"deposit": {"count": 2, "amount": 25}, "withdraw": {"count": 1, "amount": 30},
  "students": 3, "purchase_cash": {"count": 1, "amount": 10}, "purchase_account": {"count": 1, "amount": 20}}',
  'business counts leave out the reversed deposit');
select is(:'r'::jsonb -> 'reversals', '{"count": 1, "amount": 10}', 'reversals of the period');
select is(:'r'::jsonb -> 'reversed', '1', 'transactions of the period that were reversed');
select is(:'r'::jsonb -> 'balance', '{"opening": 150, "closing": 125,
  "changes": {"deposit": 35, "purchase": -20, "reversal": -10, "withdraw": -30}}', 'opening + changes = closing');
select is((select sum(balance)::int from accounts), 125, 'the closing balance of today is the accounts'' balance');
select is(:'r'::jsonb -> 'cash', '{"in": 45, "out": 40}', 'cash taken in and paid out at the counter');
select is(:'r'::jsonb -> 'days', jsonb_build_array(jsonb_build_object('day', :'d', 'deposit', 25, 'deposit_count', 2, 'withdraw', 30,
  'withdraw_count', 1, 'purchase', 30, 'purchase_count', 2, 'students', 3, 'change', -25)), 'one line per day, with the change to the balance');
select is(jsonb_array_length(:'r'::jsonb -> 'hours'), 1, 'businesses by hour');
select is((select jsonb_agg(t - 'deposit' - 'withdraw' - 'purchase' order by t ->> 'name') from jsonb_array_elements(:'r'::jsonb -> 'tellers') t),
  '[{"name": "t1", "count": 3, "reversed": 1, "reversals": 0, "deposit_count": 1, "purchase_count": 1, "withdraw_count": 1},
    {"name": "t2", "count": 2, "reversed": 0, "reversals": 0, "deposit_count": 1, "purchase_count": 1, "withdraw_count": 0},
    {"name": "teacher", "count": 0, "reversed": 0, "reversals": 1, "deposit_count": 0, "purchase_count": 0, "withdraw_count": 0}]',
  'by teller: businesses kept, their businesses reversed, reversals made');
select is((select jsonb_agg(jsonb_build_object('class', c ->> 'class_label', 'students', c -> 'students', 'balance', c -> 'balance',
    'deposit', c -> 'deposit', 'spent', c -> 'spent')) from jsonb_array_elements(:'r'::jsonb -> 'classes') c),
  '[{"class": "四年级(4)班", "spent": 20, "balance": 120, "deposit": 20, "students": 2},
    {"class": "七年级(4)班", "spent": 0, "balance": 5, "deposit": 5, "students": 1}]', 'by class, 小学部 first');
select is(:'r'::jsonb -> 'students', '{"max": 90, "total": 3, "active": 3, "frozen": 0, "median": 30, "normal": 3, "balance": 125, "graduated": 0}',
  'accounts at the end of the period');
select is((select array_agg((b ->> 'count')::int) from jsonb_array_elements(:'r'::jsonb -> 'distribution') b), '{0,1,1,1,0,0}',
  'students by balance at the end of the period');
select is(:'r'::jsonb -> 'products', '[{"qty": 3, "cash": 10, "cost": 12, "name": "海豚书签", "amount": 30, "account": 20}]',
  'products exchanged, with their cost');
select is(:'r'::jsonb -> 'stock', '[{"cost": 4, "name": "海豚书签", "sold": 3, "price": 10, "closing": 2, "opening": 0, "stock_in": 5, "stock_out": 0}]',
  'stock: opening + in - out - sold = closing');
select is(:'r'::jsonb -> 'issues' -> 'total', '200', 'currency issued so far');
select is(:'r'::jsonb -> 'issues' -> 'batches' -> 0 ->> 'batch_no', 'FX-01', 'batches issued in the period');
select is(tests.call(:'teacher', format($$select bank_report(%L, %L)$$, :'d', :'d')), :'r'::jsonb, 'the teacher reads the same report');

-- A 时段 of each day
select tests.call(:'acct', format($$select bank_report(%L, %L, p_time_from => %L)$$, :'d', :'d',
  (now() at time zone 'Asia/Shanghai')::time)) as inside \gset
select tests.call(:'acct', format($$select bank_report(%L, %L, p_time_to => %L)$$, :'d', :'d',
  (now() at time zone 'Asia/Shanghai')::time)) as outside \gset
select is(:'inside'::jsonb -> 'business' -> 'deposit', '{"count": 2, "amount": 25}', 'a 时段 that holds the businesses');
select is(row(:'outside'::jsonb -> 'business' -> 'deposit', :'outside'::jsonb -> 'cash', jsonb_array_length(:'outside'::jsonb -> 'tellers'))::text,
  row('{"count": 0, "amount": 0}'::jsonb, '{"in": 0, "out": 0}'::jsonb, 0)::text, 'one that ends before them leaves them out');
select is(:'outside'::jsonb -> 'balance', :'r'::jsonb -> 'balance', 'the balance check stays over whole days');
select is(tests.err(:'acct', format($$select bank_report(%L, %L, p_time_from => '13:00', p_time_to => '12:00')$$, :'d', :'d')),
  'INVALID_INPUT', 'a 时段 ends after it starts');
select is((select count(*)::int from txns t where public.cn_time(t) = (now() at time zone 'Asia/Shanghai')::time), 9,
  'cn_time is the Asia/Shanghai time of day (today''s seven and the two openings moved back whole days)');

-- A part of the bank, and an earlier period
select is(tests.call(:'acct', format($$select bank_report(%L, %L, 'junior')$$, :'d', :'d')) -> 'balance' -> 'closing', '5', 'one 学部');
select is(tests.call(:'acct', format($$select bank_report(%L, %L, 'primary', %s, 4)$$, :'d', :'d',
  app_private.grade_of('primary', 0) - 4)) -> 'students' -> 'total', '2', 'one class');
select is(tests.call(:'acct', format($$select bank_report(%L, %L, p_student_no => 's1')$$, :'d', :'d')) -> 'business' -> 'withdraw',
  '{"count": 1, "amount": 30}', 'one student');
select tests.call(:'acct', format($$select bank_report(%L::date - 3, %L::date - 1)$$, :'d', :'d')) as before \gset
select is(row(:'before'::jsonb -> 'openings', :'before'::jsonb -> 'balance' -> 'closing', jsonb_array_length(:'before'::jsonb -> 'days'))::text,
  row('{"count": 2, "amount": 150}'::jsonb, '150'::jsonb, 3)::text, 'the days before: the opening balances, one line per day');
select is(:'before'::jsonb -> 'stock' -> 0 -> 'closing', '0', 'stock at the end of an earlier period');

select * from finish();
rollback;
