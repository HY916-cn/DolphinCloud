-- 结转 (PHASE-2.md §6.3): after a term is closed, 补录 and 编辑 (correct_txn) are the only ways to change it. A
-- transaction dated in a closed term is not reversed: reverse_txn, and with it a risk alert's 终止, returns TERM_CLOSED.

-- reverse_txn as in 20261213000000_reverse_admin_only.sql, refusing the transactions of a closed term.
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
  v_hold public.wealth_holdings;
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
  if v_orig.type in ('opening', 'term_close', 'wealth_close', 'adjust') then
    perform app_private.forbid_president();
  end if;
  select * into v_account from public.accounts where student_no = v_orig.student_no for update;
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.txn_result(v_txn);
  end if;
  select * into v_orig from public.txns where id = p_original_id for update;
  select * into v_dep from public.term_deposits where id = v_orig.term_id for update;
  select * into v_loan from public.loans where id = v_orig.loan_id for update;
  select * into v_hold from public.wealth_holdings where id = v_orig.wealth_id for update;
  select * into v_pay from public.loan_payments where txn_id = v_orig.id;

  if v_orig.status <> 'normal'
     or not (v_orig.type in ('deposit', 'withdraw', 'purchase', 'term_open', 'loan', 'repay', 'wealth_buy')
             or (v_teacher and v_orig.type in ('opening', 'term_close', 'wealth_close', 'adjust')))
     or not (v_teacher or (v_orig.operator_id = v_me and app_private.cn_date(v_orig.created_at) = app_private.cn_date(now())))
     or v_orig.type = 'term_open' and v_dep.status <> 'open'
     or v_orig.type = 'term_close' and (v_dep.status <> 'early' or v_dep.matures_on < app_private.cn_date(now()))
     or v_orig.type = 'wealth_buy' and (v_hold.status <> 'open' or v_hold.valued_to > v_hold.starts_on)
     or v_orig.type = 'wealth_close' and (v_hold.status <> 'redeemed' or v_hold.matures_on < app_private.cn_date(now()))
     or v_orig.type = 'loan' and (v_loan.status <> 'active'
       or exists (select 1 from public.txns where loan_id = v_loan.id and type = 'repay' and status = 'normal'))
     or v_orig.type = 'repay' and (exists (select 1 from public.txns where loan_id = v_loan.id and type = 'repay' and status = 'normal' and seq > v_orig.seq)
       or v_loan.status = 'closed' and exists (select 1 from public.loans where student_no = v_loan.student_no and status in ('active', 'overdue'))) then
    perform app_private.fail('REVERSAL_NOT_ALLOWED');
  end if;
  -- A term after its 结转 changes only through 补录 and 编辑 (§6.3): its transactions are not reversed.
  if exists (select 1 from public.terms
             where closed_at is not null and app_private.cn_date(v_orig.created_at) between starts_on and ends_on) then
    perform app_private.fail('TERM_CLOSED');
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
  elsif v_orig.type = 'wealth_close' then
    -- The value paid comes back the same way: its whole HTB here, the rest out of interest_carry.
    v_carry := v_carry - v_hold.value_centi + 100 * v_orig.amount;
    v_amount := v_amount - floor(v_carry / 100.0)::integer;
    v_carry := v_carry - 100 * floor(v_carry / 100.0)::integer;
  end if;
  if v_account.balance < v_amount then
    perform app_private.fail('REVERSAL_INSUFFICIENT_BALANCE', jsonb_build_object('balance', v_account.balance,
      'amount', case when v_orig.type in ('term_close', 'wealth_close') then v_amount else v_orig.amount end));
  end if;

  update public.accounts set balance = balance - v_amount,
    total_in = total_in - case when v_orig.type in ('deposit', 'opening') then v_orig.amount else 0 end,
    total_out = total_out - case when v_orig.type = 'withdraw' then v_orig.amount else 0 end,
    total_spent = total_spent - case when v_orig.type = 'purchase' and v_orig.payment = 'account' then v_orig.amount else 0 end,
    term_total = term_total + case v_orig.type when 'term_open' then -v_dep.principal when 'term_close' then v_dep.principal else 0 end,
    wealth_total = wealth_total + case v_orig.type when 'wealth_buy' then -v_hold.principal when 'wealth_close' then v_hold.principal else 0 end,
    interest_carry = v_carry,
    updated_at = now()
  where student_no = v_orig.student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment,
    reversal_of, reason, operator_id, device_id, term_id, loan_id, wealth_id)
  values (p_id, 'reversal', v_orig.student_no, case when v_orig.type = 'term_close' then v_amount when v_orig.type = 'wealth_close' then abs(v_amount)
    else v_orig.amount end,
    -v_amount, v_account.balance, -v_orig.cash_delta, v_orig.payment, v_orig.id, p_reason, v_me,
    app_private.request_header('x-device-id'), v_orig.term_id, v_orig.loan_id, v_orig.wealth_id)
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
  elsif v_orig.type = 'wealth_buy' then
    update public.wealth_holdings set status = 'reversed' where id = v_hold.id;
  elsif v_orig.type = 'wealth_close' then
    update public.wealth_holdings set status = 'open', close_txn = null where id = v_hold.id;
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
