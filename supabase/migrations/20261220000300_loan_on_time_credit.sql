-- 按时还款 (PHASE-2.md §8.2): a period paid off counts repay_on_time only once it has begun (within the 7 days up to
-- its due day, its due day included) and not on the day the loan was made, so borrowing and paying back at once, or
-- paying off periods weeks ahead, earns nothing; paying off early is repay_early's (7 days after the loan, as before).

-- pay_loan as in 20261119000100_loans.sql, with the two conditions on repay_on_time.
create or replace function app_private.pay_loan(p_loan_id uuid, p_txn_id uuid, p_amount integer, p_via text, p_denominations jsonb,
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
    if v_fill = p.principal - p.paid and p_day <= p.due_on and p_day >= p.due_on - 7 and p_day > v_loan.opened_on
       and v_loan.terminated_at is null then
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
