-- 理财六品种 (PHASE-2.md §10.10, §15): the counter's quote, 买入 by product, 卖出 from the day after (T+1), the 理财 page
-- by product, 手动登记 by product, the 利率看板 with each product's day; the net values after each run_daily and each
-- catch-up; the reversals as in §10.9; wealth_params as in §14.3.

-- Each product now: its parameters, its latest net value (day, nav, change, rate; closed when that day had no close),
-- this week's weekly base (anchor + premium) and its daily base.
create function app_private.wealth_products(p_today date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(p || jsonb_build_object('day', n.day, 'nav', n.nav, 'change', n.change, 'rate', n.rate,
      'closed', n.change is not null and not exists (select 1 from public.wealth_days w where w.product = n.product and w.day = n.day),
      'week_base', app_private.anchor_on(p_today) + (p ->> 'premium')::numeric,
      'day_base', app_private.day_base(app_private.anchor_on(p_today) + (p ->> 'premium')::numeric)) order by i), '[]')
  from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') with ordinality x(p, i)
    left join lateral app_private.wealth_nav_on(p ->> 'key', p_today) n on true
$$;

-- A holding as the counter shows it: the row, the product's name, the latest net value (null for one bought for a
-- term), the gain over the principal (0.01 HTB) and the first day it may be sold.
create function app_private.wealth_holding(p_hold public.wealth_holdings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(p_hold) || jsonb_build_object(
    'name', (select p ->> 'name' from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p where p ->> 'key' = p_hold.product),
    'nav', case when p_hold.buy_nav is not null then (app_private.wealth_nav_on(p_hold.product, app_private.cn_date(now()))).nav end,
    'gain_centi', p_hold.value_centi - 100 * p_hold.principal,
    'sellable_on', p_hold.opened_on + 1)
$$;

create or replace function app_private.wealth_result(p_hold public.wealth_holdings, p_txn uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.txn_result(t) || jsonb_build_object('holding', app_private.wealth_holding(p_hold)) from public.txns t where t.id = p_txn
$$;

-- 柜台「理财」 (§16.1): today, each product now, the student's 活期 and 理财本金, and every holding of theirs, newest first.
create or replace function public.wealth_quote(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
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
  return (select jsonb_build_object('student_no', p_student_no, 'today', v_today, 'products', app_private.wealth_products(v_today),
      'balance', a.balance, 'wealth_total', a.wealth_total,
      'holdings', coalesce((select jsonb_agg(app_private.wealth_holding(h) order by h.opened_on desc, h.id) from public.wealth_holdings h
        where h.student_no = p_student_no), '[]'))
    from public.accounts a where a.student_no = p_student_no);
end
$$;

-- 买入 (§10.10) of a product at its latest net value.
drop function public.buy_wealth(uuid, text, integer, integer, text);
create function public.buy_wealth(p_id uuid, p_student_no text, p_amount integer, p_product text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_account public.accounts;
  v_hold public.wealth_holdings;
begin
  perform app_private.forbid_president();
  v_account := app_private.lock_account(p_student_no, v_me);
  select * into v_hold from public.wealth_holdings where id = p_id;
  if found then
    return app_private.wealth_result(v_hold, v_hold.open_txn);
  end if;
  if not exists (select 1 from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p where p ->> 'key' = p_product) then
    perform app_private.fail('INVALID_INPUT', '{"field":"product"}');
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
  v_hold := app_private.start_wealth(p_id, p_student_no, p_amount, p_product, v_me, now());
  return app_private.wealth_result(v_hold, v_hold.open_txn);
end
$$;
grant execute on function public.buy_wealth(uuid, text, integer, text) to authenticated;

-- 卖出 (§10.10) at the latest net value, from the day after the 买入 (WEALTH_LOCKED before); as in
-- 20261120000300_wealth_multiplier.sql otherwise.
create or replace function public.redeem_wealth(p_holding_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_hold public.wealth_holdings;
  v_txn public.txns;
begin
  perform app_private.forbid_president();
  select * into v_hold from public.wealth_holdings where id = p_holding_id;
  if not found then
    perform app_private.fail('INVALID_INPUT', '{"field":"holding_id"}');
  end if;
  perform app_private.lock_account(v_hold.student_no, v_me);
  select * into v_hold from public.wealth_holdings where id = p_holding_id for update;
  if v_hold.status = 'redeemed' then
    return app_private.wealth_result(v_hold, v_hold.close_txn);
  end if;
  if v_hold.status <> 'open' then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'holding_id', 'status', v_hold.status));
  end if;
  if app_private.cn_date(now()) <= v_hold.opened_on then
    perform app_private.fail('WEALTH_LOCKED', jsonb_build_object('sellable_on', v_hold.opened_on + 1));
  end if;
  v_txn := app_private.end_wealth(p_holding_id, 'redeemed', v_me, now());
  select * into v_hold from public.wealth_holdings where id = p_holding_id;
  return app_private.wealth_result(v_hold, v_txn.id);
end
$$;

-- 后台「理财」 (§16.2) by product: wealth_params; each product now (as wealth_products) with its holdings open
-- ({"count","principal","value_centi"}), the weekdays whose close is 18 hours past due and still not known (missing,
-- oldest first) and the calendar days before p_before (default today), the latest p_limit (1–366) newest first, each
-- {"day","status","close","prev_close","change","source","source_name","note","created_by_name","created_at","rate","nav"}:
-- status open (its close), none (no close, up to the product's first net value), closed (no close: source closed, 休市)
-- or pending (not known yet: 待登记); rate and nav that day's, once worked out. And every holding open.
drop function public.wealth_overview(date, integer);
create function public.wealth_overview(p_before date default null, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_today date := app_private.cn_date(now());
  v_before date := coalesce(p_before, app_private.cn_date(now()));
begin
  if p_limit is null or p_limit not between 1 and 366 then
    perform app_private.fail('INVALID_INPUT', '{"field":"limit"}');
  end if;
  return jsonb_build_object('params', app_private.setting('wealth_params'),
    'products', (select jsonb_agg(p || jsonb_build_object(
        'open', (select jsonb_build_object('count', count(*), 'principal', coalesce(sum(principal), 0), 'value_centi', coalesce(sum(value_centi), 0))
          from public.wealth_holdings where status = 'open' and product = k),
        'missing', (select coalesce(jsonb_agg(g::date order by g), '[]')
          from generate_series((p ->> 'day')::date + 1, v_today, interval '1 day') g
          where extract(isodow from g) <= 5 and app_private.wealth_day_change(k, g::date) is null
            and app_private.wealth_ready_at(k, g::date) + interval '18 hours' <= now()),
        'days', (select jsonb_agg(jsonb_build_object('day', g.day,
            'status', case when w.day is not null then 'open' when g.day <= f.first then 'none' when x.change is not null then 'closed' else 'pending' end,
            'close', w.close, 'prev_close', w.prev_close, 'change', w.change,
            'source', case when w.day is not null then w.source when g.day <= f.first then null when x.change is not null then 'closed' end,
            'source_name', case when w.day is not null then app_private.wealth_source_name(w.source) when g.day <= f.first then null
              when x.change is not null then '休市' else '待登记' end,
            'note', w.note, 'created_by_name', pr.display_name, 'created_at', w.created_at, 'rate', n.rate, 'nav', n.nav)
            order by g.day desc)
          from (select (v_before - i)::date as day from generate_series(1, p_limit) i) g
            cross join lateral (select app_private.wealth_day_change(k, g.day) as change) x
            cross join (select min(day) as first from public.wealth_navs where product = k) f
            left join public.wealth_days w on w.product = k and w.day = g.day
            left join public.profiles pr on pr.id = w.created_by
            left join public.wealth_navs n on n.product = k and n.day = g.day)) order by i)
      from jsonb_array_elements(app_private.wealth_products(v_today)) with ordinality x(p, i), lateral (select p ->> 'key' as k) kk),
    'open', (select jsonb_build_object('count', count(*), 'principal', coalesce(sum(principal), 0), 'value_centi', coalesce(sum(value_centi), 0))
      from public.wealth_holdings where status = 'open'));
end
$$;
grant execute on function public.wealth_overview(date, integer) to authenticated;

-- 手动登记 (§10.10) by the bank admin: a product's change on a weekday whose close may be written by now (−50 to 50, up
-- to 4 decimals) and where it came from; never changed once entered. The net values follow at once.
drop function public.record_wealth_day(date, numeric, text);
create function public.record_wealth_day(p_product text, p_day date, p_change numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row public.wealth_days;
begin
  perform app_private.forbid_president();
  if not exists (select 1 from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p where p ->> 'key' = p_product) then
    perform app_private.fail('INVALID_INPUT', '{"field":"product"}');
  end if;
  if p_day is null or extract(isodow from p_day) >= 6 or app_private.wealth_ready_at(p_product, p_day) > now() then
    perform app_private.fail('INVALID_INPUT', '{"field":"day"}');
  end if;
  if p_change is null or p_change <> round(p_change, 4) or p_change not between -50 and 50 then
    perform app_private.fail('INVALID_INPUT', '{"field":"change"}');
  end if;
  if nullif(trim(p_note), '') is null or length(trim(p_note)) > 200 then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  insert into public.wealth_days (product, day, change, source, note, params, created_by)
  values (p_product, p_day, p_change, 'manual', trim(p_note), app_private.setting('wealth_params'), v_me)
  on conflict do nothing
  returning * into v_row;
  if v_row.day is null then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"day"}');
  end if;
  perform app_private.log('wealth.record', 'wealth_days:' || p_product || ':' || p_day, null, to_jsonb(v_row));
  perform app_private.advance_wealth_navs(app_private.cn_date(now()));
  return to_jsonb(v_row) - 'params';
end
$$;
grant execute on function public.record_wealth_day(text, date, numeric, text) to authenticated;

-- reverse_txn as in 20261215000000_closed_term_reversal.sql: a 买理财 is reversed while the holding is open (the teller
-- the same day, the bank admin any day); a 卖出 reversed brings a holding bought at a net value to its product's latest.
create or replace function public.reverse_txn(p_id uuid, p_original_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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
     or v_orig.type = 'wealth_buy' and v_hold.status <> 'open'
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
    perform app_private.revalue_wealth(v_hold.id);
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

-- run_daily as in 20261129000000_no_holidays.sql, with the net values up to the day.
create or replace function app_private.run_daily(p_day date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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
  perform app_private.advance_wealth_navs(p_day);
  perform app_private.collect_loans(p_day);
  perform app_private.accrue_loans(p_day);
  update public.job_runs set done_to = p_day, last_ok = now(), last_err = null where job = 'daily';
  return jsonb_build_object('job', 'daily', 'day', p_day, 'status', 'done');
end
$$;

-- run_jobs as in 20261113000000_terms_jobs.sql: after catching up, the net values up to today (a weekend's at its
-- 00:05).
create or replace function app_private.run_jobs(p_today date DEFAULT app_private.cn_date(now()))
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_day date;
  v_job text;
  v_result jsonb;
  v_ran jsonb := '[]';
  v_failed jsonb;
begin
  if p_today > app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', '{"field":"today"}');
  end if;
  for v_day in select generate_series(done_to + 1, p_today, interval '1 day')::date from public.job_runs where job = 'daily' loop
    foreach v_job in array array['weekly', 'daily'] loop
      continue when v_job = 'weekly' and extract(isodow from v_day) <> 1 or v_job = 'daily' and v_day = p_today;
      begin
        v_result := case v_job when 'daily' then app_private.run_daily(v_day) else app_private.run_weekly(v_day) end;
      exception when others then
        v_failed := jsonb_build_object('job', v_job, 'day', v_day, 'error', sqlerrm);
        update public.job_runs set last_err = v_day || ': ' || sqlerrm where job = v_job;
        perform app_private.log_system('job.failed', v_failed);
        return jsonb_build_object('ran', v_ran, 'failed', v_failed);
      end;
      if v_result ->> 'status' <> 'skipped' then
        v_ran := v_ran || v_result;
      end if;
    end loop;
  end loop;
  perform app_private.advance_wealth_navs(p_today);
  return jsonb_build_object('ran', v_ran, 'failed', null);
end
$$;

-- set_setting as in 20261211000000_credit_curve_no_saving.sql, wealth_params of six products (§14.3).
create or replace function public.set_setting(p_key text, p_value jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_value jsonb := p_value;
  v_before jsonb;
begin
  perform app_private.forbid_president();
  if p_key = 'denominations' then
    if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value) not between 1 and 10
       or not p_value @> '[1]' or exists (select 1 from jsonb_array_elements(p_value) e where not app_private.json_int_between(e, 1, 1000))
       or (select count(distinct e) <> count(*) from jsonb_array_elements(p_value) e) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
    v_value := (select jsonb_agg(e order by e::numeric) from jsonb_array_elements(p_value) e);
  elsif p_key in ('withdraw_single_limit', 'withdraw_daily_limit') then
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['junior', 'primary']
       or not app_private.json_int_between(p_value -> 'primary', 1, 1000000)
       or not app_private.json_int_between(p_value -> 'junior', 1, 1000000) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'promotion_date' then
    if jsonb_typeof(p_value) is distinct from 'string' or p_value #>> '{}' !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
       or to_char(to_date('2000-' || (p_value #>> '{}'), 'YYYY-MM-DD'), 'MM-DD') <> p_value #>> '{}' then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'ranking_size' then
    if not app_private.json_int_between(p_value, 1, 100) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'ranking_anonymous' then
    if jsonb_typeof(p_value) is distinct from 'boolean' then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'credit_curve' then
    -- 最低分 0–999; 额度 1–10000 HTB with limit_step ≤ limit_min ≤ limit_max, so a student who may borrow may borrow a
    -- step at least; 贷款系数 0.1–10 with up to 4 decimals, loan_min ≤ loan_max.
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> array['limit_max', 'limit_min', 'limit_step', 'loan_max', 'loan_min', 'min_score']
       or not app_private.json_int_between(p_value -> 'min_score', 0, 999)
       or exists (select 1 from unnest(array['limit_min', 'limit_max', 'limit_step']) k where not app_private.json_int_between(p_value -> k, 1, 10000))
       or exists (select 1 from unnest(array['loan_min', 'loan_max']) k
                  where not app_private.json_num_between(p_value -> k, 0.1, 10)) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
    if (p_value ->> 'limit_step')::integer > (p_value ->> 'limit_min')::integer
       or (p_value ->> 'limit_min')::integer > (p_value ->> 'limit_max')::integer
       or (p_value ->> 'loan_min')::numeric > (p_value ->> 'loan_max')::numeric then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'credit_rules' then
    -- every rule, gains 0–100 points and losses −100–0
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> (select array_agg(k order by k) from jsonb_object_keys(app_private.credit_rule_signs()) k)
       or exists (select 1 from jsonb_each(app_private.credit_rule_signs()) s(k, sign)
                  where not app_private.json_int_between(p_value -> k, least(0, sign::integer * 100), greatest(0, sign::integer * 100))) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'anchor_params' then
    -- 锚点 (§9.1), percentages: only initial, min and max change, 0.01–100 in whole hundredths with min ≤ initial ≤ max;
    -- the formula's other keys are fixed and must equal the saved ones.
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> array['growth_step', 'growth_target', 'initial', 'max', 'max_adjust', 'min', 'ratio_step', 'ratio_target', 'weight']
       or exists (select 1 from unnest(array['initial', 'min', 'max']) k where not app_private.json_num_between(p_value -> k, 0.01, 100))
       or exists (select 1 from jsonb_each(app_private.setting('anchor_params')) c
                  where c.key not in ('initial', 'min', 'max') and p_value -> c.key is distinct from c.value) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
    if exists (select 1 from unnest(array['initial', 'min', 'max']) k where (p_value ->> k)::numeric <> round((p_value ->> k)::numeric, 2))
       or (p_value ->> 'min')::numeric > (p_value ->> 'initial')::numeric
       or (p_value ->> 'initial')::numeric > (p_value ->> 'max')::numeric then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'term_rates' then
    -- 定期周利率 (§9.2): every length, 0.01–100 with up to 4 decimals
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['12', '2', '24', '4', '48']
       or exists (select 1 from jsonb_each(p_value) e where not app_private.json_num_between(e.value, 0.01, 100)) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'wealth_params' then
    -- 理财 (§14.3): cap and each product's key, name and symbol fixed, in their order; each product's multiplier 0.1–20
    -- and premium (weekly, percentage points) −10–10, up to 4 decimals
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['cap', 'products']
       or p_value -> 'cap' is distinct from app_private.setting('wealth_params') -> 'cap'
       or jsonb_typeof(p_value -> 'products') <> 'array'
       or jsonb_array_length(p_value -> 'products') <> jsonb_array_length(app_private.setting('wealth_params') -> 'products')
       or exists (select 1 from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') with ordinality c(p, i),
                    lateral (select p_value -> 'products' -> (i::integer - 1) as n) x
                  where jsonb_typeof(x.n) <> 'object'
                     or (select array_agg(k order by k) from jsonb_object_keys(x.n) k) <> array['key', 'multiplier', 'name', 'premium', 'symbol']
                     or x.n -> 'key' <> c.p -> 'key' or x.n -> 'name' <> c.p -> 'name' or x.n -> 'symbol' <> c.p -> 'symbol'
                     or not app_private.json_num_between(x.n -> 'multiplier', 0.1, 20)
                     or not app_private.json_num_between(x.n -> 'premium', -10, 10)) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'risk_rules' then
    -- 风险阈值 (§12.1, §14.3): every key, whole numbers
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> array['loan_amount', 'loan_score', 'ops_count', 'ops_minutes', 'reversals', 'withdraw_ratio']
       or not app_private.json_int_between(p_value -> 'loan_amount', 1, 100000)
       or not app_private.json_int_between(p_value -> 'loan_score', 0, 1000)
       or not app_private.json_int_between(p_value -> 'withdraw_ratio', 1, 100)
       or not app_private.json_int_between(p_value -> 'reversals', 1, 100)
       or not app_private.json_int_between(p_value -> 'ops_count', 2, 100)
       or not app_private.json_int_between(p_value -> 'ops_minutes', 1, 1440) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'payout_ratio_min' then
    -- 兑付能力提示线 (§11.2): a whole percentage
    if not app_private.json_int_between(p_value, 1, 100) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key in ('loan_multiplier', 'penalty_multiplier') then
    -- fixed by the system (§14.3)
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
  else
    perform app_private.fail('INVALID_INPUT', '{"field":"key"}');
  end if;
  select value into v_before from public.settings where key = p_key for update;
  update public.settings set value = v_value, updated_by = v_me, updated_at = now() where key = p_key;
  if v_before is distinct from v_value then
    perform app_private.risk_alert('setting_change', 'settings:' || p_key, null, v_me,
      jsonb_build_object('key', p_key, 'before', v_before, 'after', v_value));
  end if;
  return jsonb_build_object('key', p_key, 'value', v_value);
end
$$;

-- public_rates as in 20261216000000_savings_interest_switch.sql, 理财 by product (§16.4): each product's latest day,
-- change and rate (wealth_products without its parameters or base, which would show the anchor).
create or replace function public.public_rates() returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select app_private.cn_date(now()) as today),
  a as (select app_private.anchor_on(today) as anchor from t),
  c as (select app_private.setting('credit_enabled') <> 'false' as enabled)
  select jsonb_build_object('credit_enabled', c.enabled,
    'savings_enabled', app_private.savings_interest_on(t.today), 'current', app_private.saving_rate_on(t.today),
    'scores', (select jsonb_agg(jsonb_build_object('score', s, 'loan', app_private.loan_rate(a.anchor, s)) order by s)
      from unnest(case when c.enabled then array[600, 750, 900, 1000] else array[600] end) s),
    'term', app_private.setting('term_rates'),
    'wealth', (select jsonb_agg(jsonb_build_object('key', p ->> 'key', 'name', p ->> 'name', 'day', p -> 'day', 'change', p -> 'change',
        'rate', p -> 'rate', 'closed', p -> 'closed') order by i)
      from jsonb_array_elements(app_private.wealth_products(t.today)) with ordinality x(p, i)))
  from t, a, c
$$;
