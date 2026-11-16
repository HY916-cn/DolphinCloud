-- 手动补录与更正 (PHASE-2.md §10.11, §9.3–9.4, §14, §15, §17): each type entered, the range of the time it happened, the
-- bank admin alone, 活期 since then never below 0, the interest accrued since then corrected (weeks paid and not, a term
-- over), an entry made before its days were accrued against one made after, 编辑 as a reversal and an entry, what cannot
-- be edited, the cash outside every duty, the queries and the self-check. The days are counted back from today, since
-- the entries may not be dated after now.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select app_private.cn_date(now()) as today \gset
-- The last day the jobs can be run to with an accrual left unpaid: the day before today's Monday is paid on it.
select app_private.cn_date(now()) - case when extract(isodow from now() at time zone 'Asia/Shanghai') = 1 then 1 else 0 end as x \gset

-- One rate all along, 2% × 600 分 = 2.08%/周: the anchor stays at 2% and no rule moves a score, so the two ways of
-- recording below meet the same rates.
update settings set value = value || '{"initial":2,"min":2,"max":2}' where key = 'anchor_params';
update settings set value = (select jsonb_object_agg(key, 0) from jsonb_each(value)) where key = 'credit_rules';

create function tests.noon(p_day date) returns timestamptz language sql as $$ select (p_day + time '12:00') at time zone 'Asia/Shanghai' $$;
-- A transaction the counter wrote at noon of its day (as in 24_interest.sql).
create function tests.tx(p_no text, p_type txn_type, p_amount integer, p_day date) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_delta integer := case when p_type = 'withdraw' then -p_amount else p_amount end;
  v_balance integer;
begin
  update accounts set balance = balance + v_delta, total_in = total_in + case when p_type in ('opening', 'deposit') then p_amount else 0 end,
    total_out = total_out + case when p_type = 'withdraw' then p_amount else 0 end
  where student_no = p_no returning balance into v_balance;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, operator_id, created_at)
  values (v_id, p_type, p_no, p_amount, v_delta, v_balance, case when p_type = 'opening' then 0 else v_delta end,
    (select id from profiles where login_id = 'teacher'), tests.noon(p_day));
  return v_id;
end $$;
-- A student opened at 8:00 on p_opened with an opening balance.
create function tests.old(p_no text, p_opening integer, p_opened date) returns void language plpgsql as $$
begin
  perform tests.student(p_no, 0);
  update students set opened_at = (p_opened + time '08:00') at time zone 'Asia/Shanghai' where student_no = p_no;
  perform tests.tx(p_no, 'opening', p_opening, p_opened);
end $$;
-- A call's result with its error detail as JSON.
create function tests.result(p jsonb) returns jsonb language sql as $$
  select case when p ? 'error' then p || jsonb_build_object('detail', (p ->> 'detail')::jsonb) else p end
$$;
-- manual_entry as the bank admin (or p_as).
create function tests.entry(p_no text, p_type text, p_at timestamptz, p_amount integer default null, p_payment text default null,
  p_den jsonb default null, p_items jsonb default null, p_id uuid default gen_random_uuid(), p_as text default 'teacher',
  p_reason text default '11月系统故障，柜台手写登记') returns jsonb language sql as $$
  select tests.result(tests.call((select id from profiles where login_id = p_as),
    format('select manual_entry(%L, %L, %L, %L, %L, %s, %L, %L, %L)', p_id, p_no, p_type, p_at, p_reason,
      coalesce(p_amount::text, 'null'), p_payment, p_den, p_items)))
$$;
create function tests.fix(p_orig uuid, p_new jsonb, p_reason text default '金额录错', p_id uuid default gen_random_uuid(),
  p_as text default 'teacher') returns jsonb language sql as $$
  select tests.result(tests.call((select id from profiles where login_id = p_as), format('select correct_txn(%L, %L, %L, %L)', p_id, p_orig, p_new, p_reason)))
$$;
-- What a student has in all, in 0.01 HTB: 活期 and the interest still to be paid.
create function tests.worth(p_no text) returns integer language sql as $$
  select 100 * balance + app_private.pending_interest(p_no) from accounts where student_no = p_no
$$;

-- The term from 20 days ago; the jobs from the day before; the students opened 25 days ago.
insert into terms (name, starts_on, ends_on) values ('本学期', :'today'::date - 20, :'today'::date + 40);
update job_runs set done_to = :'today'::date - 21, last_ok = null, last_err = null;
insert into products (id, name, price, listed, stock) values ('00000000-0000-4000-8000-000000000001', '笔记本', 6, true, 10),
  ('00000000-0000-4000-8000-000000000002', '旧款书签', 2, false, 5);
insert into stock_movements (product_id, kind, qty_delta, operator_id) select id, 'stock_in', stock, :'teacher' from products;
select tests.old(n, 100, :'today'::date - 25) from unnest(array['a', 'b', 'c', 'd', 'e', 'f', 'g']) n;

-- Who and what (§10.11).
select is(tests.entry('a', 'adjust', tests.noon(:'today'::date - 3), 5, p_as => w) ->> 'error', 'FORBIDDEN', 'the bank admin alone: not ' || w)
from unnest(array['p1', 't1', 'acc']) w;
select is(tests.entry('a', 'adjust', tests.noon(:'today'::date - 3), 5, p_reason => ' ') -> 'detail', '{"field":"reason"}', 'why is required');
select is(tests.entry('a', 'loan', tests.noon(:'today'::date - 3), 5) -> 'detail', '{"field":"type"}', 'four types only');
select is(tests.entry('a', 'adjust', tests.noon(:'today'::date - 3), 0) ->> 'error', 'INVALID_AMOUNT', '调账 is not 0');
select is(tests.entry('nobody', 'adjust', tests.noon(:'today'::date - 3), 5) ->> 'error', 'STUDENT_NOT_FOUND', 'a student who exists');
select is(tests.entry('a', 'adjust', null, 5) -> 'detail', '{"field":"occurred_at"}', 'when it happened is required');

-- The range: not after now, not before the term's start, nor before the account was opened.
select is(tests.entry('a', 'adjust', now() + interval '1 minute', 5) -> 'detail',
  jsonb_build_object('from', (:'today'::date - 20)::timestamp at time zone 'Asia/Shanghai', 'to', now()), 'not after now: the range is given');
select is(tests.entry('a', 'adjust', (:'today'::date - 20)::timestamp at time zone 'Asia/Shanghai' - interval '1 second', 5) ->> 'error',
  'OCCURRED_OUT_OF_RANGE', 'not before the term began');
select tests.student('late', 0);
update students set opened_at = tests.noon(:'today'::date - 2) where student_no = 'late';
select is(tests.entry('late', 'adjust', tests.noon(:'today'::date - 3), 5) -> 'detail' ->> 'from', to_jsonb(tests.noon(:'today'::date - 2)) #>> '{}',
  'nor before the account was opened');
savepoint no_term;
delete from terms;
select is(tests.entry('a', 'adjust', tests.noon(:'today'::date - 3), 5) ->> 'error', 'NO_TERM', 'no term begun yet: nothing to date it in');
rollback to savepoint no_term;

-- A term over (§10.11): it ended ten days ago and the jobs have run through it. A 补录 in it corrects its last days, all
-- paid; the corrections wait for the next 结息 (the next term's first Monday). In the holidays the range starts with the
-- term just over; once it is 结转, the day after it ended.
savepoint holidays;
update terms set starts_on = :'today'::date - 22, ends_on = :'today'::date - 10;
select is(app_private.run_jobs(:'today') -> 'failed', 'null', 'a term that ended ten days ago, run through');
select is(tests.entry('a', 'deposit', tests.noon(:'today'::date - 15), p_den => '{"10":5}') #>> '{interest,0,days}', '6',
  'a 补录 fifteen days ago corrects the term''s last six days');
select is((select count(*)::int from interest_adjustments j join interest_accruals i using (student_no, day) where i.settled_txn is null), 0,
  'all of them paid at the end of the term');
select is((select count(*)::int from interest_adjustments where settled_txn is null), 6, 'the corrections wait');
select is(app_private.run_jobs(:'today') -> 'ran', '[]', 'nothing pays them in the holidays');
select is(app_private.settle_interest(now()) > 0, true, 'the next 结息 does');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
select diag(jsonb_agg(c)::text) from app_private.check_balances() c;
select is(tests.entry('a', 'adjust', (:'today'::date - 22)::timestamp at time zone 'Asia/Shanghai' - interval '1 second', 5) #>> '{detail,from}',
  to_jsonb((:'today'::date - 22)::timestamp at time zone 'Asia/Shanghai') #>> '{}', 'in the holidays: from the start of the term just over');
update terms set closed_at = now();
select is(tests.entry('a', 'adjust', tests.noon(:'today'::date - 15), 5) #>> '{detail,from}',
  to_jsonb((:'today'::date - 9)::timestamp at time zone 'Asia/Shanghai') #>> '{}', 'once 结转, from the day after it ended');
select is(tests.entry('a', 'adjust', tests.noon(:'today'::date - 5), 5) -> 'interest', '[]', 'a day in the holidays: no interest to correct');
rollback to savepoint holidays;

-- Each type, dated when it happened and entered now (§10.11), before any day has been accrued.
savepoint types;
select tests.entry('a', 'deposit', tests.noon(:'today'::date - 10), p_den => '{"10":2,"5":1}', p_id => '00000000-0000-4000-8000-0000000000a1') as dep \gset
select is(array[(:'dep'::jsonb) ->> 'type', (:'dep'::jsonb) ->> 'amount', (:'dep'::jsonb) ->> 'balance_after', (:'dep'::jsonb) ->> 'reason'],
  array['deposit', '25', '125', '补录：11月系统故障，柜台手写登记'], '存款 of the notes received');
select is((select concat_ws(' ', created_at = tests.noon(:'today'::date - 10), entered_at = now(), cash_delta, denominations, operator_id = :'teacher',
    txn_no like 'HT' || to_char(:'today'::date - 10, 'YYMMDD') || '%', status)
  from txns where id = '00000000-0000-4000-8000-0000000000a1'), 't t 25 {"5": 1, "10": 2} t t normal',
  'dated when it happened (its number too), entered now by the bank admin, the cash received');
select is(tests.entry('a', 'deposit', tests.noon(:'today'::date - 10), p_den => '{"10":2,"5":1}', p_id => '00000000-0000-4000-8000-0000000000a1') ->> 'txn_no',
  (:'dep'::jsonb) ->> 'txn_no', 'sent again, the same result');
select is((select count(*)::int from txns where student_no = 'a'), 2, 'and no second entry');
select is(tests.entry('b', 'withdraw', tests.noon(:'today'::date - 10), 37) -> 'denominations', '{"2": 1, "5": 1, "10": 3}',
  '取款: the counter''s usual notes when none are given');
select is(tests.entry('b', 'withdraw', tests.noon(:'today'::date - 9), 10, p_den => '{"5":2}') -> 'denominations', '{"5": 2}', 'or the notes paid');
select is(tests.entry('b', 'withdraw', tests.noon(:'today'::date - 9), 10, p_den => '{"5":1}') ->> 'error', 'INVALID_AMOUNT', 'which add up to it');
select is(tests.entry('c', 'purchase', tests.noon(:'today'::date - 8), p_payment => 'account',
  p_items => '[{"product_id":"00000000-0000-4000-8000-000000000001","qty":2},{"product_id":"00000000-0000-4000-8000-000000000002","qty":1}]') ->> 'amount', '14',
  '兑换 from the account, at today''s prices, a product no longer listed too');
select is((select concat_ws(' ', t.balance_delta, t.cash_delta, a.total_spent, (select string_agg(stock::text, ',' order by id) from products),
    (select bool_and(m.created_at = tests.noon(:'today'::date - 8)) from stock_movements m where m.txn_id = t.id))
  from txns t join accounts a using (student_no) where t.student_no = 'c' and t.type = 'purchase'), '-14 0 14 8,4 t',
  'stock taken out, its movements dated with the 兑换');
select is(tests.entry('c', 'purchase', tests.noon(:'today'::date - 8), p_payment => 'cash', p_den => '{"10":1}',
  p_items => '[{"product_id":"00000000-0000-4000-8000-000000000001","qty":1}]') -> 'change_given', '{"2": 2}', '兑换 in cash, with change');
select is(tests.entry('c', 'purchase', tests.noon(:'today'::date - 8), p_payment => 'cash', p_den => '{"5":1}',
  p_items => '[{"product_id":"00000000-0000-4000-8000-000000000001","qty":1}]') ->> 'error', 'CASH_NOT_ENOUGH', 'as at the counter');
select is(tests.entry('c', 'purchase', tests.noon(:'today'::date - 8), p_payment => 'account',
  p_items => '[{"product_id":"00000000-0000-4000-8000-000000000002","qty":9}]') ->> 'error', 'OUT_OF_STOCK', 'only what is in stock');
select is(array[(tests.entry('d', 'adjust', tests.noon(:'today'::date - 7), -30) ->> 'balance_after'),
  (tests.entry('d', 'adjust', tests.noon(:'today'::date - 7), 12) ->> 'balance_after')], array['70', '82'], '调账 either way');
select is((select string_agg(concat_ws(' ', amount, balance_delta, cash_delta), ',' order by seq) from txns where student_no = 'd' and type = 'adjust'),
  '30 -30 0,12 12 0', 'its amount the size, no cash');
select is((select array[total_in, total_out, total_spent] from accounts where student_no = 'd'), array[100, 0, 0], 'and no 累计存入、取出');
select is(tests.entry('d', 'adjust', tests.noon(:'today'::date - 7), -83) -> 'detail', '{"short": 1, "balance": 82}', '活期 now stays 0 or more');
select is((select count(*)::int from audit_log where action = 'txn.manual'), 7, 'each entry logged');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
rollback to savepoint types;

-- 活期 since then never below 0 (§10.11): e had 100, took out 80 five days ago and put 100 back two days ago.
select tests.tx('e', 'withdraw', 80, :'today'::date - 5), tests.tx('e', 'deposit', 100, :'today'::date - 2);
select is(tests.entry('e', 'withdraw', tests.noon(:'today'::date - 10), 50) -> 'detail',
  jsonb_build_object('at', tests.noon(:'today'::date - 5), 'short', 30, 'balance', 20), 'a 取款 ten days ago would have left −30 five days ago');
select ok(tests.entry('e', 'withdraw', tests.noon(:'today'::date - 1), 50) ->> 'error' is null, 'yesterday it fits');

-- The cash (§10.11): in the bank's cash, in no teller's duty, even one going on when it happened.
update duty set started_at = tests.noon(:'today'::date - 1) - interval '1 hour' where user_id = :'teller';
select tests.entry('f', 'deposit', tests.noon(:'today'::date - 1), p_den => '{"10":1}') ->> 'txn_no' as f_dep \gset
select is((select app_private.duty_cash(d) #>> '{income,total}' from duty d where user_id = :'teller'), '0', 'nothing in the teller''s 收入');
select is((select cash_delta from txns where txn_no = :'f_dep'), 10, 'the bank''s cash takes it');

-- 当初就记对 against 补录 later (§9.3, §10.11). In both, a deposits 50 and b takes out 30 fifteen days ago, c is
-- adjusted −20 and f buys 3 notebooks fifteen days ago; g deposits 40 on the last day accrued, after the last 结息. On
-- time, every entry is made before the jobs run; later, the jobs run first. Meanwhile run_jobs catches up to x.
create function tests.d1_entries() returns void language sql as $$
  select tests.entry('a', 'deposit', tests.noon(app_private.cn_date(now()) - 15), p_den => '{"10":5}');
  select tests.entry('b', 'withdraw', tests.noon(app_private.cn_date(now()) - 15), 30);
  select tests.entry('c', 'adjust', tests.noon(app_private.cn_date(now()) - 15), -20);
  select tests.entry('f', 'purchase', tests.noon(app_private.cn_date(now()) - 15), p_payment => 'account',
    p_items => '[{"product_id":"00000000-0000-4000-8000-000000000001","qty":3}]');
$$;
create function tests.state() returns jsonb language sql as $$
  select jsonb_object_agg(student_no, jsonb_build_object('worth', tests.worth(student_no), 'in', total_in, 'out', total_out, 'spent', total_spent))
  from accounts where student_no in ('a', 'b', 'c', 'd', 'f', 'g')
$$;
savepoint on_time;
select tests.d1_entries();
select tests.entry('d', 'deposit', tests.noon(:'today'::date - 5), p_den => '{"10":3}');
select tests.entry('g', 'deposit', tests.noon(:'x'::date - 1), p_den => '{"10":4}');
select is(app_private.run_jobs(:'x') -> 'failed', 'null', 'on time: the jobs after every entry');
select is(count(*)::int, 0, 'no correction, none needed') from interest_adjustments;
select tests.state() as on_time \gset
rollback to savepoint on_time;

select is(app_private.run_jobs(:'today'::date - 8) -> 'failed', 'null', 'later: the jobs to nine days ago');
select is(tests.entry('d', 'deposit', tests.noon(:'today'::date - 5), p_den => '{"10":3}') -> 'interest', '[]',
  'd five days ago: nothing accrued since, nothing corrected');
select is(app_private.run_jobs(:'x') -> 'failed', 'null', 'the jobs on to x');
select tests.d1_entries();
select is(tests.entry('g', 'deposit', tests.noon(:'x'::date - 1), p_den => '{"10":4}') -> 'interest' -> 0 -> 'days', '1', 'g: one day accrued since');

select is(count(*)::int, 0, 'every day accrued since an entry has its interest on 活期 at its end now')
from interest_accruals i where floor(app_private.balance_on(i.student_no, i.day) * i.rate / 7)
  <> i.centi + coalesce((select sum(centi) from interest_adjustments j where j.student_no = i.student_no and j.day = i.day), 0);
select is((select concat_ws(' ', j.balance - i.balance, j.centi = floor(j.balance * 2.08 / 7) - floor(i.balance * 2.08 / 7))
  from interest_adjustments j join interest_accruals i using (student_no, day) where j.student_no = 'a' order by day limit 1), '50 t',
  'a''s first day: ⌊(B + 50) × 2.08 ÷ 7⌋ − ⌊B × 2.08 ÷ 7⌋, about 0.15 HTB');
select ok(exists (select 1 from interest_adjustments j join interest_accruals i using (student_no, day) where j.student_no = 'a' and i.settled_txn is not null)
  and exists (select 1 from interest_adjustments j join interest_accruals i using (student_no, day) where j.student_no = 'a' and i.settled_txn is null),
  'weeks paid and a week not yet paid both corrected');
select is((select count(*)::int from interest_adjustments where settled_txn is not null), 0, 'all of it waiting for the next 结息');
select ok((select bool_and(centi < 0) from interest_adjustments where student_no in ('b', 'c', 'f')), 'less for what was taken out');
select is(app_private.pending_interest('a'), (select interest_carry from accounts where student_no = 'a')
  + (select sum(centi) from interest_accruals where student_no = 'a' and settled_txn is null)::int
  + (select sum(centi) from interest_adjustments where student_no = 'a')::int, '待入账利息 has them');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
select is(tests.state() - array['a', 'b', 'c', 'f'], :'on_time'::jsonb - array['a', 'b', 'c', 'f'],
  'd (entered before its days were accrued) and g (after the last 结息) have exactly what on time gives');
select is(count(*)::int, 0, 'a, b, c and f: what was paid in whole HTB in between earns nothing more, at most 0.01 HTB a day')
from jsonb_each(:'on_time'::jsonb) o, jsonb_each(tests.state()) l
where o.key = l.key and o.key in ('a', 'b', 'c', 'f')
  and (o.value - 'worth' <> l.value - 'worth' or abs((o.value ->> 'worth')::int - (l.value ->> 'worth')::int) > 15);
savepoint settle;
select is(app_private.settle_interest(now()) > 0, true, 'the next 结息');
select ok((select reason from txns where student_no = 'a' and type = 'interest' order by seq desc limit 1) ~ '活期利息，含更正 \+[0-9]+\.[0-9]{2} HTB$',
  'says what the corrections came to');
select is((select count(*)::int from interest_adjustments where settled_txn is null and student_no in ('a', 'g')), 0, 'and pays them');
select is(count(*)::int, 0, 'the ledger checks out, the corrections paid counted') from app_private.check_balances();
rollback to savepoint settle;

-- 编辑 (§10.11): the teller's 存款 of 20 on day −6 was 30 in fact.
select tests.tx('a', 'deposit', 20, :'today'::date - 6) as orig \gset
select tests.fix(:'orig', '{"denominations":{"10":3}}', p_id => '00000000-0000-4000-8000-0000000000c1') as fixed \gset
select is((:'fixed'::jsonb) #>> '{txn,amount}', '30', 'the corrected 存款');
select is((select concat_ws(' ', o.status, r.type, r.amount, r.created_at = o.created_at, r.entered_at is not null, r.reason, n.corrects = o.id,
    n.created_at = o.created_at, n.reason)
  from txns o join txns r on r.reversal_of = o.id join txns n on n.corrects = o.id where o.id = :'orig'),
  'reversed reversal 20 t t 金额录错 t t 更正：金额录错',
  'the original reversed and entered again, both dated as it was, the entry pointing at it');
select is(tests.fix(:'orig', '{"denominations":{"10":3}}', p_id => '00000000-0000-4000-8000-0000000000c1') #>> '{txn,txn_no}',
  (:'fixed'::jsonb) #>> '{txn,txn_no}', 'sent again, the same result');
select is(tests.fix(:'orig', '{"denominations":{"10":3}}') ->> 'error', 'REVERSAL_NOT_ALLOWED', 'an original already corrected');
select is(count(*)::int, 0, 'its interest corrected too') from interest_accruals i
where i.student_no = 'a' and floor(app_private.balance_on(i.student_no, i.day) * i.rate / 7)
  <> i.centi + coalesce((select sum(centi) from interest_adjustments j where j.student_no = i.student_no and j.day = i.day), 0);
select is((select string_agg(concat_ws(' ', r ->> 'txn_no', coalesce(r ->> 'corrects_no', '-'), coalesce(r ->> 'corrected_no', '-'), r ->> 'entered_at' is not null), ', ')
  from jsonb_array_elements(tests.call(:'teller', 'select student_txns(''a'', null, 50)')) r where r ->> 'txn_no' in
    (select txn_no from txns where id = :'orig' or reversal_of = :'orig' or corrects = :'orig')),
  (select string_agg(concat_ws(' ', t.txn_no, coalesce((select o.txn_no from txns o where o.id = t.corrects), '-'),
      coalesce((select n.txn_no from txns n where n.corrects = t.id), '-'), t.entered_at is not null), ', ' order by t.seq desc)
   from txns t where t.id = :'orig' or t.reversal_of = :'orig' or t.corrects = :'orig'),
  '柜台查询 shows 更正自、已更正为 and 补录');

-- 柜台查询 in the order things happened (§10.11): newest first by the time they are dated, page by page with p_before
-- the seq of the last row before, none twice and none missed, the 补录 among the days they belong to.
create function tests.pages(p_no text, p_limit integer) returns text[] language plpgsql as $$
declare
  v_page jsonb;
  v_before bigint;
  v_all text[] := '{}';
begin
  loop
    v_page := tests.call((select id from profiles where login_id = 't1'),
      format('select student_txns(%L, %s, %s)', p_no, coalesce(v_before::text, 'null'), p_limit));
    exit when jsonb_array_length(v_page) = 0;
    v_all := v_all || array(select e ->> 'txn_no' from jsonb_array_elements(v_page) e);
    v_before := (v_page -> -1 ->> 'seq')::bigint;
  end loop;
  return v_all;
end $$;
select is(tests.pages('a', 3), array(select txn_no from txns where student_no = 'a' order by created_at desc, seq desc),
  'a''s 柜台查询 three at a time: every transaction once, in the order they happened');
select ok((select bool_or(e.seq > l.seq) from txns e join txns l using (student_no) where e.student_no = 'a' and e.entered_at is not null
  and l.entered_at is null and l.created_at > e.created_at), 'though a 补录 was written after later ones');
select is(tests.call(:'teller', format('select student_txns(''a'', %s, 3)', (select min(seq) from txns where student_no = 'b'))) ->> 'error',
  'INVALID_INPUT', 'p_before is one of the student''s');

-- Into another student and another type: b's 补录 存款 of 10 on day −4 was c's 取款 of 10.
select tests.entry('b', 'deposit', tests.noon(:'today'::date - 4), p_den => '{"10":1}') ->> 'id' as orig2 \gset
select is(tests.fix(:'orig2', '{"student_no":"c","type":"withdraw","amount":10}', '学号录错') #>> '{txn,student_no}', 'c', 'another student');
select is((select concat_ws(' ', o.student_no, o.status, n.student_no, n.type, n.amount) from txns o join txns n on n.corrects = o.id where o.id = :'orig2'),
  'b reversed c withdraw 10', 'b''s taken out, c''s entered');
select is((select count(distinct student_no)::int from interest_adjustments where txn_id = (select id from txns where corrects = :'orig2')), 2,
  'the interest of both corrected');

-- What cannot be edited.
select is(tests.fix(id, '{"amount":1}') ->> 'error', 'REVERSAL_NOT_ALLOWED', 'not a ' || type) from (
  select distinct on (type) id, type from txns where type in ('interest', 'opening', 'reversal') order by type, seq) t;
select is(tests.fix(:'orig2', '{}', '随便') -> 'detail', '{"field":"reason"}', 'the reason one of 冲正''s');
select is(tests.fix(gen_random_uuid(), '{}') ->> 'error', 'TXN_NOT_FOUND', 'an original that exists');
select is(tests.fix(:'orig2', '{}', p_as => 'p1') ->> 'error', 'FORBIDDEN', 'the bank admin alone');
select tests.tx('g', 'deposit', 5, :'today'::date - 22) as before_term \gset
select is(tests.fix(:'before_term', '{"denominations":{"5":2}}') ->> 'error', 'OCCURRED_OUT_OF_RANGE', 'nor one from before the term');
select is(tests.fix((select id from txns where student_no = 'e' and type = 'withdraw' and entered_at is null), '{"amount":110}') #>> '{detail,at}',
  to_jsonb(tests.noon(:'today'::date - 5)) #>> '{}', 'and 活期 since then never below 0: e''s 取款 of 80 five days ago was not 110');

-- 冲正 of a 调账 (§10.9): the president and bank admin, dated now.
select tests.entry('d', 'adjust', tests.noon(:'today'::date - 3), 7) ->> 'id' as adj \gset
select is(tests.call(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'adj')) ->> 'error', 'REVERSAL_NOT_ALLOWED', 'not the teller');
select is(tests.call(:'president', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', :'adj')) ->> 'amount', '7', 'the president');

-- 报表 (§10.11): 期初、期末 by the transactions dated before them, wherever an entry falls in the order written.
select is((tests.call(:'accountant', format('select bank_report(%L, %L, p_student_no => ''a'')', :'today'::date - 15, :'today'::date - 15)) -> 'balance') - 'changes',
  jsonb_build_object('opening', app_private.balance_on('a', :'today'::date - 16), 'closing', app_private.balance_on('a', :'today'::date - 15)),
  'a''s 补录 fifteen days ago counts on that day');
select is(tests.call(:'accountant', format('select bank_report(%L, %L)', :'today'::date - 20, :'today')) -> 'adjust',
  (select jsonb_build_object('count', count(*), 'amount', sum(balance_delta)) from txns where type = 'adjust' and status = 'normal'), '调账 listed');

select is(count(*)::int, 0, 'the ledger checks out after it all') from app_private.check_balances();
select is((select count(*)::int from audit_log where action = 'txn.correct'), 2, 'each 更正 logged');

select * from finish();
rollback;
