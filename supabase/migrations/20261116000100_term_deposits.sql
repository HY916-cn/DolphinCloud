-- 定期 (PHASE-2.md §9.5, §10.2, §10.9, §14, §15): the counter moves 活期 into a 2, 4 or 8 week 定期 at a rate locked when
-- it opens; on the day it matures run_daily brings the principal and the interest back into 活期, the interest's 零头
-- joining interest_carry; 提前支取 pays the 活期 rate of each day it was held. 存款余额 (the anchor, 日均余额, the ranking)
-- counts 活期 and 定期本金 together.

create table public.term_deposits (           -- 定期
  id             uuid primary key,            -- 客户端生成，作幂等键
  student_no     text not null references public.students(student_no),
  principal      integer not null check (principal > 0),
  weeks          integer not null check (weeks in (2, 4, 8)),
  rate           numeric(8,4) not null,       -- 锁定的周利率（百分数）
  opened_on      date not null,
  matures_on     date not null,
  status         text not null default 'open' check (status in ('open', 'matured', 'early', 'reversed')),
  open_txn       uuid not null references public.txns(id) deferrable initially deferred, -- written just before its term_open
  close_txn      uuid references public.txns(id),
  interest_centi integer,                     -- 实付利息（0.01 HTB）
  -- 到期利息 = 本金 × 周利率 × 周数, to 0.01 HTB (§9.5): what it pays at maturity
  expected_centi integer generated always as (floor(principal * rate * weeks)::integer) stored
);
create index on public.term_deposits (student_no);
create index on public.term_deposits (matures_on) where status = 'open';
create trigger audit after insert or update or delete on public.term_deposits for each row execute function app_private.audit_row();
alter table public.term_deposits enable row level security;
grant select on public.term_deposits to authenticated;
-- A student reads their own; the accountant, president and bank admin everyone's (§3). The counter reads a student's
-- through term_quote.
create policy read on public.term_deposits for select to authenticated using (
  student_no = (select app_private.my_student_no())
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

-- 定期本金合计 of each account; term_open and term_close move it with the 活期 balance.
alter table public.accounts add column term_total integer not null default 0 check (term_total >= 0);
-- The 定期 a term_open, term_close or their reversal belongs to.
alter table public.txns add column term_id uuid references public.term_deposits(id);
create index on public.txns (term_id) where term_id is not null;

-- A student's 定期本金 at a time, from the transactions dated before it: a term_open adds its principal, a term_close
-- takes it away, and a reversal undoes the one it reverses.
create function app_private.term_total_on(p_student_no text, p_at timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(d.principal * case when coalesce(o.type, t.type) = 'term_open' then 1 else -1 end
                                  * case when t.type = 'reversal' then -1 else 1 end), 0)::integer
  from public.term_deposits d join public.txns t on t.term_id = d.id left join public.txns o on o.id = t.reversal_of
  where d.student_no = p_student_no and t.created_at < p_at
$$;

-- 存款余额 of a student at the end of the day (Asia/Shanghai): 活期 and 定期本金 (§8.2, §9.1).
create function app_private.deposits_on(p_student_no text, p_day date) returns integer
language sql stable security definer set search_path = '' as $$
  select app_private.balance_on(p_student_no, p_day)
    + app_private.term_total_on(p_student_no, (p_day + 1)::timestamp at time zone 'Asia/Shanghai')
$$;

-- Opens a 定期 at p_at: the rate of its week's anchor and the student's score now, maturing p_weeks weeks after the day.
-- The callers have checked the account, the amount and the length.
create function app_private.start_term_deposit(p_id uuid, p_student_no text, p_amount integer, p_weeks integer,
  p_operator uuid, p_at timestamptz) returns public.term_deposits
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := app_private.cn_date(p_at);
  v_txn uuid := gen_random_uuid();
  v_account public.accounts;
  v_dep public.term_deposits;
begin
  update public.accounts set balance = balance - p_amount, term_total = term_total + p_amount, updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.term_deposits (id, student_no, principal, weeks, rate, opened_on, matures_on, open_txn)
  values (p_id, p_student_no, p_amount, p_weeks,
    app_private.term_rate(app_private.anchor_on(v_day), p_weeks, (select score from public.credit_scores where student_no = p_student_no)),
    v_day, v_day + 7 * p_weeks, v_txn)
  returning * into v_dep;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, device_id, term_id, created_at)
  values (v_txn, 'term_open', p_student_no, p_amount, -p_amount, v_account.balance, p_operator,
    app_private.request_header('x-device-id'), p_id, p_at);
  return v_dep;
end
$$;

-- Closes an open 定期 as p_status with p_centi of interest: the principal and the whole HTB of the interest and the
-- account's 零头 go back into 活期 as one term_close at p_at, the rest stays in interest_carry. Null when it is not open.
create function app_private.end_term_deposit(p_id uuid, p_status text, p_centi integer, p_operator uuid, p_at timestamptz)
returns public.txns language plpgsql security definer set search_path = '' as $$
declare
  v_dep public.term_deposits;
  v_account public.accounts;
  v_paid integer;
  v_txn public.txns;
begin
  select * into v_account from public.accounts where student_no = (select student_no from public.term_deposits where id = p_id) for update;
  select * into v_dep from public.term_deposits where id = p_id for update;
  if v_dep.status is distinct from 'open' then
    return null;
  end if;
  v_paid := (v_account.interest_carry + p_centi) / 100;
  update public.accounts set balance = balance + v_dep.principal + v_paid, term_total = term_total - v_dep.principal,
    interest_carry = (interest_carry + p_centi) % 100, updated_at = now()
  where student_no = v_dep.student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, device_id, term_id, created_at)
  values (gen_random_uuid(), 'term_close', v_dep.student_no, v_dep.principal + v_paid, v_dep.principal + v_paid, v_account.balance,
    p_operator, app_private.request_header('x-device-id'), v_dep.id, p_at)
  returning * into v_txn;
  update public.term_deposits set status = p_status, close_txn = v_txn.id, interest_centi = p_centi where id = p_id;
  return v_txn;
end
$$;

-- 提前支取的利息 (§9.5), in 0.01 HTB: each day from the day it opened to the day before p_to, in term, at that day's 活期
-- rate (the day's anchor and the student's score at its end), to 0.01 HTB a day, as 活期计息 does.
create function app_private.early_interest(p_dep public.term_deposits, p_to date) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(floor(p_dep.principal * app_private.saving_rate(app_private.anchor_on(g::date),
    app_private.score_on(p_dep.student_no, g::date)) / 7)), 0)::integer
  from generate_series(p_dep.opened_on, p_to - 1, interval '1 day') g
  where (app_private.current_term(g::date)).id is not null
$$;

-- 到期 (§10.2) at the end of p_day, dated the next midnight, by the system login: the agreed interest. On the term's last
-- day (p_last) every 定期 it opened that is still open matures with it, so none outlives its term (one whose term was
-- shortened).
create function app_private.mature_term_deposits(p_day date, p_last boolean) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  r record;
begin
  for r in
    select id, expected_centi from public.term_deposits where status = 'open' and (matures_on <= p_day or p_last and opened_on <= p_day)
    order by student_no, id
  loop
    v_n := v_n + (app_private.end_term_deposit(r.id, 'matured', r.expected_centi, app_private.system_user(),
      (p_day + 1)::timestamp at time zone 'Asia/Shanghai') is not null)::integer;
  end loop;
  -- M14 货币监控：定期利息计为电子币新增（§9.6）
  return v_n;
end
$$;

create function app_private.term_result(p_dep public.term_deposits, p_txn uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.txn_result(t) || jsonb_build_object('term', to_jsonb(p_dep)) from public.txns t where t.id = p_txn
$$;

-- 开定期 (§10.2) at the counter: 1 HTB or more of 活期, for 2, 4 or 8 weeks ending by the term's last day. p_id is the
-- 定期's id: sent again, it returns the same result.
create function public.open_term_deposit(p_id uuid, p_student_no text, p_amount integer, p_weeks integer) returns jsonb
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
  -- M11 有未结清贷款时 LOAN_OUTSTANDING（§9.2）
  v_dep := app_private.start_term_deposit(p_id, p_student_no, p_amount, p_weeks, v_me, now());
  return app_private.term_result(v_dep, v_dep.open_txn);
end
$$;

-- 提前支取 (§10.2, §9.5) at the counter, up to the day it matures: the 活期 interest of the days held. Sent again, it
-- returns the same result.
create function public.withdraw_term_early(p_term_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
  v_dep public.term_deposits;
  v_txn public.txns;
begin
  perform app_private.forbid_president();
  select * into v_dep from public.term_deposits where id = p_term_id;
  if not found then
    perform app_private.fail('INVALID_INPUT', '{"field":"term_id"}');
  end if;
  perform app_private.lock_account(v_dep.student_no, v_me);
  select * into v_dep from public.term_deposits where id = p_term_id for update;
  if v_dep.status = 'early' then
    return app_private.term_result(v_dep, v_dep.close_txn);
  end if;
  if v_dep.status <> 'open' or v_dep.matures_on < v_today then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'term_id', 'status', v_dep.status));
  end if;
  v_txn := app_private.end_term_deposit(p_term_id, 'early', app_private.early_interest(v_dep, v_today), v_me, now());
  -- M13 风险提醒 term_early（对象 term_deposits:<id>；「终止」冲正这笔提前支取，定期恢复）
  select * into v_dep from public.term_deposits where id = p_term_id;
  return app_private.term_result(v_dep, v_txn.id);
end
$$;

-- The counter's 定期 panel (§16.1): the student's score, the lengths that end by the term's last day with their locked
-- rates and maturity dates (none out of term), 活期 and 定期本金, and every 定期 of the student, latest first.
create function public.term_quote(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
  v_term public.terms := app_private.current_term(v_today);
  v_anchor numeric := app_private.anchor_on(v_today);
  v_student public.students;
  v_score integer;
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
  v_score := (select score from public.credit_scores where student_no = p_student_no);
  return (select jsonb_build_object('student_no', p_student_no, 'score', v_score,
      'term', case when v_term.id is not null then jsonb_build_object('id', v_term.id, 'name', v_term.name, 'ends_on', v_term.ends_on) end,
      'options', coalesce((select jsonb_agg(jsonb_build_object('weeks', w, 'rate', app_private.term_rate(v_anchor, w, v_score),
          'matures_on', v_today + 7 * w) order by w)
        from unnest(array[2, 4, 8]) w where v_today + 7 * w <= v_term.ends_on), '[]'),
      'balance', a.balance, 'term_total', a.term_total,
      'deposits', coalesce((select jsonb_agg(to_jsonb(d) order by d.opened_on desc, d.id) from public.term_deposits d
        where d.student_no = p_student_no), '[]'))
    from public.accounts a where a.student_no = p_student_no);
end
$$;
grant execute on function public.open_term_deposit(uuid, text, integer, integer), public.withdraw_term_early(uuid),
  public.term_quote(text) to authenticated;

-- lookup_student as in 20261114000000_credit.sql, with 定期本金合计 (§16.1 查询).
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
    'withdrawn_today', app_private.withdrawn_today(p_student_no),
    'credit', app_private.credit_info(p_student_no) - 'student_no');
end
$$;

-- require_duty as in 20261111000000_stale_duty.sql, with 开定期 and 提前支取 among the counter's business.
create or replace function app_private.require_duty() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_started timestamptz;
begin
  if new.type in ('deposit', 'withdraw', 'purchase', 'reversal', 'term_open', 'term_close') and not new.offline
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

-- reverse_txn as in 20261028000100_accounting.sql, with the 定期 of §10.9: a term_open (the teller their own of today,
-- the president and bank admin any) while its 定期 is open, the principal back to 活期; a 提前支取 (the president and bank
-- admin, up to the day it would have matured) restores the 定期 as it was, its interest taken back out of 活期 and
-- interest_carry. A maturity is never reversed.
create or replace function public.reverse_txn(p_id uuid, p_original_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'teacher');
  v_teacher boolean := app_private.has_role('teacher');
  v_orig public.txns;
  v_account public.accounts;
  v_txn public.txns;
  v_dep public.term_deposits;
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

  if v_orig.status <> 'normal'
     or not (v_orig.type in ('deposit', 'withdraw', 'purchase', 'term_open') or (v_teacher and v_orig.type in ('opening', 'term_close')))
     or not (v_teacher or (v_orig.operator_id = v_me and app_private.cn_date(v_orig.created_at) = app_private.cn_date(now())))
     or v_orig.type = 'term_open' and v_dep.status <> 'open'
     or v_orig.type = 'term_close' and (v_dep.status <> 'early' or v_dep.matures_on < app_private.cn_date(now())) then
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
    total_spent = total_spent - case when v_orig.payment = 'account' then v_orig.amount else 0 end,
    term_total = term_total + case v_orig.type when 'term_open' then -v_dep.principal when 'term_close' then v_dep.principal else 0 end,
    interest_carry = v_carry,
    updated_at = now()
  where student_no = v_orig.student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment,
    reversal_of, reason, operator_id, device_id, term_id)
  values (p_id, 'reversal', v_orig.student_no, case when v_orig.type = 'term_close' then v_amount else v_orig.amount end,
    -v_amount, v_account.balance, -v_orig.cash_delta, v_orig.payment, v_orig.id, p_reason, v_me,
    app_private.request_header('x-device-id'), v_orig.term_id)
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
  end if;

  perform app_private.log('txn.reverse', 'txns:' || v_orig.id, to_jsonb(v_orig), to_jsonb(v_txn));
  return app_private.txn_result(v_txn);
end
$$;

-- run_daily as in 20261115000100_interest.sql, with 到期的定期 after 活期计息 and before the term's last 结息, which
-- then pays their interest's 零头 too.
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
    -- M11 贷款计息
    perform app_private.mature_term_deposits(p_day, p_day = v_term.ends_on);
    -- M11 应还日到期的分期自动扣款或记逾期；逾期贷款自动扣款
    if p_day = v_term.ends_on then
      perform app_private.settle_interest((p_day + 1)::timestamp at time zone 'Asia/Shanghai');
    end if;
  end if;
  update public.job_runs set done_to = p_day, last_ok = now(), last_err = null where job = 'daily';
  return jsonb_build_object('job', 'daily', 'day', p_day, 'status', case when v_term.id is null then 'holiday' else 'done' end,
    'term_id', v_term.id);
end
$$;

-- What keeps a term from 结转 (§6.3), as in 20261113000000_terms_jobs.sql, with the 定期 still open that it opened:
-- {"kind":"term_deposit","id","student_no","name","principal","matures_on"}.
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
  ) x
$$;

-- publish_anchor as in 20261115000100_interest.sql, 存款余额 with the 定期本金 at the Monday's start.
create or replace function app_private.publish_anchor(p_week date, p_first boolean) returns public.rate_weeks
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := p_week::timestamp at time zone 'Asia/Shanghai';
  v_params jsonb := app_private.setting('anchor_params');
  v_prev numeric := app_private.anchor_on(p_week - 1);
  v_before integer := (select deposits from public.rate_weeks where week_start = p_week - 7);
  v_deposits integer;
  v_loans integer := 0;               -- M11 贷款剩余本金 at v_at
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

-- credit_weekly as in 20261115000100_interest.sql, 日均余额 with each day's 定期本金.
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
      -- 日均余额 by the end of each day: 活期 and 定期本金
      (select sum(app_private.deposits_on(s.student_no, d::date)) from generate_series(p_week - 7, p_week - 1, interval '1 day') d) as balance_sum
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

-- deposit_ranking as in 20261111000300_rpc_access.sql, ranked by 活期 + 定期本金 (§16.3); balance is that sum.
create or replace function public.deposit_ranking(p_division text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if app_private.my_student_no() is null then
    perform app_private.fail('FORBIDDEN', '{"roles":["student"]}', '42501');
  end if;
  return (
  with division as (
    select coalesce(p_division, (select division from public.students where student_no = app_private.my_student_no())) as d
  ), ranked as (
    select s.student_no, a.balance + a.term_total as balance,
           rank() over (order by a.balance + a.term_total desc) as place,
           row_number() over (order by a.balance + a.term_total desc, s.student_no) as n,
           jsonb_build_object('rank', rank() over (order by a.balance + a.term_total desc),
             'name', case when app_private.setting('ranking_anonymous') = 'true' then app_private.mask_name(s.name) else s.name end,
             'class_label', public.class_label(s), 'cohort', s.cohort, 'balance', a.balance + a.term_total,
             'me', s.student_no is not distinct from app_private.my_student_no()) as j
    from public.students s join public.accounts a on a.student_no = s.student_no
    where s.status = 'normal' and s.division = (select d from division)
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

-- close_accounts as in 20261107000100_president_rights.sql: a student's 定期 still open come back to 活期 first, without
-- interest (注销 pays none, §9.4), and leave with the rest of the balance.
create or replace function public.close_accounts(p_user_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_uid uuid;
  v_student public.students;
  v_account public.accounts;
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

-- check_balances as in 20261115000100_interest.sql, with kind term (定期本金合计与 term_deposits 一致: recorded
-- accounts.term_total, expected the open principal) and the 定期 interest in kind interest: 100 × (Σ interest + the
-- interest part of each term_close, less what its reversal took back) + interest_carry = the settled accruals + the
-- interest of the 定期 closed.
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
  ) r;
  if jsonb_array_length(v_rows) > 0 then
    perform app_private.log('check.mismatch', null, null, v_rows);
  end if;
  return query select * from jsonb_to_recordset(v_rows) as x(kind text, key text, recorded integer, expected bigint);
end
$$;

-- bank_report as in 20261115000100_interest.sql; the tellers' table leaves out everything the system login makes
-- (结息 and 定期到期). term_open and term_close show as their own keys in balance.changes.
create or replace function public.bank_report(p_from date, p_to date, p_division text default null, p_cohort integer default null,
  p_class_no integer default null, p_student_no text default null, p_time_from time default null, p_time_to time default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_start timestamptz := p_from::timestamp at time zone 'Asia/Shanghai';
  v_end timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Shanghai';
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    perform app_private.fail('INVALID_INPUT', '{"field":"period"}');
  end if;
  if p_time_from >= p_time_to then
    perform app_private.fail('INVALID_INPUT', '{"field":"time"}');
  end if;
  return (
    with scope as (
      select s.student_no, s.division, s.cohort, s.class_no, s.status, public.class_label(s) as class_label
      from public.students s
      -- Students opened by the end of the period; one with a transaction before then counts whatever opened_at says.
      where (s.opened_at < v_end or exists (select 1 from public.txns x where x.student_no = s.student_no and x.created_at < v_end))
        and (p_division is null or s.division = p_division) and (p_cohort is null or s.cohort = p_cohort)
        and (p_class_no is null or s.class_no = p_class_no) and (p_student_no is null or s.student_no = p_student_no)
    ),
    whole_days as (
      select x.* from public.txns x join scope using (student_no) where x.created_at >= v_start and x.created_at < v_end
    ),
    t as (
      select * from whole_days x
      where (p_time_from is null or public.cn_time(x) >= p_time_from) and (p_time_to is null or public.cn_time(x) < p_time_to)
    ),
    live as (select * from t where status = 'normal' and type in ('deposit', 'withdraw', 'purchase')),
    opening as (
      select distinct on (x.student_no) x.student_no, x.balance_after as balance
      from public.txns x join scope using (student_no) where x.created_at < v_start order by x.student_no, x.seq desc
    ),
    closing as (
      select distinct on (x.student_no) x.student_no, x.balance_after as balance
      from public.txns x join scope using (student_no) where x.created_at < v_end order by x.student_no, x.seq desc
    ),
    per_student as (
      select student_no, count(*) as n,
        coalesce(sum(amount) filter (where type = 'deposit'), 0) as deposit,
        coalesce(sum(amount) filter (where type = 'withdraw'), 0) as withdraw,
        coalesce(sum(amount) filter (where type = 'purchase' and payment = 'account'), 0) as spent
      from live group by student_no
    ),
    holders as (
      select s.*, coalesce(c.balance, 0) as balance, coalesce(p.n, 0) as n, coalesce(p.deposit, 0) as deposit,
        coalesce(p.withdraw, 0) as withdraw, coalesce(p.spent, 0) as spent
      from scope s left join closing c using (student_no) left join per_student p using (student_no)
    )
    select jsonb_build_object(
      'business', (select jsonb_build_object(
        'deposit', jsonb_build_object('count', count(*) filter (where type = 'deposit'),
          'amount', coalesce(sum(amount) filter (where type = 'deposit'), 0)),
        'withdraw', jsonb_build_object('count', count(*) filter (where type = 'withdraw'),
          'amount', coalesce(sum(amount) filter (where type = 'withdraw'), 0)),
        'purchase_account', jsonb_build_object('count', count(*) filter (where type = 'purchase' and payment = 'account'),
          'amount', coalesce(sum(amount) filter (where type = 'purchase' and payment = 'account'), 0)),
        'purchase_cash', jsonb_build_object('count', count(*) filter (where type = 'purchase' and payment = 'cash'),
          'amount', coalesce(sum(amount) filter (where type = 'purchase' and payment = 'cash'), 0)),
        'students', count(distinct student_no)) from live),
      'reversals', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t where type = 'reversal'),
      'reversed', (select count(*) from t where status = 'reversed'),
      'openings', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t where type = 'opening'),
      'balance', jsonb_build_object(
        'opening', (select coalesce(sum(balance), 0) from opening),
        'closing', (select coalesce(sum(balance), 0) from closing),
        'changes', (select coalesce(jsonb_object_agg(type, delta), '{}') from (
          select type, sum(balance_delta) as delta from whole_days group by type) d)),
      'cash', (select jsonb_build_object('in', coalesce(sum(cash_delta) filter (where cash_delta > 0), 0),
        'out', coalesce(-sum(cash_delta) filter (where cash_delta < 0), 0)) from t),
      'days', (select jsonb_agg(jsonb_build_object('day', g.day,
          'deposit', coalesce(d.deposit, 0), 'deposit_count', coalesce(d.deposit_count, 0),
          'withdraw', coalesce(d.withdraw, 0), 'withdraw_count', coalesce(d.withdraw_count, 0),
          'purchase', coalesce(d.purchase, 0), 'purchase_count', coalesce(d.purchase_count, 0),
          'students', coalesce(d.students, 0), 'change', coalesce(e.change, 0)) order by g.day)
        from (select generate_series(p_from, p_to, interval '1 day')::date as day) g
        left join (select app_private.cn_date(created_at) as day, sum(balance_delta) as change from whole_days group by 1) e using (day)
        left join (select app_private.cn_date(created_at) as day,
            coalesce(sum(amount) filter (where type = 'deposit'), 0) as deposit, count(*) filter (where type = 'deposit') as deposit_count,
            coalesce(sum(amount) filter (where type = 'withdraw'), 0) as withdraw, count(*) filter (where type = 'withdraw') as withdraw_count,
            coalesce(sum(amount) filter (where type = 'purchase'), 0) as purchase, count(*) filter (where type = 'purchase') as purchase_count,
            count(distinct student_no) as students
          from live group by 1) d using (day)),
      'hours', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'count', n) order by h), '[]') from (
        select extract(hour from created_at at time zone 'Asia/Shanghai')::integer as h, count(*) as n from live group by 1) x),
      'tellers', (select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'count', x.n,
          'deposit_count', x.deposit_count, 'deposit', x.deposit, 'withdraw_count', x.withdraw_count, 'withdraw', x.withdraw,
          'purchase_count', x.purchase_count, 'purchase', x.purchase, 'reversed', x.reversed, 'reversals', x.reversals)
          order by x.n desc, p.display_name), '[]')
        from (select operator_id,
            count(*) filter (where status = 'normal' and type in ('deposit', 'withdraw', 'purchase')) as n,
            count(*) filter (where status = 'normal' and type = 'deposit') as deposit_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'deposit'), 0) as deposit,
            count(*) filter (where status = 'normal' and type = 'withdraw') as withdraw_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'withdraw'), 0) as withdraw,
            count(*) filter (where status = 'normal' and type = 'purchase') as purchase_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'purchase'), 0) as purchase,
            count(*) filter (where status = 'reversed' and type <> 'opening') as reversed,
            count(*) filter (where type = 'reversal') as reversals
          from t where type <> 'opening' and operator_id <> app_private.system_user() group by operator_id) x
        join public.profiles p on p.id = x.operator_id),
      'classes', (select coalesce(jsonb_agg(to_jsonb(c) order by c.division desc, c.cohort desc, c.class_no), '[]') from (
        select division, cohort, class_no, class_label, count(*) as students, count(*) filter (where n > 0) as active,
          sum(balance) as balance, sum(deposit) as deposit, sum(withdraw) as withdraw, sum(spent) as spent
        from holders group by division, cohort, class_no, class_label) c),
      'students', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where n > 0),
          'normal', count(*) filter (where status = 'normal'), 'frozen', count(*) filter (where status = 'frozen'),
          'graduated', count(*) filter (where status = 'graduated'),
          'closed', count(*) filter (where status = 'closed'), 'balance', coalesce(sum(balance), 0),
          'median', coalesce(percentile_disc(0.5) within group (order by balance), 0), 'max', coalesce(max(balance), 0))
        from holders),
      'distribution', (select jsonb_agg(jsonb_build_object('label', b.label, 'count', (
          select count(*) from holders a where a.balance >= b.lo and (b.hi is null or a.balance <= b.hi))) order by b.lo)
        from (values ('0', 0, 0), ('1–19', 1, 19), ('20–49', 20, 49), ('50–99', 50, 99), ('100–199', 100, 199),
          ('200 以上', 200, null)) b(label, lo, hi)),
      'products', (select coalesce(jsonb_agg(to_jsonb(x) order by x.qty desc, x.name), '[]') from (
        select p.name, sum(i.qty) as qty, sum(i.qty * i.unit_price) as amount,
          coalesce(sum(i.qty * i.unit_price) filter (where l.payment = 'account'), 0) as account,
          coalesce(sum(i.qty * i.unit_price) filter (where l.payment = 'cash'), 0) as cash,
          case when bool_and(p.cost is not null) then sum(i.qty * p.cost) end as cost
        from live l join public.txn_items i on i.txn_id = l.id join public.products p on p.id = i.product_id
        where l.type = 'purchase' group by p.id, p.name) x),
      'stock', (select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]') from (
        select p.name, p.price, p.cost,
          p.stock - coalesce(sum(m.qty_delta) filter (where m.created_at >= v_start), 0) as opening,
          coalesce(sum(m.qty_delta) filter (where m.kind = 'stock_in' and m.created_at >= v_start and m.created_at < v_end), 0) as stock_in,
          coalesce(-sum(m.qty_delta) filter (where m.kind = 'stock_out' and m.created_at >= v_start and m.created_at < v_end), 0) as stock_out,
          coalesce(-sum(m.qty_delta) filter (where m.kind in ('sale', 'reversal') and m.created_at >= v_start and m.created_at < v_end), 0) as sold,
          p.stock - coalesce(sum(m.qty_delta) filter (where m.created_at >= v_end), 0) as closing
        from public.products p left join public.stock_movements m on m.product_id = p.id group by p.id) x),
      'issues', jsonb_build_object(
        'batches', (select coalesce(jsonb_agg(jsonb_build_object('batch_no', batch_no, 'issued_on', issued_on, 'total', total,
            'purpose', purpose, 'approver', approver_name, 'denominations', denominations) order by issued_on, batch_no), '[]')
          from public.currency_issues where issued_on between p_from and p_to),
        'total', (select coalesce(sum(total), 0) from public.currency_issues where issued_on <= p_to))));
end
$$;
