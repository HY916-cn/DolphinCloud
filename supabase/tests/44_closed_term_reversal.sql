-- 结转 (PHASE-2.md §6.3): a transaction dated in a closed term is not reversed (TERM_CLOSED for the bank admin and the
-- president, REVERSAL_NOT_ALLOWED for a teller as before); 编辑 still changes it, at the original time. A transaction
-- dated in a term not yet closed, or between terms, is reversed as before.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.student('s1', 500) as s1 \gset
update students set opened_at = now() - interval '60 days' where student_no = 's1';

-- A closed term 40 to 20 days ago, the next term 19 to 5 days ago (not closed), a holiday since.
insert into terms (name, starts_on, ends_on, closed_at) values
  ('已结转', current_date - 40, current_date - 20, now()), ('未结转', current_date - 19, current_date - 5, null);

-- A 存款 and a 取款 in the closed term, a 存款 in the open one and one in the holiday.
create function pg_temp.move(p_id uuid, p_delta integer, p_days integer) returns void language sql as $$
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, operator_id, created_at)
  select p_id, case when p_delta > 0 then 'deposit'::txn_type else 'withdraw' end, 's1', abs(p_delta), p_delta,
    balance + p_delta, p_delta, app_private.system_user(), now() - make_interval(days => p_days)
  from accounts where student_no = 's1';
  update accounts set balance = balance + p_delta, total_in = total_in + greatest(p_delta, 0),
    total_out = total_out + greatest(-p_delta, 0) where student_no = 's1';
$$;
select pg_temp.move('00000000-0000-4000-8000-000000004401', 50, 30);
select pg_temp.move('00000000-0000-4000-8000-000000004402', -40, 25);
select pg_temp.move('00000000-0000-4000-8000-000000004403', 20, 10);
select pg_temp.move('00000000-0000-4000-8000-000000004404', 10, 2);

-- The closed term's 存款: refused to the bank admin and the president, to a teller as before; nothing entered.
select is(tests.err(:'teacher', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000004401', '金额录错')$$),
  'TERM_CLOSED', 'the bank admin does not reverse a 存款 of a closed term');
select is(tests.err(:'president', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000004401', '金额录错')$$),
  'TERM_CLOSED', 'nor the president');
select is(tests.err(:'teller', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000004401', '金额录错')$$),
  'REVERSAL_NOT_ALLOWED', 'nor a teller, as before');
select is(count(*)::int, 0, 'no reversal entered') from txns where type = 'reversal';
select is((select status::text from txns where id = '00000000-0000-4000-8000-000000004401'), 'normal', 'the 存款 still normal');

-- 编辑 still changes the closed term, at the original time: the 取款 of 40 becomes 30.
select is(tests.call(:'teacher', $$select correct_txn('00000000-0000-4000-8000-000000004405', '00000000-0000-4000-8000-000000004402',
  '{"amount":30}', '金额录错')$$) ->> 'error', null, 'the bank admin edits a 取款 of a closed term');
select is((select status::text from txns where id = '00000000-0000-4000-8000-000000004402'), 'reversed', 'the old 取款 reversed');
select is((select amount from txns where corrects = '00000000-0000-4000-8000-000000004402'), 30, 'the new one is 30');
select is((select count(*)::int from txns where reversal_of = '00000000-0000-4000-8000-000000004402'
  and created_at = (select created_at from txns where id = '00000000-0000-4000-8000-000000004402')), 1, 'both at the original time');

-- A term not closed yet, and the holiday: reversed as before.
select is(tests.call(:'teacher', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000004403', '金额录错')$$) ->> 'type',
  'reversal', 'a 存款 of a term not closed yet is reversed');
select is(tests.call(:'president', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000004404', '金额录错')$$) ->> 'type',
  'reversal', 'and one between terms');

select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

select * from finish();
rollback;
