-- 贷款 (PHASE-2.md §8.2, §10.3–10.9, §13, §14, §15, §17): on fixed days in 2025, the jobs' 自动扣款, 逾期, 罚息, the weekly
-- points, the anchor's 存贷比, 日均余额 net of loans, a catch-up against every day on time and 结转; then at the counter
-- today: the quote and the preview, paying out into the account and in cash, repaying with 多还 spread over the periods,
-- the interest's whole HTB and its 零头, the reversals, 逾期, 提前还清, 终止, the ranking, who reads what, 注销 and the
-- self-check.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('t2', 'teller') as teller2 \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select app_private.cn_date(now()) as today \gset

create function tests.at(p text) returns timestamptz language sql as $$ select (p::timestamp) at time zone 'Asia/Shanghai' $$;
-- A student opened on 1 March 2025 (8:00) with an opening balance that day, if any.
create function tests.old(p_no text, p_opening integer) returns void language plpgsql as $$
begin
  perform tests.student(p_no, 0);
  update students set opened_at = tests.at('2025-03-01 08:00') where student_no = p_no;
  update accounts set balance = p_opening, total_in = p_opening where student_no = p_no;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
  select gen_random_uuid(), 'opening', p_no, p_opening, p_opening, p_opening, (select id from profiles where login_id = 'teacher'),
    tests.at('2025-03-01 08:00') where p_opening > 0;
end $$;
-- A 柜台存款 at p_at.
create function tests.deposit(p_no text, p_amount integer, p_at text) returns void language plpgsql as $$
declare v integer;
begin
  update accounts set balance = balance + p_amount, total_in = total_in + p_amount where student_no = p_no returning balance into v;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, operator_id, created_at)
  values (gen_random_uuid(), 'deposit', p_no, p_amount, p_amount, v, p_amount, (select id from profiles where login_id = 'teacher'), tests.at(p_at));
end $$;
-- A loan paid out by t1 at p_at.
create function tests.loan(p_id text, p_no text, p_amount integer, p_plan text, p_periods integer, p_via text, p_at text)
returns void language sql as $$
  select app_private.start_loan(p_id::uuid, p_no, p_amount, '测试', p_plan, p_periods, p_via, (select id from profiles where login_id = 't1'),
    tests.at(p_at))
$$;

-- run_jobs (§13) through 春季, Monday 3 March to Sunday 13 April 2025. All at 600 分 (6.2667%/周, 罚息 9.4001%):
-- a borrows 100 in 4 periods into the account and keeps enough to pay each on its day; b borrows 50 in cash for 2 weeks
-- with nothing in 活期, deposits 30 on 25 March and 100 on 1 April; d borrows 40 for 6 weeks, past the term's last day
-- (a term shortened after); n borrows 100 for 4 weeks on top of 60 of its own.
savepoint jobs;
insert into terms (name, starts_on, ends_on) values ('春季', '2025-03-03', '2025-04-13');
update job_runs set done_to = '2025-03-02', last_ok = null, last_err = null;
select tests.old('a', 200);
select tests.old('b', 0);
select tests.old('d', 100);
select tests.old('n', 60);
select tests.loan('00000000-0000-4000-8000-0000000000a1', 'a', 100, 'installment', 4, 'account', '2025-03-03 09:00');
select tests.loan('00000000-0000-4000-8000-0000000000b1', 'b', 50, 'bullet', 2, 'cash', '2025-03-03 10:00');
select tests.loan('00000000-0000-4000-8000-0000000000d1', 'd', 40, 'bullet', 6, 'account', '2025-03-03 11:00');
select tests.loan('00000000-0000-4000-8000-0000000000e1', 'n', 100, 'bullet', 4, 'account', '2025-03-03 12:00');
select tests.deposit('b', 30, '2025-03-25 12:00');
select tests.deposit('b', 100, '2025-04-01 09:00');
select is(array(select concat_ws(' ', l.student_no, l.principal, l.rate, l.plan, l.periods, l.disbursed_via, l.status, t.amount,
    t.balance_delta, t.cash_delta, t.reason) from loans l join txns t on t.id = l.loan_txn order by l.id),
  array['a 100 6.2667 installment 4 account active 100 100 0 分 4 期，用途：测试', 'b 50 6.2667 bullet 2 cash active 50 0 -50 一次还清 2 周，用途：测试',
    'd 40 6.2667 bullet 6 account active 40 40 0 一次还清 6 周，用途：测试', 'n 100 6.2667 bullet 4 account active 100 100 0 一次还清 4 周，用途：测试'],
  'the rate locked at the anchor and score of the day; the loan transaction says the plan and the purpose');
select is(array(select concat_ws(' ', seq, due_on, principal) from loan_periods where loan_id = '00000000-0000-4000-8000-0000000000a1' order by seq),
  array['1 2025-03-10 25', '2 2025-03-17 25', '3 2025-03-24 25', '4 2025-03-31 25'], '等额本金, a period each 7 days');
select is(jsonb_path_query_array(app_private.term_open_items((select t from terms t where name = '春季')), '$[*].kind'),
  '["job","loan","loan","loan","loan"]', 'the loans not paid off keep the term from 结转');
select is((app_private.term_open_items((select t from terms t where name = '春季')) -> 1) - 'loan_no',
  '{"kind":"loan","id":"00000000-0000-4000-8000-0000000000b1","student_no":"b","name":"学生b","remaining":50,"status":"active","due_on":"2025-03-17"}',
  'each named, the first due first');

create function tests.state() returns text language sql as $$
  select concat_ws(' | ',
    (select string_agg(concat_ws(' ', id, remaining, interest_centi, status, closed_on), ', ' order by id) from loans),
    (select string_agg(concat_ws(' ', loan_id, seq, due_on, principal, paid, overdue_at), ', ' order by loan_id, seq) from loan_periods),
    (select string_agg(concat_ws(' ', t.student_no, t.type, t.amount, t.balance_after, t.created_at, t.reason, p.interest, p.principal, p.auto), ', '
       order by t.student_no, t.created_at, t.type) from txns t left join loan_payments p on p.txn_id = t.id where t.type in ('repay', 'interest')),
    (select string_agg(concat_ws(' ', week_start, deposits, loans, ratio, growth, adjust, anchor), ', ' order by week_start) from rate_weeks),
    (select string_agg(concat_ws(' ', student_no, rule, delta, score, at, ref), ', ' order by student_no, id) from credit_events),
    (select string_agg(concat_ws(' ', student_no, interest_carry, balance), ', ' order by student_no) from accounts))
$$;
savepoint every_day;
do $$
declare d date;
begin
  for d in select generate_series('2025-03-03'::date, '2025-04-15', interval '1 day') loop
    perform app_private.run_jobs(d);
  end loop;
end $$;
select tests.state() as every_day \gset
rollback to savepoint every_day;
select is(app_private.run_jobs('2025-04-15') -> 'failed', 'null', 'catching up the whole term at once');
select is(tests.state(), :'every_day', 'gives the same repayments, interest, 逾期, scores and anchors as every day on time');
select is(app_private.run_jobs('2025-04-15') -> 'ran', '[]', 'and running again changes nothing');
select is(tests.state(), :'every_day', 'nothing at all');

-- a: 100 × 6.2667% ÷ 7 = 0.89 a day; 7 days by 10 March: 6.23, 6 HTB with the first 25 and 0.23 carried; then 0.67 × 7
-- (75 left) → 4 HTB, 0.44 × 7 → 4 HTB, and 0.22 × 7 = 1.54, rounded up to 2 HTB with the last 25.
select is(array(select concat_ws(' ', t.amount, t.reason, t.created_at, t.operator_id = app_private.system_user(), t.payment, t.cash_delta, p.auto)
    from txns t join loan_payments p on p.txn_id = t.id where t.student_no = 'a' order by t.seq),
  array(select concat_ws(' ', x.amount, x.reason, tests.at(x.at), true, 'account', 0, true) from (values
    (31, '自动扣款，利息 6 HTB，本金 25 HTB', '2025-03-11'), (29, '自动扣款，利息 4 HTB，本金 25 HTB', '2025-03-18'),
    (29, '自动扣款，利息 4 HTB，本金 25 HTB', '2025-03-25'), (27, '自动扣款，利息 2 HTB，本金 25 HTB', '2025-04-01')) x(amount, reason, at)),
  '自动扣款 at the end of each day due, dated the next midnight, by the system login: interest first, the last one rounded up');
select is((select concat_ws(' ', remaining, interest_centi, status, closed_on) from loans where student_no = 'a'), '0 0 closed 2025-03-31', 'a paid off on its last day');
select is(array(select concat_ws(' ', rule, delta, ref, at) from credit_events where student_no = 'a' and rule like 'repay%' order by id),
  array(select concat_ws(' ', 'repay_on_time', 5, 'loans:00000000-0000-4000-8000-0000000000a1:' || k, tests.at(x)) from (values
    (1, '2025-03-11'), (2, '2025-03-18'), (3, '2025-03-25'), (4, '2025-04-01')) v(k, x)),
  '+5 for each period paid on its day, and no 提前还清 for the last one');
select is(array(select loan_estimate ->> 'interest' from jsonb_array_elements(app_private.loan_estimate(100, 'installment', 4, 6.2667, '2025-03-03')) loan_estimate),
  array['6', '4', '4', '2'], 'loan_estimate foretells the interest of a loan paid on its days');

-- b: 14 days at 0.44 = 6.16, nothing to take on 17 March: 逾期; 0.44 that day, then 罚息 50 × 9.4001% ÷ 7 = 0.67 × 7;
-- 25 March takes the 30: 11 HTB of interest and 19 of principal; 0.41 a day on the 31 left; 1 April pays off 31 + 3.16 → 35.
select is(array(select concat_ws(' ', t.amount, t.reason, t.created_at) from txns t where t.student_no = 'b' and t.type = 'repay' order by t.seq),
  array[concat_ws(' ', 30, '自动扣款，利息 11 HTB，本金 19 HTB', tests.at('2025-03-26')), concat_ws(' ', 35, '自动扣款，利息 4 HTB，本金 31 HTB', tests.at('2025-04-02'))],
  '逾期: each day after, what 活期 has by the night, the overdue principal at the penalty rate');
select is((select concat_ws(' ', status, closed_on) from loans where student_no = 'b'), 'closed 2025-04-01', 'paid off');
select is((select concat_ws(' ', seq, overdue_at) from loan_periods where loan_id = '00000000-0000-4000-8000-0000000000b1'),
  concat_ws(' ', 1, tests.at('2025-03-18')), 'the period 逾期 at the end of its day');
select is(array(select concat_ws(' ', rule, delta, reason, at) from credit_events where student_no = 'b' and (rule like 'repay%' or rule like 'overdue%') order by id),
  array[concat_ws(' ', 'overdue', -50, '贷款 ' || (select loan_no from loans where student_no = 'b') || ' 第 1 期逾期', tests.at('2025-03-18')),
    concat_ws(' ', 'overdue_week', -30, '贷款 ' || (select loan_no from loans where student_no = 'b') || ' 逾期满 1 周', tests.at('2025-03-31'))],
  '−50 that night, −30 on the Monday a full week on, none once paid; no points for paying late');

select is((select string_agg(concat_ws(' ', t.amount, t.created_at, p.due_on), ', ') from txns t join loan_periods p on p.loan_id = t.loan_id
    where t.student_no = 'd' and t.type = 'repay'), concat_ws(' ', 55, tests.at('2025-04-14'), '2025-04-13'),
  'd falls due in full on the term''s last day: 41 days at 0.35, 40 + 15');
select is((select count(*)::int from credit_events where student_no = 'd' and rule = 'repay_on_time'), 1, 'on time');
select is((select amount from txns where student_no = 'n' and type = 'repay'), 125, 'n pays 100 and 28 × 0.89 = 24.92 → 25 on its day');
select is((select count(*)::int from credit_events where student_no = 'n' and rule like 'balance%'), 0,
  '日均余额 leaves the loan out: n kept 160 in 活期, 60 of it its own');
select is((select array_agg(rule order by rule) from credit_events where student_no = 'a' and ref = 'weeks:2025-03-10'), array['balance_100'],
  'a kept 300, 100 of it borrowed');
select is(array(select concat_ws(' ', week_start, loans) from rate_weeks order by week_start),
  array['2025-03-03 0', '2025-03-10 290', '2025-03-17 265', '2025-03-24 240', '2025-03-31 196', '2025-04-07 40'],
  '存贷比 counts the 贷款剩余本金 at each Monday''s start');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
select is(app_private.term_open_items((select t from terms t where name = '春季')), '[]', 'nothing keeps the term from 结转');
select is((tests.call(:'teacher', 'select bank_report(''2025-03-01'', ''2025-04-15'')') #> '{balance,changes}') - 'opening' - 'deposit' - 'interest',
  '{"loan":240,"repay":-361}', 'the report shows 放款 and 还款 among the balance changes');
rollback to savepoint jobs;

-- At the counter today, in a term from 10 days ago to 30 days ahead: 4 weeks fit, 5 do not.
insert into terms (name, starts_on, ends_on) values ('本学期', :'today'::date - 10, :'today'::date + 30);
select tests.student('s1', 100) as s1 \gset
select tests.student('s2', 120) as s2 \gset
select tests.student('s3', 0) as s3 \gset
select tests.student('s4', 20) as s4 \gset
select tests.student('s5', 200) as s5 \gset
select tests.student('low', 100);
update credit_scores set score = 350 where student_no = 'low';
select tests.student('frz', 100);
update students set status = 'frozen' where student_no = 'frz';
select tests.student('pay', 100);
insert into staff_payroll (user_id, account) values (:'teller', 'pay');

select is(tests.call(:'teller', 'select loan_quote(''s1'')'),
  jsonb_build_object('student_no', 's1', 'score', 600, 'limit', 130, 'rate', 6.2667, 'penalty_rate', 9.4001, 'max_weeks', 4, 'max_periods', 4,
    'term', jsonb_build_object('id', (select id from terms where name = '本学期'), 'name', '本学期', 'ends_on', :'today'::date + 30),
    'balance', 100, 'blocked', null, 'loan', null),
  'the quote: score, 额度, this week''s rate and penalty, the most weeks before the term ends');
select is(tests.call(:'teller', 'select loan_preview(''s1'', 100, ''installment'', 4)'),
  jsonb_build_object('rate', 6.2667, 'penalty_rate', 9.4001, 'interest', 16, 'interest_centi', 1554, 'schedule', (select jsonb_agg(jsonb_build_object('seq', k,
    'due_on', :'today'::date + 7 * k, 'principal', 25, 'interest_centi', (array[623, 469, 308, 154])[k], 'interest', (array[6, 4, 4, 2])[k]) order by k)
    from generate_series(1, 4) k)),
  'the preview: each period''s principal, the interest it accrues and the whole HTB paid with it');
select is(tests.call(:'teller', 'select loan_preview(''s1'', 100, ''bullet'', 2)') -> 'schedule',
  jsonb_build_array(jsonb_build_object('seq', 1, 'due_on', :'today'::date + 14, 'principal', 100, 'interest_centi', 1246, 'interest', 13)),
  'all at once: 14 × 0.89 → 13');

select tests.call(:'teller', $$select open_loan('00000000-0000-4000-8000-0000000000f1', 's1', 100, ' 买文具 ', 'installment', 4, 'account')$$) as opened \gset
select is(:'opened'::jsonb - 'id' - 'txn_no' - 'created_at' - 'loan',
  '{"type":"loan","amount":100,"balance_after":200,"denominations":null,"change_given":null}', '放款 into the account');
select is((:'opened'::jsonb -> 'loan') - 'loan_txn' - 'loan_no' - 'operator_id' - 'schedule' - 'payments',
  jsonb_build_object('id', '00000000-0000-4000-8000-0000000000f1', 'student_no', 's1', 'principal', 100, 'remaining', 100, 'rate', 6.2667,
    'score', 600, 'plan', 'installment', 'periods', 4, 'purpose', '买文具', 'disbursed_via', 'account', 'interest_centi', 0, 'status', 'active',
    'opened_on', :'today'::date, 'closed_on', null, 'terminated_at', null, 'terminated_by', null, 'terminate_reason', null,
    'payoff', 100, 'next', jsonb_build_object('seq', 1, 'due_on', :'today'::date + 7, 'amount', 25)),
  'the loan: 本期应还 25, 全部结清 100');
select is(:'opened'::jsonb #>> '{loan,loan_no}' ~ ('^DK' || to_char(:'today'::date, 'YYMMDD') || '[0-9]{4,}$'), true, '贷款号 DK + YYMMDD + 序号');
select is(jsonb_path_query_array(:'opened'::jsonb, '$.loan.schedule[*].principal'), '[25, 25, 25, 25]', 'its plan');
select is((select concat_ws(' ', reason, payment, cash_delta, loan_id, operator_id = :'teller') from txns where id = (:'opened'::jsonb ->> 'id')::uuid),
  '分 4 期，用途：买文具 account 0 00000000-0000-4000-8000-0000000000f1 t', 'the loan transaction says the plan and the purpose');
select is(tests.call(:'teller', $$select open_loan('00000000-0000-4000-8000-0000000000f1', 's1', 100, '买文具', 'installment', 4, 'account')$$) ->> 'id',
  :'opened'::jsonb ->> 'id', 'sent again, the same result');
select is(tests.call(:'teller', $$select open_loan(gen_random_uuid(), 's2', 10, 'x', 'installment', 5, 'account')$$) - 'error',
  jsonb_build_object('detail', jsonb_build_object('ends_on', :'today'::date + 30, 'max_weeks', 4)::text), 'TERM_TOO_LONG: the term ends first, 4 weeks at most');
select is(tests.call(:'teller', $$select open_loan(gen_random_uuid(), 's2', 131, 'x', 'bullet', 1, 'account')$$),
  '{"error":"OVER_CREDIT_LIMIT","detail":"{\"limit\": 130}"}', 'not over the 额度');
select is(tests.call(:'teller', $$select open_loan(gen_random_uuid(), 'low', 10, 'x', 'bullet', 1, 'account')$$),
  '{"error":"CREDIT_TOO_LOW","detail":"{\"score\": 350, \"min_score\": 400}"}', '400 分 or more');
select is(tests.err(:'teller', format('select open_loan(gen_random_uuid(), %L, %s, %L, %L, %s, %L)', n, a, u, p, k, v)), e, why)
from (values ('s1', 10, 'x', 'bullet', 1, 'account', 'LOAN_OUTSTANDING', 'one loan at a time'),
  ('s2', 0, 'x', 'bullet', 1, 'account', 'INVALID_AMOUNT', '1 HTB or more'),
  ('s2', 10, 'x', 'weekly', 1, 'account', 'INVALID_INPUT', 'installment or bullet'),
  ('s2', 10, 'x', 'bullet', 0, 'account', 'INVALID_INPUT', '1–8 periods'),
  ('s2', 10, 'x', 'bullet', 1, 'card', 'INVALID_INPUT', 'into the account or in cash'),
  ('s2', 10, ' ', 'bullet', 1, 'account', 'INVALID_INPUT', 'a purpose'),
  ('s2', 10, repeat('字', 31), 'bullet', 1, 'account', 'INVALID_INPUT', 'of 30 characters at most'),
  ('frz', 10, 'x', 'bullet', 1, 'account', 'STUDENT_INACTIVE', 'an account in use'),
  ('pay', 10, 'x', 'bullet', 1, 'account', 'SELF_SERVICE_FORBIDDEN', 'not the teller''s own pay account'),
  ('nobody', 10, 'x', 'bullet', 1, 'account', 'STUDENT_NOT_FOUND', 'a student that exists')) t(n, a, u, p, k, v, e, why);
select is(tests.err(w, $$select open_loan(gen_random_uuid(), 's2', 10, 'x', 'bullet', 1, 'account')$$), 'FORBIDDEN', 'the counter''s alone')
from unnest(array[:'president', :'teacher', :'accountant', :'s2']::uuid[]) w;
update duty set ended_at = now(), txns = 0 where user_id = :'teller2';
select is(tests.err(:'teller2', $$select open_loan(gen_random_uuid(), 's2', 10, 'x', 'bullet', 1, 'account')$$), 'OFF_DUTY', 'on duty');
savepoint holiday;
update terms set starts_on = :'today'::date + 1, ends_on = :'today'::date + 60 where name = '本学期';
select is(tests.err(:'teller', $$select open_loan(gen_random_uuid(), 's2', 10, 'x', 'bullet', 1, 'account')$$), 'NO_TERM', 'none in the holidays');
select is(tests.call(:'teller', 'select loan_quote(''s2'')') - 'student_no' - 'score' - 'limit' - 'rate' - 'penalty_rate' - 'balance',
  '{"term":null,"max_weeks":null,"max_periods":null,"blocked":"NO_TERM","loan":null}', 'the quote says why');
rollback to savepoint holiday;
select is(tests.call(:'teller', 'select loan_quote(''low'')') ->> 'blocked', 'CREDIT_TOO_LOW', 'below 400 分');
select is(tests.call(:'teller', 'select loan_quote(''low'')') -> 'limit', 'null', 'no 额度');
select is(tests.call(:'teller', 'select loan_quote(''frz'')') ->> 'blocked', 'STUDENT_INACTIVE', 'a frozen account');
select is(tests.err(:'teller', $$select open_term_deposit(gen_random_uuid(), 's1', 10, 2)$$), 'LOAN_OUTSTANDING', 'no 定期 while a loan is not paid off');
select is(tests.call(:'teller', 'select lookup_student(''s1'')') - 'credit' - 'name' - 'cohort' - 'grade' - 'class_no' - 'class_label' - 'division',
  '{"student_no":"s1","status":"normal","balance":200,"term_total":0,"wealth_total":0,"wealth_value_centi":0,"loan_remaining":100,"loan_overdue":false,"withdrawn_today":0}',
  '查询 shows the loan left');

-- 现金放款: notes as for a withdrawal, 活期 unchanged, the cash table pays them out.
select tests.call(:'teller', $$select open_loan('00000000-0000-4000-8000-0000000000f2', 's2', 37, '买书', 'bullet', 2, 'cash')$$) as cash \gset
select is(:'cash'::jsonb - 'id' - 'txn_no' - 'created_at' - 'loan',
  '{"type":"loan","amount":37,"balance_after":120,"denominations":{"10":3,"5":1,"2":1},"change_given":null}', '现金放款 with its notes');
select is((select concat_ws(' ', reason, payment, balance_delta, cash_delta) from txns where id = (:'cash'::jsonb ->> 'id')::uuid),
  '一次还清 2 周，用途：买书 cash 0 -37', 'in cash');
select is(tests.call(:'teller', 'select duty_cash()') #> '{payout,total}', '37', '下班总结 pays the notes out');

-- 还款 (§10.4, §10.5): 30 of s1's 100 before the first period is due: 25 pays it, the 5 more comes off the three after.
select tests.call(:'teller', format($$select repay_loan('00000000-0000-4000-8000-0000000000c1', %L, 30, 'account', null)$$,
  '00000000-0000-4000-8000-0000000000f1')) as r1 \gset
select is(:'r1'::jsonb - 'id' - 'txn_no' - 'created_at' - 'loan',
  '{"type":"repay","amount":30,"balance_after":170,"denominations":null,"change_given":null}', '还款 from the account');
select is(array[jsonb_path_query_array(:'r1'::jsonb, '$.loan.schedule[*].principal'), jsonb_path_query_array(:'r1'::jsonb, '$.loan.schedule[*].paid')],
  array['[25, 23, 23, 24]', '[25, 0, 0, 0]']::jsonb[], '多还 spreads 70 over the three periods left');
select is(array[:'r1'::jsonb #>> '{loan,remaining}', :'r1'::jsonb #>> '{loan,payoff}', :'r1'::jsonb #> '{loan,next}' ->> 'amount'],
  array['70', '70', '23'], 'remaining 70; 本期应还 now the second period''s 23');
select is((select concat_ws(' ', reason, loan_id) from txns where id = '00000000-0000-4000-8000-0000000000c1'),
  '利息 0 HTB，本金 30 HTB 00000000-0000-4000-8000-0000000000f1', 'the repay transaction says the interest and the principal');
select is((select concat_ws(' ', rule, delta, ref) from credit_events where student_no = 's1'),
  'repay_on_time 5 loans:00000000-0000-4000-8000-0000000000f1:1', '+5 for the period paid by its day');
select is(tests.call(:'teller', format($$select repay_loan(gen_random_uuid(), %L, 71, 'account', null)$$, '00000000-0000-4000-8000-0000000000f1')),
  '{"error":"REPAY_TOO_MUCH","detail":"{\"max\": 70}"}', 'not more than all it takes to pay it off');
update loans set interest_centi = 150 where id = '00000000-0000-4000-8000-0000000000f1';
select is(tests.call(:'teller', 'select loan_quote(''s1'')') -> 'loan' ->> 'payoff', '72', '1.50 of interest: paying off takes 70 + 2');
select is(tests.call(:'teller', 'select loan_quote(''s1'')') #>> '{loan,next,amount}', '24', 'the period 23 + the interest''s whole 1 HTB');
select is(tests.call(:'teller', format($$select repay_loan(gen_random_uuid(), %L, 71, 'account', null)$$, '00000000-0000-4000-8000-0000000000f1')),
  '{"error":"INVALID_AMOUNT","detail":"{\"payoff\": 72}"}', 'the principal is paid off only with the interest rounded up');
select is(tests.err(:'teller', format($$select repay_loan(gen_random_uuid(), %L, 5, 'cash', '{"10":1}')$$, '00000000-0000-4000-8000-0000000000f1')),
  'INVALID_AMOUNT', 'cash: the amount the notes come to');
select tests.call(:'teller', format($$select repay_loan('00000000-0000-4000-8000-0000000000c2', %L, null, 'cash', '{"10":1}')$$,
  '00000000-0000-4000-8000-0000000000f1')) as r2 \gset
select is(array[:'r2'::jsonb ->> 'amount', :'r2'::jsonb ->> 'balance_after', :'r2'::jsonb #>> '{loan,interest_centi}', :'r2'::jsonb #>> '{loan,remaining}'],
  array['10', '170', '50', '61'], '现金还款 of 10: 1 HTB of interest, 0.50 left, 9 of principal');
select is((select concat_ws(' ', reason, payment, balance_delta, cash_delta) from txns where id = '00000000-0000-4000-8000-0000000000c2'),
  '利息 1 HTB，本金 9 HTB cash 0 10', 'in cash');
select is(tests.call(:'teller', 'select duty_cash()') #> '{income,total}', '10', '下班总结 takes the notes in');
select is(tests.call(:'teller', format($$select repay_loan('00000000-0000-4000-8000-0000000000c2', %L, null, 'cash', '{"10":1}')$$,
  '00000000-0000-4000-8000-0000000000f1')) ->> 'id', '00000000-0000-4000-8000-0000000000c2', 'sent again, the same result');
select is(tests.err(w, format($$select repay_loan(gen_random_uuid(), %L, 1, 'account', null)$$, '00000000-0000-4000-8000-0000000000f1')), 'FORBIDDEN',
  'the counter''s alone') from unnest(array[:'president', :'teacher', :'s1']::uuid[]) w;
select is(tests.err(:'teller', format($$select repay_loan(gen_random_uuid(), %L, 1, 'account', null)$$, gen_random_uuid())), 'INVALID_INPUT', 'a loan that exists');

-- 冲正 (§10.9): the last repayment first, each putting the plan and the interest back; then the loan, void.
select is(tests.err(:'teller', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-0000000000c1', '金额录错')$$), 'REVERSAL_NOT_ALLOWED',
  'not a repayment with a later one');
select is(tests.err(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'opened'::jsonb ->> 'id')), 'REVERSAL_NOT_ALLOWED',
  'not a loan paid on');
select is(tests.call(:'teller', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-0000000000c2', '金额录错')$$) ->> 'type', 'reversal',
  'the cash repayment reversed');
select is((select concat_ws(' ', remaining, interest_centi) from loans where id = '00000000-0000-4000-8000-0000000000f1'), '70 150', 'the interest owed again');
select is(tests.call(:'teller', 'select duty_cash()') #> '{income,total}', '0', 'its notes go back out within the same duty');
select is(tests.call(:'teller', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-0000000000c1', '金额录错')$$) ->> 'balance_after', '200',
  'then the first');
select is((select array_agg(concat_ws(' ', principal, paid) order by seq) from loan_periods where loan_id = '00000000-0000-4000-8000-0000000000f1'),
  array['25 0', '25 0', '25 0', '25 0'], 'the plan as it was');
select is((select string_agg(t.loan_id::text, ' ') from txns t where t.type = 'reversal' and t.student_no = 's1'),
  '00000000-0000-4000-8000-0000000000f1 00000000-0000-4000-8000-0000000000f1', 'each reversal names the loan');
select is(tests.call(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''业务选错'')', :'opened'::jsonb ->> 'id')) ->> 'balance_after', '100',
  'nothing paid on it: the loan reversed, its 100 out of 活期');
select is((select concat_ws(' ', status, remaining, interest_centi) from loans where id = '00000000-0000-4000-8000-0000000000f1'), 'reversed 0 0',
  '作废: no interest');
select is(tests.call(:'teller', 'select loan_quote(''s1'')') -> 'blocked', 'null', 's1 may borrow again');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- 逾期 (§10.7): s3 borrowed 20 in cash 8 days ago for 1 week, with nothing in 活期.
select tests.loan('00000000-0000-4000-8000-0000000000f3', 's3', 20, 'installment', 1, 'cash', (:'today'::date - 8 + time '12:00')::text);
select app_private.collect_loans(:'today'::date - 1, false);
select is((select concat_ws(' ', l.status, p.overdue_at) from loans l join loan_periods p on p.loan_id = l.id where l.student_no = 's3'),
  concat_ws(' ', 'overdue', (:'today'::date)::timestamp at time zone 'Asia/Shanghai'), '逾期 at the end of the day due');
select is((select concat_ws(' ', rule, delta) from credit_events where student_no = 's3'), 'overdue -50', '−50');
select is(tests.call(:'teller', 'select lookup_student(''s3'')') -> 'loan_overdue', 'true', 'the card shows 贷款逾期');
select is(tests.call(:'teller', 'select loan_quote(''s3'')') ->> 'blocked', 'LOAN_OUTSTANDING', 'no new loan until it is paid off');
select is(tests.err(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''业务选错'')', (select loan_txn from loans where student_no = 's3'))),
  'REVERSAL_NOT_ALLOWED', 'an overdue loan is not reversed');
select is(tests.call(:'teller', $$select repay_loan('00000000-0000-4000-8000-0000000000c3', '00000000-0000-4000-8000-0000000000f3', 20, 'cash', '{"10":2}')$$)
  #>> '{loan,status}', 'closed', 'paid off in cash');
select is((select count(*)::int from credit_events where student_no = 's3'), 1, 'no points for paying late');
select is(tests.call(:'teller', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-0000000000c3', '金额录错')$$) ->> 'type', 'reversal',
  'the repayment reversed');
select is((select concat_ws(' ', status, remaining, closed_on is null) from loans where student_no = 's3'), 'overdue 20 t', '逾期 again');

-- 提前还清 (§8.2): s5 borrowed 50 for 2 weeks 8 days ago and pays it all today.
select tests.loan('00000000-0000-4000-8000-0000000000f5', 's5', 50, 'bullet', 2, 'account', (:'today'::date - 8 + time '12:00')::text);
select is(tests.call(:'teller', $$select repay_loan('00000000-0000-4000-8000-0000000000c5', '00000000-0000-4000-8000-0000000000f5', 50, 'account', null)$$)
  #>> '{loan,status}', 'closed', 'paid off');
select is(array(select concat_ws(' ', rule, delta, ref) from credit_events where student_no = 's5' order by id),
  array['repay_on_time 5 loans:00000000-0000-4000-8000-0000000000f5:1', 'repay_early 10 loans:00000000-0000-4000-8000-0000000000f5'],
  '+5 for the period and +10 for paying off early');
select tests.call(:'teller', $$select open_loan(gen_random_uuid(), 's5', 10, '买书', 'bullet', 1, 'account')$$) is not null;
select is(tests.err(:'teller', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-0000000000c5', '金额录错')$$), 'REVERSAL_NOT_ALLOWED',
  'a loan paid off stays so once the student has another');

-- 终止 (§10.8): s4 borrowed 100 in cash in 4 periods and has 20 in 活期.
select tests.call(:'teller', $$select open_loan('00000000-0000-4000-8000-0000000000f4', 's4', 100, '买球拍', 'installment', 4, 'cash')$$) is not null;
select is(tests.err(w, $$select terminate_loan('00000000-0000-4000-8000-0000000000f4', '违规')$$), 'FORBIDDEN', 'the president''s and bank admin''s')
from unnest(array[:'teller', :'accountant', :'s4']::uuid[]) w;
select is(tests.err(:'president', $$select terminate_loan('00000000-0000-4000-8000-0000000000f4', ' ')$$), 'INVALID_INPUT', 'with a reason');
select tests.call(:'president', $$select terminate_loan('00000000-0000-4000-8000-0000000000f4', '学生已转学')$$) as ended \gset
select is((:'ended'::jsonb -> 'txn') - 'id' - 'txn_no' - 'created_at',
  '{"type":"repay","amount":20,"balance_after":0,"denominations":null,"change_given":null}', 'all falls due: 活期 pays 20');
select is((select concat_ws(' ', reason, operator_id = :'president') from txns where id = (:'ended'::jsonb #>> '{txn,id}')::uuid),
  '终止，利息 0 HTB，本金 20 HTB t', 'by the president, said as 终止');
select is(array[:'ended'::jsonb #>> '{loan,status}', :'ended'::jsonb #>> '{loan,terminate_reason}', :'ended'::jsonb #>> '{loan,remaining}',
    (:'ended'::jsonb #>> '{loan,terminated_by}' = :'president'::text)::text], array['overdue', '学生已转学', '80', 'true'], 'the rest 逾期 at once');
select is((select array_agg(concat_ws(' ', due_on = :'today'::date, overdue_at is not null) order by seq) from loan_periods
  where loan_id = '00000000-0000-4000-8000-0000000000f4'), array['t t', 't t', 't t', 't t'], 'every period due today and 逾期');
select is(array(select concat_ws(' ', rule, delta, ref) from credit_events where student_no = 's4'), array['overdue -50 loans:00000000-0000-4000-8000-0000000000f4:1'],
  '−50 once, no points for the 20 paid');
select is((select count(*)::int from audit_log where action = 'loan.terminate' and target = 'loans:00000000-0000-4000-8000-0000000000f4'), 1, 'logged');
select is(tests.call(:'teacher', $$select terminate_loan('00000000-0000-4000-8000-0000000000f4', '再次')$$) -> 'txn', 'null', 'terminated once');

-- 排名 (§16.3) by 活期 + 定期本金 less the loan: rb borrowed 50 into its 80 and still comes second.
select tests.student('ra', 100, null, 'junior') as ra \gset
select tests.student('rb', 80, null, 'junior') as rb \gset
select tests.call(:'teller', $$select open_loan(gen_random_uuid(), 'rb', 50, '买书', 'bullet', 1, 'account')$$) is not null;
select is(jsonb_path_query_array(tests.call(:'rb', 'select deposit_ranking()') -> 'top', '$[*].balance'), '[100, 80]', 'borrowing raises no one''s place');

-- Who reads what (§3, §16).
select is(tests.call(:'s4', 'select jsonb_build_array((select count(*) from loans), (select count(*) from loan_periods), (select count(*) from loan_payments))'),
  '[1, 4, 1]', 'a student reads their own loan, plan and repayments');
select is(tests.call(:'s1', 'select jsonb_agg(student_no) from loans'), '["s1"]', 'only their own');
select is(tests.call(w, 'select count(*) from loans'), (select count(*)::text from loans)::jsonb, 'the accountant, president and bank admin everyone''s')
from unnest(array[:'accountant', :'president', :'teacher']::uuid[]) w;
select is(tests.call(w, 'select (select count(*) from loans) + (select count(*) from loan_periods) + (select count(*) from loan_payments)'), '0',
  'the others none, the counter through loan_quote') from unnest(array[:'teller', :'keeper', :'ops']::uuid[]) w;
select is(tests.err(:'teller', 'select loan_quote(''pay'')'), 'SELF_SERVICE_FORBIDDEN', 'not of the teller''s own pay account');
select is(tests.err(w, 'select loan_quote(''s1'')'), 'FORBIDDEN', 'the quote is the counter''s') from unnest(array[:'teacher', :'s1']::uuid[]) w;

-- 注销 (§10.2): not with a loan not paid off.
select is(tests.call(:'teacher', format('select close_accounts(array[%L]::uuid[])', :'s3')) ->> 'error', 'LOAN_OUTSTANDING', 'paid off or terminated first');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- The self-check (§14.1) finds a 贷款剩余本金 that does not match its transactions or its plan.
update loans set remaining = remaining + 5 where student_no = 's4';
select is(array(select concat_ws(' ', kind, recorded, expected) from app_private.check_balances()), array['loan 85 80', 'loan_plan 85 80'],
  'check_balances: remaining against the loan and repayments, and against the plan');

select * from finish();
rollback;
