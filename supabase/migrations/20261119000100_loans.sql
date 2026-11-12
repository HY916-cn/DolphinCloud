-- 贷款 (PHASE-2.md §8.2, §10.3–10.9, §13, §14, §15): the counter pays a loan out at the rate locked that week, into the
-- account or in cash, to be paid back in weekly periods of equal principal or all at once, by the term's last day.
-- Interest accrues at the end of each day on the principal left, the overdue part at the penalty rate. A repayment pays the
-- interest's whole HTB first, then the principal; paying more spreads what is left over the periods after. On each day a
-- period falls due run_daily takes what it can from 活期 and marks the rest 逾期, and takes from 活期 each day after until
-- it is paid. The president and bank admin may terminate a loan: all of it falls due that day. 贷款剩余本金 counts in the
-- anchor's 存贷比.

create sequence public.loans_no_seq;

create table public.loans (
  id               uuid primary key,          -- 客户端生成，作幂等键
  loan_no          text unique not null,      -- DK + YYMMDD + 序号
  student_no       text not null references public.students(student_no),
  principal        integer not null check (principal > 0),
  remaining        integer not null check (remaining >= 0), -- 剩余本金
  rate             numeric(8,4) not null,     -- 锁定的周利率（百分数）
  score            integer not null,          -- 放款时的信用分
  plan             text not null check (plan in ('installment', 'bullet')),
  periods          integer not null check (periods between 1 and 8), -- 分期的期数，一次还清的周数
  purpose          text not null,
  disbursed_via    text not null check (disbursed_via in ('account', 'cash')),
  interest_centi   integer not null default 0, -- 已产生未付的利息（0.01 HTB）
  status           text not null default 'active' check (status in ('active', 'overdue', 'closed', 'reversed')),
  loan_txn         uuid not null references public.txns(id) deferrable initially deferred, -- written just before its loan
  opened_on        date not null,
  closed_on        date,
  terminated_at    timestamptz,
  terminated_by    uuid references public.profiles(id),
  terminate_reason text,
  operator_id      uuid not null references public.profiles(id)
);
create unique index loans_one_open on public.loans (student_no) where status in ('active', 'overdue');
create index on public.loans (student_no);
-- The daily interest alone is not logged.
create trigger audit after insert or update or delete on public.loans for each row execute function app_private.audit_row('interest_centi');

create table public.loan_periods (            -- 还款计划
  loan_id    uuid not null references public.loans(id),
  seq        integer not null,
  due_on     date not null,
  principal  integer not null check (principal >= 0), -- 应还本金
  paid       integer not null default 0 check (paid between 0 and principal), -- 已还本金
  overdue_at timestamptz,
  primary key (loan_id, seq)
);
create trigger audit after insert or update or delete on public.loan_periods for each row execute function app_private.audit_row();

create table public.loan_payments (           -- 每笔还款的拆分
  txn_id    uuid primary key references public.txns(id),
  loan_id   uuid not null references public.loans(id),
  interest  integer not null,
  principal integer not null,
  auto      boolean not null default false,   -- 系统自动扣款
  before    jsonb not null                    -- 还款前的利息与计划，冲正时恢复：{"interest_centi","periods":[{"seq","principal","paid"}]}
);
create index on public.loan_payments (loan_id);
create trigger append_only before update or delete on public.loan_payments for each row execute function app_private.append_only();

alter table public.txns add column loan_id uuid references public.loans(id);
create index on public.txns (loan_id) where loan_id is not null;

alter table public.loans enable row level security;
alter table public.loan_periods enable row level security;
alter table public.loan_payments enable row level security;
grant select on public.loans, public.loan_periods, public.loan_payments to authenticated;
-- A student reads their own; the accountant, president and bank admin everyone's (§3). The counter reads a student's
-- through loan_quote.
create policy read on public.loans for select to authenticated using (
  student_no = (select app_private.my_student_no())
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));
create policy read on public.loan_periods for select to authenticated using (exists (select 1 from public.loans l where l.id = loan_id));
create policy read on public.loan_payments for select to authenticated using (exists (select 1 from public.loans l where l.id = loan_id));

-- 贷款剩余本金 at a time, of everyone (§9.1) or of one student (§8.2), from the transactions dated before it: a loan adds
-- its principal, a repayment takes its principal part away, and a reversal undoes the one it reverses. Two functions, so
-- the one student's can use the index on student_no.
create function app_private.loans_on(p_at timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when coalesce(o.type, t.type) = 'loan' then t.amount else -p.principal end
                      * case when t.type = 'reversal' then -1 else 1 end), 0)::integer
  from public.txns t left join public.txns o on o.id = t.reversal_of left join public.loan_payments p on p.txn_id = coalesce(o.id, t.id)
  where t.loan_id is not null and t.created_at < p_at
$$;
create function app_private.loans_on(p_at timestamptz, p_student_no text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(case when coalesce(o.type, t.type) = 'loan' then t.amount else -p.principal end
                      * case when t.type = 'reversal' then -1 else 1 end), 0)::integer
  from public.txns t left join public.txns o on o.id = t.reversal_of left join public.loan_payments p on p.txn_id = coalesce(o.id, t.id)
  where t.student_no = p_student_no and t.loan_id is not null and t.created_at < p_at
$$;

-- What a loan asks for by p_day (§10.4): the interest's whole HTB and the principal still unpaid of the periods due by
-- then; when that is all the principal left, the interest rounded up.
create function app_private.loan_due(p_loan public.loans, p_day date) returns integer
language sql stable security definer set search_path = '' as $$
  select case when d = p_loan.remaining then p_loan.remaining + ceil(p_loan.interest_centi / 100.0)::integer
              else d + p_loan.interest_centi / 100 end
  from (select coalesce(sum(principal - paid), 0)::integer as d from public.loan_periods where loan_id = p_loan.id and due_on <= p_day) x
$$;

-- The amount p_amount comes to as a repayment: itself, or 1 HTB less when it would pay off the principal at the interest's
-- whole HTB but not its 零头 (paying the principal off takes the interest rounded up, §10.4).
create function app_private.loan_take(p_loan public.loans, p_amount integer) returns integer
language sql immutable as $$
  select case when p_amount = p_loan.remaining + p_loan.interest_centi / 100 and p_loan.interest_centi % 100 > 0 then p_amount - 1
              else p_amount end
$$;

-- A loan with its plan and repayments: the loans row, payoff (all it takes to pay it off now), next (the first period
-- unpaid: {"seq","due_on","amount"}, amount what loan_due asks by its day), schedule (loan_periods rows) and payments
-- (each repayment: {"txn_id","txn_no","created_at","amount","interest","principal","auto","payment","status"}).
create function app_private.loan_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(l) || jsonb_build_object(
    'payoff', case when l.status in ('active', 'overdue') then l.remaining + ceil(l.interest_centi / 100.0)::integer end,
    'next', (select jsonb_build_object('seq', p.seq, 'due_on', p.due_on, 'amount', app_private.loan_due(l, p.due_on))
             from public.loan_periods p where p.loan_id = l.id and p.paid < p.principal and l.status in ('active', 'overdue')
             order by p.seq limit 1),
    'schedule', (select jsonb_agg(to_jsonb(p) - 'loan_id' order by p.seq) from public.loan_periods p where p.loan_id = l.id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('txn_id', t.id, 'txn_no', t.txn_no, 'created_at', t.created_at,
        'amount', t.amount, 'interest', p.interest, 'principal', p.principal, 'auto', p.auto, 'payment', t.payment, 'status', t.status)
        order by t.seq), '[]')
      from public.loan_payments p join public.txns t on t.id = p.txn_id where p.loan_id = l.id))
  from public.loans l where l.id = p_id
$$;

create function app_private.loan_result(p_loan_id uuid, p_txn uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.txn_result(t) || jsonb_build_object('loan', app_private.loan_json(p_loan_id)) from public.txns t where t.id = p_txn
$$;

-- Periods due by p_day still unpaid become 逾期 at p_at (§10.7): the loan shows red and loses the overdue points once for
-- the day, named after the first of them (§8.2).
create function app_private.mark_overdue(p_loan_id uuid, p_day date, p_at timestamptz) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_seq integer;
  v_loan public.loans;
begin
  with x as (
    update public.loan_periods set overdue_at = p_at
    where loan_id = p_loan_id and paid < principal and due_on <= p_day and overdue_at is null returning seq
  ) select min(seq) into v_seq from x;
  if v_seq is not null then
    update public.loans set status = 'overdue' where id = p_loan_id returning * into v_loan;
    perform app_private.credit_change(v_loan.student_no, null, 'overdue', '贷款 ' || v_loan.loan_no || ' 第 ' || v_seq || ' 期逾期',
      'loans:' || p_loan_id || ':' || v_seq, null, p_at);
    -- M13 风险提醒 loan_overdue（对象 loans:<id>；「终止」提前到期）
  end if;
end
$$;

-- A repayment (§10.4, §10.5) of p_amount on p_day, dated p_at, from the account or in cash: the interest's whole HTB first,
-- the rest to the principal; the one that pays off the principal pays the interest rounded up (the callers pass amounts
-- loan_take keeps). The principal fills the periods due by p_day in order, then the one coming next; what is left over
-- comes off the periods after it, spread over them again. Each period paid in full by its day earns repay_on_time, and a
-- loan paid off before its last day and 7 days or more after it was paid out, never overdue, repay_early (§8.2); a
-- terminated loan earns neither. p_note starts the reason. Returns the repay transaction.
create function app_private.pay_loan(p_loan_id uuid, p_txn_id uuid, p_amount integer, p_via text, p_denominations jsonb,
  p_operator uuid, p_at timestamptz, p_day date, p_auto boolean, p_note text) returns public.txns
language plpgsql security definer set search_path = '' as $$
declare
  v_loan public.loans;
  v_account public.accounts;
  v_closing boolean;
  v_interest integer;
  v_principal integer;
  v_before jsonb;
  v_left integer;
  v_fill integer;
  v_n integer;
  v_total integer;
  v_last integer;
  v_txn public.txns;
  p record;
begin
  select * into v_account from public.accounts where student_no = (select student_no from public.loans where id = p_loan_id) for update;
  select * into v_loan from public.loans where id = p_loan_id for update;
  v_closing := p_amount = v_loan.remaining + ceil(v_loan.interest_centi / 100.0);
  v_interest := case when v_closing then ceil(v_loan.interest_centi / 100.0)::integer else least(p_amount, v_loan.interest_centi / 100) end;
  v_principal := p_amount - v_interest;
  v_before := jsonb_build_object('interest_centi', v_loan.interest_centi, 'periods',
    (select jsonb_agg(jsonb_build_object('seq', seq, 'principal', principal, 'paid', paid) order by seq)
     from public.loan_periods where loan_id = p_loan_id));
  v_left := v_principal;
  for p in select * from public.loan_periods where loan_id = p_loan_id and paid < principal order by seq for update loop
    exit when v_left = 0;
    v_fill := least(v_left, p.principal - p.paid);
    update public.loan_periods set paid = paid + v_fill where loan_id = p_loan_id and seq = p.seq;
    v_left := v_left - v_fill;
    if v_fill = p.principal - p.paid and p_day <= p.due_on and v_loan.terminated_at is null then
      perform app_private.credit_change(v_loan.student_no, null, 'repay_on_time',
        '按时还清贷款 ' || v_loan.loan_no || ' 第 ' || p.seq || ' 期', 'loans:' || p_loan_id || ':' || p.seq, null, p_at);
    end if;
    if v_left > 0 and p.due_on > p_day and not v_closing then
      -- 多还: off the periods after this one, the principal they still ask for spread over them again
      select count(*), sum(principal) - v_left, max(seq) into v_n, v_total, v_last
      from public.loan_periods where loan_id = p_loan_id and seq > p.seq;
      update public.loan_periods set principal = v_total / v_n + case when seq = v_last then v_total % v_n else 0 end
      where loan_id = p_loan_id and seq > p.seq;
      v_left := 0;
    end if;
  end loop;

  update public.loans set remaining = remaining - v_principal,
    interest_centi = case when v_closing then 0 else interest_centi - 100 * v_interest end,
    status = case when v_closing then 'closed'
      when exists (select 1 from public.loan_periods where loan_id = p_loan_id and paid < principal and overdue_at is not null) then 'overdue'
      else 'active' end,
    closed_on = case when v_closing then p_day end
  where id = p_loan_id returning * into v_loan;
  update public.accounts set balance = balance - case when p_via = 'account' then p_amount else 0 end, updated_at = now()
  where student_no = v_loan.student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment, denominations, reason,
    operator_id, device_id, loan_id, created_at)
  values (coalesce(p_txn_id, gen_random_uuid()), 'repay', v_loan.student_no, p_amount,
    case when p_via = 'account' then -p_amount else 0 end, v_account.balance, case when p_via = 'cash' then p_amount else 0 end,
    p_via, p_denominations, coalesce(p_note || '，', '') || '利息 ' || v_interest || ' HTB，本金 ' || v_principal || ' HTB',
    p_operator, app_private.request_header('x-device-id'), p_loan_id, p_at)
  returning * into v_txn;
  insert into public.loan_payments (txn_id, loan_id, interest, principal, auto, before)
  values (v_txn.id, p_loan_id, v_interest, v_principal, p_auto, v_before);

  if v_closing and v_loan.terminated_at is null and p_day >= v_loan.opened_on + 7
     and p_day < (select max(due_on) from public.loan_periods where loan_id = p_loan_id)
     and not exists (select 1 from public.loan_periods where loan_id = p_loan_id and overdue_at is not null) then
    perform app_private.credit_change(v_loan.student_no, null, 'repay_early', '提前还清贷款 ' || v_loan.loan_no,
      'loans:' || p_loan_id, null, p_at);
  end if;
  return v_txn;
end
$$;

-- 自动扣款 at the end of p_day (§10.6, §10.7), dated the next midnight, by the system login: every loan with a period due
-- by then still unpaid takes what 活期 has towards what is due, and what stays unpaid becomes 逾期. On the term's last
-- day (p_last) a loan still running past it (its term shortened) falls due in full. 活期 counts what stands by the next
-- midnight, so a catch-up takes what an on-time run would have.
create function app_private.collect_loans(p_day date, p_last boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := (p_day + 1)::timestamp at time zone 'Asia/Shanghai';
  v_loan public.loans;
  v_amount integer;
  v_n integer := 0;
  r record;
begin
  if p_last then
    update public.loan_periods p set due_on = p_day from public.loans l
    where l.id = p.loan_id and l.status in ('active', 'overdue') and p.paid < p.principal and p.due_on > p_day;
  end if;
  for r in
    -- 活期 as it stands at v_at (with the 定期 matured that night), no more than it is now
    select l.id, least(a.balance, (select coalesce(sum(t.balance_delta), 0) from public.txns t
      where t.student_no = l.student_no and t.created_at <= v_at))::integer as balance
    from public.loans l join public.accounts a using (student_no)
    where l.status in ('active', 'overdue')
      and exists (select 1 from public.loan_periods p where p.loan_id = l.id and p.due_on <= p_day and p.paid < p.principal)
    order by l.student_no, l.id
  loop
    select * into v_loan from public.loans where id = r.id;
    v_amount := app_private.loan_take(v_loan, least(app_private.loan_due(v_loan, p_day), greatest(r.balance, 0)));
    if v_amount > 0 then
      perform app_private.pay_loan(r.id, null, v_amount, 'account', null, app_private.system_user(), v_at, p_day, true, '自动扣款');
      v_n := v_n + 1;
    end if;
    perform app_private.mark_overdue(r.id, p_day, v_at);
  end loop;
  return v_n;
end
$$;

-- 贷款计息 for p_day (§10.4), after the day's repayments: the principal left × the locked weekly rate ÷ 7, the part of
-- periods due before the day at the penalty rate, to 0.01 HTB, from the day the loan was paid out.
create function app_private.accrue_loans(p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  update public.loans l set interest_centi = l.interest_centi + x.centi
  from (select l.id, floor((coalesce(sum(p.principal - p.paid) filter (where p.due_on >= p_day), 0) * l.rate
          + coalesce(sum(p.principal - p.paid) filter (where p.due_on < p_day), 0) * app_private.penalty_rate(l.rate)) / 7)::integer as centi
        from public.loans l join public.loan_periods p on p.loan_id = l.id
        where l.status in ('active', 'overdue') and l.opened_on <= p_day
        group by l.id, l.rate) x
  where l.id = x.id and x.centi > 0;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- 逾期满一周 (§8.2) on Monday p_week: each loan overdue at least 7 whole days by then loses the weekly points, dated the
-- Monday's midnight.
create function app_private.overdue_weekly(p_week date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  r record;
begin
  for r in
    select l.id, l.student_no, l.loan_no, min(p.due_on) as since
    from public.loans l join public.loan_periods p on p.loan_id = l.id
    where l.status = 'overdue' and p.overdue_at is not null and p.paid < p.principal
    group by l.id having min(p.due_on) <= p_week - 8
    order by l.student_no, l.id
  loop
    v_n := v_n + (app_private.credit_change(r.student_no, null, 'overdue_week',
      '贷款 ' || r.loan_no || ' 逾期满 ' || (p_week - 1 - r.since) / 7 || ' 周', 'loans:' || r.id || ':' || p_week, null,
      p_week::timestamp at time zone 'Asia/Shanghai') is not null)::integer;
  end loop;
  return v_n;
end
$$;

-- The plan of a loan paid out on p_day at p_rate (§10.4) with each period's interest when every period is paid on its
-- day: interest_centi accrues over the days up to it at the principal left, to 0.01 HTB a day; interest is the whole HTB
-- paid with it, the 零头 carried, the last one rounded up, as run_daily would collect it.
-- [{"seq","due_on","principal","interest_centi","interest"}]
create function app_private.loan_estimate(p_amount integer, p_plan text, p_periods integer, p_rate numeric, p_day date)
returns jsonb language plpgsql immutable as $$
declare
  v_n integer := case when p_plan = 'installment' then p_periods else 1 end;
  v_left integer := p_amount;
  v_centi integer := 0;
  v_accrued integer;
  v_principal integer;
  v_interest integer;
  v_out jsonb := '[]';
begin
  for k in 1 .. v_n loop
    v_principal := case when p_plan = 'installment' then p_amount / p_periods + case when k = v_n then p_amount % p_periods else 0 end
                        else p_amount end;
    v_accrued := (case when p_plan = 'installment' then 7 else 7 * p_periods end) * floor(v_left * p_rate / 7)::integer;
    v_centi := v_centi + v_accrued;
    v_interest := case when k = v_n then ceil(v_centi / 100.0)::integer else v_centi / 100 end;
    v_centi := v_centi - 100 * v_interest;
    v_left := v_left - v_principal;
    v_out := v_out || jsonb_build_object('seq', k, 'due_on', p_day + 7 * case when p_plan = 'installment' then k else p_periods end,
      'principal', v_principal, 'interest_centi', v_accrued, 'interest', v_interest);
  end loop;
  return v_out;
end
$$;

-- The checks the counter's loan functions make of the student (as term_quote): found, not closed, not the teller's own.
create function app_private.loan_student(p_student_no text, p_me uuid) returns public.students
language plpgsql stable security definer set search_path = '' as $$
declare
  v_student public.students;
begin
  select * into v_student from public.students where student_no = p_student_no;
  if not found then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  if v_student.status = 'closed' then
    perform app_private.fail('STUDENT_INACTIVE', '{"status":"closed"}');
  end if;
  if v_student.user_id = p_me or exists (select 1 from public.staff_payroll where user_id = p_me and account = p_student_no) then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  return v_student;
end
$$;

-- The counter's 贷款 panel (§10.3, §16.1): the student's score, 额度 (limit, null below the lowest score), this week's
-- loan rate and its penalty rate, the most weeks (max_weeks, max_periods: the same, null when none fit) a loan opened
-- today may run before the term's last day, 活期, why a new loan cannot be opened (blocked: STUDENT_INACTIVE, NO_TERM,
-- LOAN_OUTSTANDING or CREDIT_TOO_LOW, else null) and the loan not paid off (loan: loan_json, or null).
create function public.loan_quote(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
  v_term public.terms := app_private.current_term(v_today);
  v_student public.students := app_private.loan_student(p_student_no, v_me);
  v_score integer := (select score from public.credit_scores where student_no = p_student_no);
  v_rate numeric := app_private.loan_rate(app_private.anchor_on(v_today), v_score);
  v_open uuid := (select id from public.loans where student_no = p_student_no and status in ('active', 'overdue'));
  v_max integer := nullif(least(8, coalesce((v_term.ends_on - v_today) / 7, 0)), 0);
begin
  return (select jsonb_build_object('student_no', p_student_no, 'score', v_score, 'limit', app_private.credit_limit(v_score),
      'rate', v_rate, 'penalty_rate', app_private.penalty_rate(v_rate), 'max_weeks', v_max, 'max_periods', v_max,
      'term', case when v_term.id is not null then jsonb_build_object('id', v_term.id, 'name', v_term.name, 'ends_on', v_term.ends_on) end,
      'balance', a.balance,
      'blocked', case when v_student.status <> 'normal' then 'STUDENT_INACTIVE' when v_term.id is null then 'NO_TERM'
        when v_open is not null then 'LOAN_OUTSTANDING' when v_rate is null then 'CREDIT_TOO_LOW' end,
      'loan', app_private.loan_json(v_open))
    from public.accounts a where a.student_no = p_student_no);
end
$$;

-- The counter's confirmation of a new loan (§16.1): the rate it would lock today and its plan with each period's
-- estimated interest (loan_estimate), and in all: interest (HTB) and interest_centi. The limit, the term and the rest are open_loan's to check.
create function public.loan_preview(p_student_no text, p_amount integer, p_plan text, p_periods integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
  v_rate numeric;
  v_plan jsonb;
begin
  perform app_private.loan_student(p_student_no, v_me);
  if p_plan is null or p_plan not in ('installment', 'bullet') then
    perform app_private.fail('INVALID_INPUT', '{"field":"plan"}');
  end if;
  if p_periods is null or p_periods not between 1 and 8 then
    perform app_private.fail('INVALID_INPUT', '{"field":"periods"}');
  end if;
  if p_amount is null or p_amount <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  v_rate := app_private.loan_rate(app_private.anchor_on(v_today), (select score from public.credit_scores where student_no = p_student_no));
  if v_rate is null then
    perform app_private.fail('CREDIT_TOO_LOW', jsonb_build_object('score', (select score from public.credit_scores where student_no = p_student_no),
      'min_score', (app_private.setting('credit_curve') ->> 'min_score')::integer));
  end if;
  v_plan := app_private.loan_estimate(p_amount, p_plan, p_periods, v_rate, v_today);
  return jsonb_build_object('rate', v_rate, 'penalty_rate', app_private.penalty_rate(v_rate), 'schedule', v_plan,
    'interest', (select sum((e ->> 'interest')::integer) from jsonb_array_elements(v_plan) e),
    'interest_centi', (select sum((e ->> 'interest_centi')::integer) from jsonb_array_elements(v_plan) e));
end
$$;

-- Pays a loan out at p_at (§10.3, §10.4): the rate of its week's anchor and the student's score now, its periods of equal
-- principal (the last one the rest) due each 7 days after, or one due p_periods weeks after. The callers have checked the
-- account, the amount and the length. The loan transaction says the plan and the purpose: 「分 4 期，用途：买文具」,
-- 「一次还清 4 周，用途：买文具」.
create function app_private.start_loan(p_id uuid, p_student_no text, p_amount integer, p_purpose text, p_plan text,
  p_periods integer, p_via text, p_operator uuid, p_at timestamptz) returns public.loans
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := app_private.cn_date(p_at);
  v_due date := app_private.cn_date(p_at) + 7 * p_periods;
  v_score integer := (select score from public.credit_scores where student_no = p_student_no);
  v_txn uuid := gen_random_uuid();
  v_account public.accounts;
  v_loan public.loans;
begin
  insert into public.loans (id, loan_no, student_no, principal, remaining, rate, score, plan, periods, purpose, disbursed_via,
    loan_txn, opened_on, operator_id)
  values (p_id, 'DK' || to_char(v_day, 'YYMMDD') || (select lpad(n::text, greatest(length(n::text), 4), '0') from nextval('public.loans_no_seq') n),
    p_student_no, p_amount, p_amount, app_private.loan_rate(app_private.anchor_on(v_day), v_score), v_score, p_plan, p_periods,
    p_purpose, p_via, v_txn, v_day, p_operator)
  returning * into v_loan;
  insert into public.loan_periods (loan_id, seq, due_on, principal)
  select p_id, k, v_day + 7 * k, p_amount / p_periods + case when k = p_periods then p_amount % p_periods else 0 end
  from generate_series(1, p_periods) k where p_plan = 'installment'
  union all
  select p_id, 1, v_due, p_amount where p_plan = 'bullet';
  update public.accounts set balance = balance + case when p_via = 'account' then p_amount else 0 end, updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment, denominations, reason,
    operator_id, device_id, loan_id, created_at)
  values (v_txn, 'loan', p_student_no, p_amount, case when p_via = 'account' then p_amount else 0 end, v_account.balance,
    case when p_via = 'cash' then -p_amount else 0 end, p_via, case when p_via = 'cash' then app_private.make_change(p_amount) end,
    case p_plan when 'installment' then '分 ' || p_periods || ' 期' else '一次还清 ' || p_periods || ' 周' end || '，用途：' || p_purpose,
    p_operator, app_private.request_header('x-device-id'), p_id, p_at);
  return v_loan;
end
$$;

-- 放款 (§10.3) at the counter: 1 HTB up to the score's 额度, in installments (weekly, 1–8 periods) or all at once after
-- is the loan's id: sent again, it returns the same result. The purpose is 1–30 characters.
-- is the loan's id: sent again, it returns the same result.
create function public.open_loan(p_id uuid, p_student_no text, p_amount integer, p_purpose text, p_plan text, p_periods integer,
  p_via text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
  v_account public.accounts;
  v_term public.terms;
  v_score integer;
  v_limit integer;
  v_due date;
  v_loan public.loans;
begin
  perform app_private.forbid_president();
  v_account := app_private.lock_account(p_student_no, v_me);
  select * into v_loan from public.loans where id = p_id;
  if found then
    return app_private.loan_result(v_loan.id, v_loan.loan_txn);
  end if;
  v_term := app_private.require_term(v_today);
  if p_plan is null or p_plan not in ('installment', 'bullet') then
    perform app_private.fail('INVALID_INPUT', '{"field":"plan"}');
  end if;
  if p_periods is null or p_periods not between 1 and 8 then
    perform app_private.fail('INVALID_INPUT', '{"field":"periods"}');
  end if;
  if p_via is null or p_via not in ('account', 'cash') then
    perform app_private.fail('INVALID_INPUT', '{"field":"via"}');
  end if;
  if nullif(trim(p_purpose), '') is null or char_length(trim(p_purpose)) > 30 then
    perform app_private.fail('INVALID_INPUT', '{"field":"purpose"}');
  end if;
  v_due := v_today + 7 * p_periods;
  if v_due > v_term.ends_on then
    perform app_private.fail('TERM_TOO_LONG', jsonb_build_object('ends_on', v_term.ends_on,
      'max_weeks', nullif(least(8, (v_term.ends_on - v_today) / 7), 0)));
  end if;
  if exists (select 1 from public.loans where student_no = p_student_no and status in ('active', 'overdue')) then
    perform app_private.fail('LOAN_OUTSTANDING');
  end if;
  v_score := (select score from public.credit_scores where student_no = p_student_no);
  v_limit := app_private.credit_limit(v_score);
  if v_limit is null then
    perform app_private.fail('CREDIT_TOO_LOW', jsonb_build_object('score', v_score,
      'min_score', (app_private.setting('credit_curve') ->> 'min_score')::integer));
  end if;
  if p_amount is null or p_amount <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  if p_amount > v_limit then
    perform app_private.fail('OVER_CREDIT_LIMIT', jsonb_build_object('limit', v_limit));
  end if;
  v_loan := app_private.start_loan(p_id, p_student_no, p_amount, trim(p_purpose), p_plan, p_periods, p_via, v_me, now());
  -- M13 风险提醒 loan_large：超过 risk_rules 的金额，或信用分低于 600（对象 loans:<id>；「终止」提前到期）
  return app_private.loan_result(p_id, v_loan.loan_txn);
end
$$;

-- 还款 (§10.5) at the counter: from the account, or in cash counted by notes as for a deposit (p_amount, when given, must
-- match them). Up to all it takes to pay the loan off now. p_id is the transaction's id: sent again, it returns the same
-- result.
create function public.repay_loan(p_id uuid, p_loan_id uuid, p_amount integer, p_payment text, p_denominations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_loan public.loans;
  v_account public.accounts;
  v_txn public.txns;
  v_amount integer := p_amount;
  v_payoff integer;
begin
  perform app_private.forbid_president();
  select * into v_loan from public.loans where id = p_loan_id;
  if not found then
    perform app_private.fail('INVALID_INPUT', '{"field":"loan_id"}');
  end if;
  v_account := app_private.lock_account(v_loan.student_no, v_me);
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.loan_result(v_txn.loan_id, v_txn.id);
  end if;
  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.status not in ('active', 'overdue') then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'loan_id', 'status', v_loan.status));
  end if;
  if p_payment = 'cash' then
    v_amount := app_private.cash_total(p_denominations);
    if p_amount is distinct from null and p_amount <> v_amount then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
  elsif p_payment is distinct from 'account' then
    perform app_private.fail('INVALID_INPUT', '{"field":"payment"}');
  end if;
  if v_amount is null or v_amount <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  v_payoff := v_loan.remaining + ceil(v_loan.interest_centi / 100.0)::integer;
  if v_amount > v_payoff then
    perform app_private.fail('REPAY_TOO_MUCH', jsonb_build_object('max', v_payoff));
  end if;
  if app_private.loan_take(v_loan, v_amount) <> v_amount then
    perform app_private.fail('INVALID_AMOUNT', jsonb_build_object('payoff', v_payoff));
  end if;
  if p_payment = 'account' and v_amount > v_account.balance then
    perform app_private.fail('INSUFFICIENT_BALANCE', jsonb_build_object('balance', v_account.balance, 'short', v_amount - v_account.balance));
  end if;
  v_txn := app_private.pay_loan(p_loan_id, p_id, v_amount, p_payment, case when p_payment = 'cash' then p_denominations end, v_me,
    now(), app_private.cn_date(now()), false, null);
  return app_private.loan_result(p_loan_id, v_txn.id);
end
$$;

-- 终止 (§10.8) by the president or the bank admin, with a reason: all the principal and interest fall due today and come
-- out of 活期 as far as it goes; the rest is 逾期 at once. A loan already terminated is returned as it is.
-- Returns {"loan": loan_json, "txn": the repayment taken, or null}.
create function public.terminate_loan(p_loan_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_today date := app_private.cn_date(now());
  v_loan public.loans;
  v_balance integer;
  v_amount integer;
  v_txn public.txns;
begin
  if nullif(trim(p_reason), '') is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"reason"}');
  end if;
  select * into v_loan from public.loans where id = p_loan_id;
  if not found then
    perform app_private.fail('INVALID_INPUT', '{"field":"loan_id"}');
  end if;
  select balance into v_balance from public.accounts where student_no = v_loan.student_no for update;
  select * into v_loan from public.loans where id = p_loan_id for update;
  if v_loan.terminated_at is not null then
    return jsonb_build_object('loan', app_private.loan_json(p_loan_id), 'txn', null);
  end if;
  if v_loan.status not in ('active', 'overdue') then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'loan_id', 'status', v_loan.status));
  end if;
  update public.loan_periods set due_on = v_today where loan_id = p_loan_id and paid < principal and due_on > v_today;
  update public.loans set terminated_at = now(), terminated_by = v_me, terminate_reason = trim(p_reason) where id = p_loan_id
  returning * into v_loan;
  v_amount := app_private.loan_take(v_loan, least(v_loan.remaining + ceil(v_loan.interest_centi / 100.0)::integer, greatest(v_balance, 0)));
  if v_amount > 0 then
    v_txn := app_private.pay_loan(p_loan_id, null, v_amount, 'account', null, v_me, now(), v_today, false, '终止');
  end if;
  perform app_private.mark_overdue(p_loan_id, v_today, now());
  perform app_private.log('loan.terminate', 'loans:' || p_loan_id, null,
    jsonb_build_object('loan_no', v_loan.loan_no, 'reason', trim(p_reason), 'txn', v_txn.txn_no));
  return jsonb_build_object('loan', app_private.loan_json(p_loan_id), 'txn', case when v_txn.id is not null then app_private.txn_result(v_txn) end);
end
$$;
grant execute on function public.loan_quote(text), public.loan_preview(text, integer, text, integer), public.open_loan(uuid, text, integer, text, text, integer, text),
  public.repay_loan(uuid, uuid, integer, text, jsonb), public.terminate_loan(uuid, text) to authenticated;

-- txn_cash as in 20261112000000_cash_counts.sql, with cash loans paid out and cash repayments taken in.
create or replace function app_private.txn_cash(p_txn public.txns) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_orig jsonb;
begin
  case
    when p_txn.type = 'deposit' or p_txn.type = 'repay' and p_txn.payment = 'cash' then
      return jsonb_strip_nulls(jsonb_build_object('income', p_txn.denominations));
    when p_txn.type = 'withdraw' or p_txn.type = 'loan' and p_txn.payment = 'cash' then
      return jsonb_strip_nulls(jsonb_build_object('payout', p_txn.denominations));
    when p_txn.type = 'purchase' and p_txn.payment = 'cash' then
      return jsonb_strip_nulls(jsonb_build_object('income', p_txn.denominations, 'payout', p_txn.change_given));
    when p_txn.type = 'reversal' then
      v_orig := (select app_private.txn_cash(o) from public.txns o where o.id = p_txn.reversal_of);
      return jsonb_strip_nulls(jsonb_build_object('income', v_orig -> 'payout', 'payout', v_orig -> 'income'));
    else
      return '{}';
  end case;
end
$$;

-- require_duty as in 20261116000100_term_deposits.sql, with 放款 and 还款 among the counter's business.
create or replace function app_private.require_duty() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_started timestamptz;
begin
  if new.type in ('deposit', 'withdraw', 'purchase', 'reversal', 'term_open', 'term_close', 'loan', 'repay') and not new.offline
     and exists (select 1 from public.user_roles where user_id = new.operator_id and role = 'teller') then
    v_started := (select started_at from public.duty where user_id = new.operator_id and ended_at is null);
    if v_started is null then
      perform app_private.fail('OFF_DUTY');
    elsif app_private.cn_date(v_started) < app_private.cn_date(now()) then
      perform app_private.fail('STALE_DUTY', jsonb_build_object('started_at', v_started));
    end if;
  end if;
  return new;
end
$$;

-- open_term_deposit as in 20261116000100_term_deposits.sql: a student with a loan not paid off opens no 定期 (§9.2).
create or replace function public.open_term_deposit(p_id uuid, p_student_no text, p_amount integer, p_weeks integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
  v_account public.accounts;
  v_term public.terms;
  v_dep public.term_deposits;
begin
  perform app_private.forbid_president();
  v_account := app_private.lock_account(p_student_no, v_me);
  select * into v_dep from public.term_deposits where id = p_id;
  if found then
    return app_private.term_result(v_dep, v_dep.open_txn);
  end if;
  v_term := app_private.require_term(v_today);
  if p_weeks is null or p_weeks not in (2, 4, 8) then
    perform app_private.fail('INVALID_INPUT', '{"field":"weeks"}');
  end if;
  if v_today + 7 * p_weeks > v_term.ends_on then
    perform app_private.fail('TERM_TOO_LONG', jsonb_build_object('ends_on', v_term.ends_on,
      'max_weeks', (select max(w) from unnest(array[2, 4, 8]) w where v_today + 7 * w <= v_term.ends_on)));
  end if;
  if p_amount is null or p_amount <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  if p_amount > v_account.balance then
    perform app_private.fail('INSUFFICIENT_BALANCE', jsonb_build_object('balance', v_account.balance, 'short', p_amount - v_account.balance));
  end if;
  if exists (select 1 from public.loans where student_no = p_student_no and status in ('active', 'overdue')) then
    perform app_private.fail('LOAN_OUTSTANDING');
  end if;
  v_dep := app_private.start_term_deposit(p_id, p_student_no, p_amount, p_weeks, v_me, now());
  return app_private.term_result(v_dep, v_dep.open_txn);
end
$$;

-- lookup_student as in 20261116000100_term_deposits.sql, with the loan not paid off: its principal left and whether it
-- is overdue (§16.1 查询, the 贷款逾期 mark on the card).
create or replace function public.lookup_student(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_student public.students;
begin
  select * into v_student from public.students where student_no = p_student_no;
  if not found then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  if v_student.status = 'closed' then
    perform app_private.fail('STUDENT_INACTIVE', '{"status":"closed"}');
  end if;
  if v_student.user_id = v_me or exists (select 1 from public.staff_payroll where user_id = v_me and account = p_student_no) then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  return jsonb_build_object('student_no', v_student.student_no, 'name', v_student.name, 'division', v_student.division,
    'cohort', v_student.cohort, 'class_no', v_student.class_no, 'grade', public.grade(v_student),
    'class_label', public.class_label(v_student), 'status', v_student.status,
    'balance', (select balance from public.accounts where student_no = p_student_no),
    'term_total', (select term_total from public.accounts where student_no = p_student_no),
    'loan_remaining', coalesce((select remaining from public.loans where student_no = p_student_no and status in ('active', 'overdue')), 0),
    'loan_overdue', exists (select 1 from public.loans where student_no = p_student_no and status = 'overdue'),
    'withdrawn_today', app_private.withdrawn_today(p_student_no),
    'credit', app_private.credit_info(p_student_no) - 'student_no');
end
$$;

-- reverse_txn as in 20261116000100_term_deposits.sql, with the loans of §10.9: a loan (the teller their own of today, the
-- president and bank admin any) while nothing has been paid on it and it is not overdue, which voids it; a repayment
-- while it is the loan's last one and the loan is still the student's one not paid off, which puts the interest and the
-- plan back as they were before it, the periods due before today then 逾期.
create or replace function public.reverse_txn(p_id uuid, p_original_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'teacher');
  v_teacher boolean := app_private.has_role('teacher');
  v_orig public.txns;
  v_account public.accounts;
  v_txn public.txns;
  v_dep public.term_deposits;
  v_loan public.loans;
  v_pay public.loan_payments;
  v_amount integer;
  v_carry integer;
begin
  if p_reason is null or not (p_reason in ('金额录错', '学号录错', '业务选错') or p_reason ~ '^其他[：:]\s*\S') then
    perform app_private.fail('INVALID_INPUT', '{"field":"reason"}');
  end if;
  select * into v_orig from public.txns where id = p_original_id;
  if not found then
    perform app_private.fail('TXN_NOT_FOUND');
  end if;
  select * into v_account from public.accounts where student_no = v_orig.student_no for update;
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.txn_result(v_txn);
  end if;
  select * into v_orig from public.txns where id = p_original_id for update;
  select * into v_dep from public.term_deposits where id = v_orig.term_id for update;
  select * into v_loan from public.loans where id = v_orig.loan_id for update;
  select * into v_pay from public.loan_payments where txn_id = v_orig.id;

  if v_orig.status <> 'normal'
     or not (v_orig.type in ('deposit', 'withdraw', 'purchase', 'term_open', 'loan', 'repay')
             or (v_teacher and v_orig.type in ('opening', 'term_close')))
     or not (v_teacher or (v_orig.operator_id = v_me and app_private.cn_date(v_orig.created_at) = app_private.cn_date(now())))
     or v_orig.type = 'term_open' and v_dep.status <> 'open'
     or v_orig.type = 'term_close' and (v_dep.status <> 'early' or v_dep.matures_on < app_private.cn_date(now()))
     or v_orig.type = 'loan' and (v_loan.status <> 'active'
       or exists (select 1 from public.txns where loan_id = v_loan.id and type = 'repay' and status = 'normal'))
     or v_orig.type = 'repay' and (exists (select 1 from public.txns where loan_id = v_loan.id and type = 'repay' and status = 'normal' and seq > v_orig.seq)
       or v_loan.status = 'closed' and exists (select 1 from public.loans where student_no = v_loan.student_no and status in ('active', 'overdue'))) then
    perform app_private.fail('REVERSAL_NOT_ALLOWED');
  end if;
  -- What the reversal takes out of 活期 (negative: puts back), and the 零头 left.
  v_amount := v_orig.balance_delta;
  v_carry := v_account.interest_carry;
  if v_orig.type = 'term_close' then
    -- The interest paid comes back: its whole HTB were in this transaction, its 零头 in interest_carry; a carry since
    -- spent or grown past 1 HTB moves whole HTB between the two.
    v_carry := v_carry - v_dep.interest_centi + 100 * (v_orig.amount - v_dep.principal);
    v_amount := v_amount - floor(v_carry / 100.0)::integer;
    v_carry := v_carry - 100 * floor(v_carry / 100.0)::integer;
  end if;
  if v_account.balance < v_amount then
    perform app_private.fail('REVERSAL_INSUFFICIENT_BALANCE', jsonb_build_object('balance', v_account.balance,
      'amount', case when v_orig.type = 'term_close' then v_amount else v_orig.amount end));
  end if;

  update public.accounts set balance = balance - v_amount,
    total_in = total_in - case when v_orig.type in ('deposit', 'opening') then v_orig.amount else 0 end,
    total_out = total_out - case when v_orig.type = 'withdraw' then v_orig.amount else 0 end,
    total_spent = total_spent - case when v_orig.type = 'purchase' and v_orig.payment = 'account' then v_orig.amount else 0 end,
    term_total = term_total + case v_orig.type when 'term_open' then -v_dep.principal when 'term_close' then v_dep.principal else 0 end,
    interest_carry = v_carry,
    updated_at = now()
  where student_no = v_orig.student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment,
    reversal_of, reason, operator_id, device_id, term_id, loan_id)
  values (p_id, 'reversal', v_orig.student_no, case when v_orig.type = 'term_close' then v_amount else v_orig.amount end,
    -v_amount, v_account.balance, -v_orig.cash_delta, v_orig.payment, v_orig.id, p_reason, v_me,
    app_private.request_header('x-device-id'), v_orig.term_id, v_orig.loan_id)
  returning * into v_txn;
  update public.txns set status = 'reversed' where id = v_orig.id;

  if v_orig.type = 'purchase' then
    perform 1 from public.products where id in (select product_id from public.txn_items where txn_id = v_orig.id)
    order by id for update;
    update public.products p set stock = p.stock + i.qty, updated_at = now()
    from public.txn_items i where i.txn_id = v_orig.id and p.id = i.product_id;
    insert into public.stock_movements (product_id, kind, qty_delta, txn_id, operator_id)
    select product_id, 'reversal', qty, v_txn.id, v_me from public.txn_items where txn_id = v_orig.id;
  elsif v_orig.type = 'term_open' then
    update public.term_deposits set status = 'reversed' where id = v_dep.id;
  elsif v_orig.type = 'term_close' then
    update public.term_deposits set status = 'open', close_txn = null, interest_centi = null where id = v_dep.id;
  elsif v_orig.type = 'loan' then
    -- 作废: no interest, no points
    update public.loans set status = 'reversed', remaining = 0, interest_centi = 0 where id = v_loan.id;
  elsif v_orig.type = 'repay' then
    update public.loan_periods p set principal = (e ->> 'principal')::integer, paid = (e ->> 'paid')::integer
    from jsonb_array_elements(v_pay.before -> 'periods') e where p.loan_id = v_loan.id and p.seq = (e ->> 'seq')::integer;
    update public.loans set remaining = remaining + v_pay.principal,
      interest_centi = case when status = 'closed' then (v_pay.before ->> 'interest_centi')::integer else interest_centi + 100 * v_pay.interest end,
      closed_on = null,
      status = case when exists (select 1 from public.loan_periods where loan_id = v_loan.id and paid < principal and overdue_at is not null)
        then 'overdue' else 'active' end
    where id = v_loan.id;
    perform app_private.mark_overdue(v_loan.id, app_private.cn_date(now()) - 1, now());
  end if;

  perform app_private.log('txn.reverse', 'txns:' || v_orig.id, to_jsonb(v_orig), to_jsonb(v_txn));
  return app_private.txn_result(v_txn);
end
$$;

-- run_daily as in 20261116000100_term_deposits.sql, with the loans after the 定期 that matured (their money there to
-- repay with): 自动扣款 and 逾期, then the day's loan interest on what is left, so a loan repaid on its day owes none for it.
create or replace function app_private.run_daily(p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done date;
  v_term public.terms := app_private.current_term(p_day);
begin
  select done_to into v_done from public.job_runs where job = 'daily' for update;
  if p_day <= v_done then
    return jsonb_build_object('job', 'daily', 'day', p_day, 'status', 'skipped');
  end if;
  if p_day <> v_done + 1 or p_day >= app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'day', 'next', v_done + 1));
  end if;
  if v_term.id is not null then
    -- In term, in this order (§13):
    perform app_private.accrue_interest(p_day);
    perform app_private.mature_term_deposits(p_day, p_day = v_term.ends_on);
    perform app_private.collect_loans(p_day, p_day = v_term.ends_on);
    perform app_private.accrue_loans(p_day);
    if p_day = v_term.ends_on then
      perform app_private.settle_interest((p_day + 1)::timestamp at time zone 'Asia/Shanghai');
    end if;
  end if;
  update public.job_runs set done_to = p_day, last_ok = now(), last_err = null where job = 'daily';
  return jsonb_build_object('job', 'daily', 'day', p_day, 'status', case when v_term.id is null then 'holiday' else 'done' end,
    'term_id', v_term.id);
end
$$;

-- run_weekly as in 20261115000100_interest.sql, with 逾期满一周 after the week's credit changes.
create or replace function app_private.run_weekly(p_week date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done date;
  v_term public.terms := app_private.current_term(p_week);
  v_first boolean := v_term.starts_on > p_week - 7;
begin
  select done_to into v_done from public.job_runs where job = 'weekly' for update;
  if p_week <= v_done then
    return jsonb_build_object('job', 'weekly', 'day', p_week, 'status', 'skipped');
  end if;
  if extract(isodow from p_week) <> 1 or p_week > v_done + 7
     or (select done_to from public.job_runs where job = 'daily') < p_week - 1 then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'week'));
  end if;
  if v_term.id is not null then
    -- In term, in this order (§13):
    perform app_private.settle_interest(p_week::timestamp at time zone 'Asia/Shanghai');
    if not v_first then
      perform app_private.credit_weekly(p_week);
      perform app_private.overdue_weekly(p_week);
    end if;
    perform app_private.publish_anchor(p_week, v_first);
  end if;
  update public.job_runs set done_to = p_week, last_ok = now(), last_err = null where job = 'weekly';
  return jsonb_build_object('job', 'weekly', 'day', p_week, 'status', case when v_term.id is null then 'holiday' else 'done' end,
    'term_id', v_term.id, 'first', coalesce(v_first, false));
end
$$;

-- What keeps a term from 结转 (§6.3), as in 20261116000100_term_deposits.sql, with the loans it paid out not yet paid off:
-- {"kind":"loan","id","loan_no","student_no","name","remaining","status","due_on"}, due_on the last day due.
create or replace function app_private.term_open_items(p_term public.terms) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(i order by k, day, student_no), '[]') from (
    select 0 as k, null::date as day, null::text as student_no, jsonb_build_object('kind', 'job', 'job', job, 'done_to', done_to) as i
    from public.job_runs where job = 'daily' and done_to < p_term.ends_on
    union all
    select 1, d.matures_on, d.student_no, jsonb_build_object('kind', 'term_deposit', 'id', d.id, 'student_no', d.student_no,
      'name', s.name, 'principal', d.principal, 'matures_on', d.matures_on)
    from public.term_deposits d join public.students s using (student_no)
    where d.status = 'open' and d.opened_on between p_term.starts_on and p_term.ends_on
    union all
    select 2, x.due_on, l.student_no, jsonb_build_object('kind', 'loan', 'id', l.id, 'loan_no', l.loan_no, 'student_no', l.student_no,
      'name', s.name, 'remaining', l.remaining, 'status', l.status, 'due_on', x.due_on)
    from public.loans l join public.students s using (student_no),
      lateral (select max(due_on) as due_on from public.loan_periods where loan_id = l.id) x
    where l.status in ('active', 'overdue') and l.opened_on between p_term.starts_on and p_term.ends_on
  ) x
$$;

-- publish_anchor as in 20261116000100_term_deposits.sql, 存贷比 with the 贷款剩余本金 at the Monday's start.
create or replace function app_private.publish_anchor(p_week date, p_first boolean) returns public.rate_weeks
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := p_week::timestamp at time zone 'Asia/Shanghai';
  v_params jsonb := app_private.setting('anchor_params');
  v_prev numeric := app_private.anchor_on(p_week - 1);
  v_before integer := (select deposits from public.rate_weeks where week_start = p_week - 7);
  v_deposits integer;
  v_loans integer := app_private.loans_on(v_at);
  v_ratio numeric;
  v_growth numeric;
  v_adjust numeric := 0;
  v_row public.rate_weeks;
begin
  v_deposits := (select coalesce(sum(balance_delta), 0) from public.txns where created_at < v_at)
    + (select coalesce(sum(app_private.term_total_on(student_no, v_at)), 0) from (select distinct student_no from public.term_deposits) s);
  v_ratio := case when v_deposits > 0 then round(100.0 * v_loans / v_deposits, 4) else 0 end;
  if not p_first and v_before is not null then
    v_growth := case when v_deposits > 0 and v_before > 0 then round(100.0 * v_deposits / v_before - 100, 4) else 0 end;
    v_adjust := app_private.anchor_adjust(v_ratio, v_growth, v_params);
  end if;
  insert into public.rate_weeks (week_start, prev_anchor, deposits, loans, ratio, growth, adjust, anchor, params)
  values (p_week, v_prev, v_deposits, v_loans, v_ratio, v_growth, v_adjust,
    least((v_params ->> 'max')::numeric, greatest((v_params ->> 'min')::numeric, v_prev + v_adjust)), v_params)
  on conflict (week_start) do nothing
  returning * into v_row;
  if v_row.week_start is null then
    select * into v_row from public.rate_weeks where week_start = p_week;
  end if;
  return v_row;
end
$$;

-- close_accounts as in 20261116000100_term_deposits.sql: a student with a loan not paid off is not closed
-- (LOAN_OUTSTANDING, {"student_no","loan_no"}); it is paid off or terminated first.
create or replace function public.close_accounts(p_user_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_uid uuid;
  v_student public.students;
  v_account public.accounts;
  v_loan_no text;
  v_cleared integer := 0;
  v_closed jsonb := '[]';
begin
  perform app_private.forbid_president();
  if coalesce(cardinality(p_user_ids), 0) = 0 or v_me = any(p_user_ids) then
    perform app_private.fail('INVALID_INPUT', '{"field":"user_id"}');
  end if;
  for v_uid in select distinct u from unnest(p_user_ids) u order by u loop
    if not exists (select 1 from public.profiles where id = v_uid and closed_at is null) then
      perform app_private.fail('USER_NOT_FOUND');
    end if;
    perform app_private.guard_teacher(app_private.is_teacher(v_uid));
    if app_private.is_teacher(v_uid) then
      perform app_private.fail('INVALID_INPUT', '{"field":"user_id"}');
    end if;
    select * into v_student from public.students where user_id = v_uid;
    if found then
      v_loan_no := (select loan_no from public.loans where student_no = v_student.student_no and status in ('active', 'overdue'));
      if v_loan_no is not null then
        perform app_private.fail('LOAN_OUTSTANDING', jsonb_build_object('student_no', v_student.student_no, 'loan_no', v_loan_no));
      end if;
      perform app_private.end_term_deposit(d.id, 'early', 0, v_me, now())
      from public.term_deposits d where d.student_no = v_student.student_no and d.status = 'open';
      select * into v_account from public.accounts where student_no = v_student.student_no for update;
      if v_account.balance > 0 then
        update public.accounts set balance = 0, updated_at = now() where student_no = v_student.student_no;
        insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id)
        values (gen_random_uuid(), 'closing', v_student.student_no, v_account.balance, -v_account.balance, 0, '注销账号',
          v_me, app_private.request_header('x-device-id'));
        v_cleared := v_cleared + v_account.balance;
      end if;
      update public.students set status = 'closed' where student_no = v_student.student_no;
      update public.staff_payroll set account = null, attendance = false where account = v_student.student_no;
    end if;
    update public.staff_payroll set account = null, attendance = false where user_id = v_uid;
    update public.profiles set disabled = true, closed_at = now() where id = v_uid;
    update auth.users set banned_until = '9999-12-31' where id = v_uid;
    perform app_private.end_sessions(v_uid);
    v_closed := v_closed || jsonb_build_object('user_id', v_uid, 'name', (select display_name from public.profiles where id = v_uid),
      'balance', case when v_student.user_id = v_uid then v_account.balance end);
    v_student := null;
    v_account := null;
  end loop;
  perform app_private.log('user.close', null, null, jsonb_build_object('closed', v_closed, 'cleared', v_cleared));
  return jsonb_build_object('closed', jsonb_array_length(v_closed), 'cleared', v_cleared);
end
$$;

-- check_balances as in 20261116000100_term_deposits.sql, with kind loan (贷款剩余本金与放款、还款流水一致: recorded
-- loans.remaining, expected the loan paid out less the principal of its repayments, none counted once reversed) and kind
-- loan_plan (the same remaining against what its periods still ask for).
create or replace function app_private.check_balances() returns table (kind text, key text, recorded integer, expected bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(r), '[]') into v_rows from (
    select 'account' as kind, a.student_no as key, a.balance as recorded, coalesce(sum(t.balance_delta), 0) as expected
    from public.accounts a left join public.txns t on t.student_no = a.student_no
    group by a.student_no, a.balance having a.balance <> coalesce(sum(t.balance_delta), 0)
    union all
    select 'product', p.id::text, p.stock, coalesce(sum(m.qty_delta), 0)
    from public.products p left join public.stock_movements m on m.product_id = p.id
    group by p.id, p.stock having p.stock <> coalesce(sum(m.qty_delta), 0)
    union all
    select 'balance_after', c.txn_no, c.balance_after, c.expected
    from (select txn_no, balance_after,
            coalesce(lag(balance_after) over (partition by student_no order by seq), 0)::bigint + balance_delta as expected
          from public.txns) c
    where c.balance_after <> c.expected
    union all
    select x.kind, x.key, x.recorded, x.expected
    from (select a.student_no, a.total_in, a.total_out, a.total_spent,
            coalesce(sum(t.amount) filter (where t.type in ('deposit', 'opening')), 0) as e_in,
            coalesce(sum(t.amount) filter (where t.type = 'withdraw'), 0) as e_out,
            coalesce(sum(t.amount) filter (where t.type = 'purchase' and t.payment = 'account'), 0) as e_spent
          from public.accounts a left join public.txns t on t.student_no = a.student_no and t.status = 'normal'
          group by a.student_no) s,
      lateral (values ('total_in', s.student_no, s.total_in, s.e_in), ('total_out', s.student_no, s.total_out, s.e_out),
                      ('total_spent', s.student_no, s.total_spent, s.e_spent)) x(kind, key, recorded, expected)
    where x.recorded <> x.expected
    union all
    select 'txn_items', t.txn_no, t.amount, coalesce(sum(i.unit_price * i.qty), 0)
    from public.txns t left join public.txn_items i on i.txn_id = t.id
    where t.type = 'purchase'
    group by t.id, t.txn_no, t.amount having t.amount <> coalesce(sum(i.unit_price * i.qty), 0)
    union all
    -- 利息累计与计息记录一致 (PHASE-2.md §14.1), 活期 and 定期
    select 'interest', a.student_no, (100 * (coalesce(p.paid, 0) + coalesce(tp.paid, 0)) + a.interest_carry)::integer,
      coalesce(s.centi, 0) + coalesce(te.centi, 0)
    from public.accounts a
      left join (select student_no, sum(amount) as paid from public.txns where type = 'interest' group by student_no) p using (student_no)
      left join (select student_no, sum(centi) as centi from public.interest_accruals where settled_txn is not null group by student_no) s using (student_no)
      left join (select t.student_no, sum(case when t.type = 'term_close' then t.amount - d.principal else d.principal - t.amount end) as paid
                 from public.txns t join public.term_deposits d on d.id = t.term_id left join public.txns o on o.id = t.reversal_of
                 where t.type = 'term_close' or o.type = 'term_close' group by t.student_no) tp using (student_no)
      left join (select student_no, sum(interest_centi) as centi from public.term_deposits where status in ('matured', 'early')
                 group by student_no) te using (student_no)
    where 100 * (coalesce(p.paid, 0) + coalesce(tp.paid, 0)) + a.interest_carry <> coalesce(s.centi, 0) + coalesce(te.centi, 0)
    union all
    -- 定期本金合计与 term_deposits 一致 (§14.1)
    select 'term', a.student_no, a.term_total, coalesce(sum(d.principal) filter (where d.status = 'open'), 0)
    from public.accounts a left join public.term_deposits d using (student_no)
    group by a.student_no, a.term_total having a.term_total <> coalesce(sum(d.principal) filter (where d.status = 'open'), 0)
    union all
    -- 贷款剩余本金与放款、还款流水一致 (§14.1)
    select 'loan', l.loan_no, l.remaining, coalesce(sum(case when t.type = 'loan' then t.amount else -p.principal end), 0)
    from public.loans l left join public.txns t on t.loan_id = l.id and t.type in ('loan', 'repay') and t.status = 'normal'
      left join public.loan_payments p on p.txn_id = t.id
    group by l.id, l.loan_no, l.remaining having l.remaining <> coalesce(sum(case when t.type = 'loan' then t.amount else -p.principal end), 0)
    union all
    select 'loan_plan', l.loan_no, l.remaining, sum(p.principal - p.paid)
    from public.loans l join public.loan_periods p on p.loan_id = l.id
    where l.status <> 'reversed'
    group by l.id, l.loan_no, l.remaining having l.remaining <> sum(p.principal - p.paid)
  ) r;
  if jsonb_array_length(v_rows) > 0 then
    perform app_private.log('check.mismatch', null, null, v_rows);
  end if;
  return query select * from jsonb_to_recordset(v_rows) as x(kind text, key text, recorded integer, expected bigint);
end
$$;

-- 存款 of a student at the end of the day for 日均余额 (§8.2): 活期 and 定期本金 (deposits_on), less the 贷款剩余本金 then.
create function app_private.net_deposits_on(p_student_no text, p_day date) returns integer
language sql stable security definer set search_path = '' as $$
  select app_private.deposits_on(p_student_no, p_day)
    - app_private.loans_on((p_day + 1)::timestamp at time zone 'Asia/Shanghai', p_student_no)
$$;

-- credit_weekly as in 20261116000100_term_deposits.sql, 日均余额 net of the loan not paid off: a loan paid into the account
-- adds nothing.
create or replace function app_private.credit_weekly(p_week date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := (p_week - 7)::timestamp at time zone 'Asia/Shanghai';
  v_to timestamptz := p_week::timestamp at time zone 'Asia/Shanghai';
  v_ref text := 'weeks:' || p_week;
  v_n integer := 0;
  r record;
begin
  for r in
    with counted as (               -- 柜台存款 and 取款 not reversed by p_week
      select t.student_no, t.type, t.amount, t.created_at, app_private.cn_date(t.created_at) as day from public.txns t
      where t.type in ('deposit', 'withdraw') and t.created_at < v_to
        and not exists (select 1 from public.txns x where x.reversal_of = t.id and x.created_at < v_to)
    ), last_week as (
      select student_no, bool_or(type = 'deposit') as deposited, coalesce(sum(amount) filter (where type = 'withdraw'), 0) as withdrawn
      from counted where created_at >= v_from group by student_no
    ), streaks as (                 -- weeks with a deposit, counted back from last week until one without
      select student_no, count(*) filter (where w = p_week - 7 * k) as streak
      from (select student_no, w, (row_number() over (partition by student_no order by w desc))::integer as k
            from (select distinct student_no, day - (extract(isodow from day)::integer - 1) as w from counted where type = 'deposit') d) x
      group by student_no
    )
    select s.student_no, app_private.cn_date(s.opened_at) as opened, coalesce(l.deposited, false) as deposited,
      coalesce(k.streak, 0) as streak, coalesce(l.withdrawn, 0) as withdrawn,
      app_private.balance_on(s.student_no, p_week - 8) as start_balance,
      -- 日均余额 by the end of each day: 活期 and 定期本金, less the loan not paid off
      (select sum(app_private.net_deposits_on(s.student_no, d::date)) from generate_series(p_week - 7, p_week - 1, interval '1 day') d) as balance_sum
    from public.students s left join last_week l using (student_no) left join streaks k using (student_no)
    where s.status = 'normal' and app_private.cn_date(s.opened_at) < p_week
    order by s.student_no
  loop
    if r.deposited then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'deposit_week', '上周有存款', v_ref, null, v_to) is not null)::integer;
    end if;
    if r.streak > 0 and r.streak % 4 = 0 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'deposit_streak', '连续 ' || r.streak || ' 周都有存款', v_ref, null, v_to) is not null)::integer;
    end if;
    if r.withdrawn * 2 > r.start_balance then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'withdraw_half', '上周取款超过周初余额的一半', v_ref, null, v_to) is not null)::integer;
    end if;
    if (p_week - r.opened) / 28 > (p_week - 7 - r.opened) / 28 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'account_age', '开户满 ' || (p_week - r.opened) / 28 * 4 || ' 周', v_ref, null, v_to) is not null)::integer;
    end if;
    if r.balance_sum >= 700 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'balance_100', '上周日均余额不少于 100 HTB', v_ref, null, v_to) is not null)::integer;
    end if;
    if r.balance_sum >= 2100 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'balance_300', '上周日均余额不少于 300 HTB', v_ref, null, v_to) is not null)::integer;
    end if;
  end loop;
  return v_n;
end
$$;

-- deposit_ranking as in 20261116000100_term_deposits.sql, ranked by 活期 + 定期本金 less the 贷款剩余本金 (§16.3); balance is
-- that sum and may be below 0.
create or replace function public.deposit_ranking(p_division text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if app_private.my_student_no() is null then
    perform app_private.fail('FORBIDDEN', '{"roles":["student"]}', '42501');
  end if;
  return (
  with division as (
    select coalesce(p_division, (select division from public.students where student_no = app_private.my_student_no())) as d
  ), held as (                        -- 活期 + 定期本金 − 未还贷款本金, below 0 when the loan is more
    select s.student_no, s.name, s.cohort, public.class_label(s) as class_label, a.balance + a.term_total
      - coalesce((select l.remaining from public.loans l where l.student_no = s.student_no and l.status in ('active', 'overdue')), 0) as held
    from public.students s join public.accounts a on a.student_no = s.student_no
    where s.status = 'normal' and s.division = (select d from division)
  ), ranked as (
    select s.student_no, s.held as balance,
           rank() over (order by s.held desc) as place,
           row_number() over (order by s.held desc, s.student_no) as n,
           jsonb_build_object('rank', rank() over (order by s.held desc),
             'name', case when app_private.setting('ranking_anonymous') = 'true' then app_private.mask_name(s.name) else s.name end,
             'class_label', s.class_label, 'cohort', s.cohort, 'balance', s.held,
             'me', s.student_no is not distinct from app_private.my_student_no()) as j
    from held s
  )
  select jsonb_build_object('division', (select d from division), 'total', (select count(*) from ranked),
    'anonymous', app_private.setting('ranking_anonymous') = 'true',
    'top', (select coalesce(jsonb_agg(j order by n), '[]') from ranked where n <= app_private.setting('ranking_size')::integer),
    'me', (select jsonb_build_object('rank', r.place, 'balance', r.balance,
              'above', (select jsonb_build_object('rank', a.place, 'balance', a.balance) from ranked a
                        where a.balance > r.balance order by a.balance limit 1),
              'behind', (select count(*) from ranked b where b.balance < r.balance),
              'near', (select jsonb_agg(x.j order by x.n) from ranked x where x.n between r.n - 1 and r.n + 1))
           from ranked r where r.student_no = app_private.my_student_no())));
end
$$;
