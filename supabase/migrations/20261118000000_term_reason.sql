-- 定期流水的说明 (PHASE-2.md §14.1): the counter reads no term_deposits, so each term_open and term_close says what it
-- was in txns.reason, its dates written as the 活期利息 ones are: 「4 周，12月10日 到期」, 「到期，利息 12.48 HTB」,
-- 「提前支取，利息 0.37 HTB」.

-- start_term_deposit as in 20261116000100_term_deposits.sql, its term_open saying the length and the maturity date.
create or replace function app_private.start_term_deposit(p_id uuid, p_student_no text, p_amount integer, p_weeks integer,
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
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id, term_id, created_at)
  values (v_txn, 'term_open', p_student_no, p_amount, -p_amount, v_account.balance,
    p_weeks || ' 周，' || to_char(v_dep.matures_on, 'FMMM月FMDD日') || ' 到期', p_operator,
    app_private.request_header('x-device-id'), p_id, p_at);
  return v_dep;
end
$$;

-- end_term_deposit as in 20261116000100_term_deposits.sql, its term_close saying 到期 or 提前支取 (注销 too) and the
-- interest paid.
create or replace function app_private.end_term_deposit(p_id uuid, p_status text, p_centi integer, p_operator uuid, p_at timestamptz)
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
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id, term_id, created_at)
  values (gen_random_uuid(), 'term_close', v_dep.student_no, v_dep.principal + v_paid, v_dep.principal + v_paid, v_account.balance,
    case p_status when 'matured' then '到期' else '提前支取' end || '，利息 ' || to_char(p_centi / 100.0, 'FM999999990.00') || ' HTB',
    p_operator, app_private.request_header('x-device-id'), v_dep.id, p_at)
  returning * into v_txn;
  update public.term_deposits set status = p_status, close_txn = v_txn.id, interest_centi = p_centi where id = p_id;
  return v_txn;
end
$$;
