-- 按时还款 (PHASE-2.md §8.2): a period paid off counts +5 only once it has begun (the 7 days up to its due day) and not on
-- the day of the loan; borrowing 8 periods and paying them all back the same day earns nothing.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('t1', 'teller') as t1 \gset
select app_private.cn_date(now()) as today \gset
create function tests.at(p text) returns timestamptz language sql as $$ select (p::timestamp) at time zone 'Asia/Shanghai' $$;
create function tests.points(p_no text) returns text language sql as $$
  select coalesce(string_agg(concat_ws(' ', rule, delta, ref), ', ' order by id), '') from credit_events where student_no = p_no
$$;

-- At the counter today: 100 in 8 periods into the account, paid back in full at once.
select tests.student('s1', 100) as s1 \gset
select tests.call(:'t1', $$select open_loan('00000000-0000-4000-8000-0000000000f1', 's1', 100, '买文具', 'installment', 8, 'account')$$);
select is(tests.call(:'t1', $$select repay_loan(gen_random_uuid(), '00000000-0000-4000-8000-0000000000f1', 100, 'account', null)$$) #>> '{loan,status}',
  'closed', '8 periods borrowed and paid off the same day');
select is(tests.points('s1'), '', 'no 按时还款 and no 提前还清');
select is((select score from credit_scores where student_no = 's1'), 600, 'the score as it was');

-- On fixed days: 100 in 8 periods on Monday 3 March 2025 (due each Monday from 10 March).
create function tests.loan(p_id text, p_no text) returns void language sql as $$
  select app_private.start_loan(p_id::uuid, p_no, 100, '测试', 'installment', 8, 'account', (select id from profiles where login_id = 't1'),
    tests.at('2025-03-03 09:00'))
$$;
create function tests.pay(p_id text, p_amount integer, p_day text) returns void language sql as $$
  select app_private.pay_loan(p_id::uuid, null, p_amount, 'account', null, (select id from profiles where login_id = 't1'),
    tests.at(p_day || ' 12:00'), p_day::date, false, null)
$$;
select tests.student(n, 200) from unnest(array['a', 'b', 'c']) n;
select tests.loan('00000000-0000-4000-8000-0000000000a1', 'a');
select tests.loan('00000000-0000-4000-8000-0000000000b1', 'b');
select tests.loan('00000000-0000-4000-8000-0000000000c1', 'c');

-- a pays off on 4 March: the first period has begun (3 March is 7 days before 10 March), the seven after not yet; and
-- no 提前还清 within 7 days of the loan.
select tests.pay('00000000-0000-4000-8000-0000000000a1', (select remaining + ceil(interest_centi / 100.0)::integer from loans
  where id = '00000000-0000-4000-8000-0000000000a1'), '2025-03-04');
select is((select status from loans where id = '00000000-0000-4000-8000-0000000000a1'), 'closed', 'a pays off the day after');
select is(tests.points('a'), 'repay_on_time 5 loans:00000000-0000-4000-8000-0000000000a1:1', 'the period begun counts, the seven ahead do not');

-- b pays the second period on its own in its week (10 to 17 March): +5.
select tests.pay('00000000-0000-4000-8000-0000000000b1', 13, '2025-03-10');
select tests.pay('00000000-0000-4000-8000-0000000000b1', 13, '2025-03-10');
select is(tests.points('b'), 'repay_on_time 5 loans:00000000-0000-4000-8000-0000000000b1:1, repay_on_time 5 loans:00000000-0000-4000-8000-0000000000b1:2',
  'the first on its day, the second on the first day of its week');

-- c pays off on 10 March, a week after: the first period on its day, the second on the first day of its week; the six
-- after by 提前还清, not 按时还款.
select tests.pay('00000000-0000-4000-8000-0000000000c1', (select remaining + ceil(interest_centi / 100.0)::integer from loans
  where id = '00000000-0000-4000-8000-0000000000c1'), '2025-03-10');
select is(tests.points('c'), 'repay_on_time 5 loans:00000000-0000-4000-8000-0000000000c1:1, repay_on_time 5 loans:00000000-0000-4000-8000-0000000000c1:2, repay_early 10 loans:00000000-0000-4000-8000-0000000000c1',
  'paying off a week on: +5 for each period begun, +10 提前还清');

select * from finish();
rollback;
