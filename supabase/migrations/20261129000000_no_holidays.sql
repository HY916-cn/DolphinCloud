-- 学期内与假期相同 (PHASE-2.md §6.2, §8.2, §9, §10, §13): every day the daily job does all its work and every Monday the
-- weekly job does all of its: 活期计息 and 结息, the weekly 信用分, the anchor, and the loans' interest, 自动扣款 and 逾期.
-- A loan may be paid out on any day for up to 8 weeks, past a term's end; a term carries its open loans over at 结转.
-- A 补录 or 编辑 may be dated any time from the student's account opening to now. Terms remain for 结转 and for reading the
-- history by term. The days the jobs marked holiday before this migration are not worked again.

-- No business needs a current term any more.
drop function app_private.require_term(date);

-- publish_anchor as in 20261120000200_wealth.sql, every Monday alike: it adjusts unless the Monday before has no row
-- (the first run).
drop function app_private.publish_anchor(date, boolean);
create function app_private.publish_anchor(p_week date) returns public.rate_weeks
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
    + (select coalesce(sum(app_private.term_total_on(student_no, v_at)), 0) from (select distinct student_no from public.term_deposits) s)
    + (select coalesce(sum(app_private.wealth_total_on(student_no, v_at)), 0) from (select distinct student_no from public.wealth_holdings) s);
  v_ratio := case when v_deposits > 0 then round(100.0 * v_loans / v_deposits, 4) else 0 end;
  if v_before is not null then
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

-- collect_loans as in 20261119000100_loans.sql, a loan running on past a term's last day as it was planned.
drop function app_private.collect_loans(date, boolean);
create function app_private.collect_loans(p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := (p_day + 1)::timestamp at time zone 'Asia/Shanghai';
  v_loan public.loans;
  v_amount integer;
  v_n integer := 0;
  r record;
begin
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

-- 提前支取的利息 (§9.5) as in 20261116000100_term_deposits.sql, every day from the day it opened to the day before p_to.
create or replace function app_private.early_interest(p_dep public.term_deposits, p_to date) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(floor(p_dep.principal * app_private.saving_rate(app_private.anchor_on(g::date),
    app_private.score_on(p_dep.student_no, g::date)) / 7)), 0)::integer
  from generate_series(p_dep.opened_on, p_to - 1, interval '1 day') g
$$;

-- run_daily as in 20261120000200_wealth.sql, all of it on every day.
create or replace function app_private.run_daily(p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done date;
begin
  select done_to into v_done from public.job_runs where job = 'daily' for update;
  if p_day <= v_done then
    return jsonb_build_object('job', 'daily', 'day', p_day, 'status', 'skipped');
  end if;
  if p_day <> v_done + 1 or p_day >= app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'day', 'next', v_done + 1));
  end if;
  -- In this order (§13):
  perform app_private.accrue_interest(p_day);
  perform app_private.mature_term_deposits(p_day);
  perform app_private.value_wealth(p_day);
  perform app_private.mature_wealth(p_day);
  perform app_private.collect_loans(p_day);
  perform app_private.accrue_loans(p_day);
  update public.job_runs set done_to = p_day, last_ok = now(), last_err = null where job = 'daily';
  return jsonb_build_object('job', 'daily', 'day', p_day, 'status', 'done');
end
$$;

-- run_weekly as in 20261119000100_loans.sql, all of it on every Monday.
create or replace function app_private.run_weekly(p_week date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done date;
begin
  select done_to into v_done from public.job_runs where job = 'weekly' for update;
  if p_week <= v_done then
    return jsonb_build_object('job', 'weekly', 'day', p_week, 'status', 'skipped');
  end if;
  if extract(isodow from p_week) <> 1 or p_week > v_done + 7
     or (select done_to from public.job_runs where job = 'daily') < p_week - 1 then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'week'));
  end if;
  -- In this order (§13):
  perform app_private.settle_interest(p_week::timestamp at time zone 'Asia/Shanghai');
  perform app_private.credit_weekly(p_week);
  perform app_private.overdue_weekly(p_week);
  perform app_private.publish_anchor(p_week);
  update public.job_runs set done_to = p_week, last_ok = now(), last_err = null where job = 'weekly';
  return jsonb_build_object('job', 'weekly', 'day', p_week, 'status', 'done');
end
$$;

-- What keeps a term from 结转 (§6.3), as in 20261120000100_fixed_term.sql: only the daily job not yet past its last day;
-- the 定期, 理财 and loans still open carry over to the next term as they are.
create or replace function app_private.term_open_items(p_term public.terms) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', 'job', 'job', job, 'done_to', done_to)), '[]')
  from public.job_runs where job = 'daily' and done_to < p_term.ends_on
$$;

-- The counter's 贷款 panel (§10.3, §16.1) as in 20261119000100_loans.sql: max_weeks and max_periods are always 8, term is
-- the current term or null in the holidays (as term_quote), and blocked is STUDENT_INACTIVE, LOAN_OUTSTANDING,
-- CREDIT_TOO_LOW or null.
create or replace function public.loan_quote(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
  v_term public.terms := app_private.current_term(v_today);
  v_student public.students := app_private.loan_student(p_student_no, v_me);
  v_score integer := (select score from public.credit_scores where student_no = p_student_no);
  v_rate numeric := app_private.loan_rate(app_private.anchor_on(v_today), v_score);
  v_open uuid := (select id from public.loans where student_no = p_student_no and status in ('active', 'overdue'));
begin
  return (select jsonb_build_object('student_no', p_student_no, 'score', v_score, 'limit', app_private.credit_limit(v_score),
      'rate', v_rate, 'penalty_rate', app_private.penalty_rate(v_rate), 'max_weeks', 8, 'max_periods', 8,
      'term', case when v_term.id is not null then jsonb_build_object('id', v_term.id, 'name', v_term.name, 'ends_on', v_term.ends_on) end,
      'balance', a.balance,
      'blocked', case when v_student.status <> 'normal' then 'STUDENT_INACTIVE'
        when v_open is not null then 'LOAN_OUTSTANDING' when v_rate is null then 'CREDIT_TOO_LOW' end,
      'loan', app_private.loan_json(v_open))
    from public.accounts a where a.student_no = p_student_no);
end
$$;

-- 放款 (§10.3) as in 20261119000100_loans.sql, on any day, the last period due up to 8 weeks on whatever the terms.
create or replace function public.open_loan(p_id uuid, p_student_no text, p_amount integer, p_purpose text, p_plan text,
  p_periods integer, p_via text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_account public.accounts;
  v_score integer;
  v_limit integer;
  v_loan public.loans;
begin
  perform app_private.forbid_president();
  v_account := app_private.lock_account(p_student_no, v_me);
  select * into v_loan from public.loans where id = p_id;
  if found then
    return app_private.loan_result(v_loan.id, v_loan.loan_txn);
  end if;
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

-- 原始时间 (§10.11) as in 20261127000100_manual_entry_functions.sql: not before the student's account was opened, not
-- after now, in a term already 结转 too.
create or replace function app_private.manual_check_at(p_student_no text, p_at timestamptz) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_from timestamptz := (select opened_at from public.students where student_no = p_student_no);
begin
  if p_at is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"occurred_at"}');
  end if;
  if p_at < v_from or p_at > now() then
    perform app_private.fail('OCCURRED_OUT_OF_RANGE', jsonb_build_object('from', v_from, 'to', now()));
  end if;
end
$$;
