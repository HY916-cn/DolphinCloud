-- Counter transactions: deposit, withdraw, purchase, reversal, student lookup, and the ledger self-check
-- (PHASE-1.md §5.4, §6.2, §6.3). Each function locks the account row first, then product rows in id order.

-- Common checks for a counter transaction, then locks and returns the account (§6.2).
create function app_private.lock_account(p_student_no text, p_me uuid) returns public.accounts
language plpgsql security definer set search_path = '' as $$
declare
  v_student public.students;
  v_account public.accounts;
begin
  select * into v_student from public.students where student_no = p_student_no;
  if not found then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  if v_student.status <> 'normal' then
    perform app_private.fail('STUDENT_INACTIVE', jsonb_build_object('status', v_student.status));
  end if;
  if v_student.user_id = p_me then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  select * into v_account from public.accounts where student_no = p_student_no for update;
  return v_account;
end
$$;

-- Sum of a {"denomination": count} object; every key must be a configured denomination.
create function app_private.cash_total(p_cash jsonb) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_total integer := 0;
  v_key text;
  v_count jsonb;
begin
  if jsonb_typeof(p_cash) is distinct from 'object' then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  for v_key, v_count in select key, value from jsonb_each(p_cash) loop
    if v_key !~ '^[0-9]{1,6}$' or jsonb_typeof(v_count) <> 'number' then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
    if not app_private.setting('denominations') @> jsonb_build_array(v_key::integer)
       or v_count::numeric < 0 or v_count::numeric <> trunc(v_count::numeric) then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
    v_total := v_total + v_key::integer * v_count::integer;
  end loop;
  return v_total;
end
$$;

-- Greedy change in the configured denominations, largest first; they always include 1 (set_setting checks).
create function app_private.make_change(p_amount integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_left integer := p_amount;
  v_note integer;
  v_change jsonb := '{}';
begin
  for v_note in select d::integer from jsonb_array_elements_text(app_private.setting('denominations')) d order by 1 desc loop
    if v_left >= v_note then
      v_change := v_change || jsonb_build_object(v_note::text, v_left / v_note);
      v_left := v_left % v_note;
    end if;
  end loop;
  return v_change;
end
$$;

-- Withdrawals of the current Asia/Shanghai day, reversed ones excluded.
create function app_private.withdrawn_today(p_student_no text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(amount), 0)::integer from public.txns
  where student_no = p_student_no and type = 'withdraw' and status = 'normal'
    and created_at >= app_private.cn_date(now())::timestamp at time zone 'Asia/Shanghai'
$$;

create function app_private.txn_result(p_txn public.txns) returns jsonb
language sql immutable as $$
  select jsonb_build_object('id', p_txn.id, 'txn_no', p_txn.txn_no, 'type', p_txn.type, 'amount', p_txn.amount,
    'balance_after', p_txn.balance_after, 'change_given', p_txn.change_given, 'created_at', p_txn.created_at)
$$;

create function public.lookup_student(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_student public.students;
begin
  select * into v_student from public.students where student_no = p_student_no;
  if not found then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  if v_student.user_id = v_me then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  return jsonb_build_object('student_no', v_student.student_no, 'name', v_student.name, 'grade', v_student.grade,
    'class_name', v_student.class_name, 'status', v_student.status,
    'balance', (select balance from public.accounts where student_no = p_student_no),
    'withdrawn_today', app_private.withdrawn_today(p_student_no));
end
$$;

create function public.deposit(p_id uuid, p_student_no text, p_denominations jsonb,
  p_offline boolean default false, p_client_created_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_account public.accounts := app_private.lock_account(p_student_no, v_me);
  v_txn public.txns;
  v_amount integer;
begin
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.txn_result(v_txn);
  end if;
  v_amount := app_private.cash_total(p_denominations);
  if v_amount <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  update public.accounts set balance = balance + v_amount, total_in = total_in + v_amount, updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, denominations,
    operator_id, device_id, offline, client_created_at)
  values (p_id, 'deposit', p_student_no, v_amount, v_amount, v_account.balance, v_amount, p_denominations,
    v_me, app_private.request_header('x-device-id'), coalesce(p_offline, false), p_client_created_at)
  returning * into v_txn;
  return app_private.txn_result(v_txn);
end
$$;

create function public.withdraw(p_id uuid, p_student_no text, p_amount integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_account public.accounts := app_private.lock_account(p_student_no, v_me);
  v_single integer := app_private.setting('withdraw_single_limit')::integer;
  v_daily integer := app_private.setting('withdraw_daily_limit')::integer;
  v_today integer;
  v_txn public.txns;
begin
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.txn_result(v_txn);
  end if;
  if p_amount is null or p_amount <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  if p_amount > v_single then
    perform app_private.fail('WITHDRAW_SINGLE_LIMIT', jsonb_build_object('limit', v_single));
  end if;
  v_today := app_private.withdrawn_today(p_student_no);
  if v_today + p_amount > v_daily then
    perform app_private.fail('WITHDRAW_DAILY_LIMIT',
      jsonb_build_object('limit', v_daily, 'remaining', greatest(v_daily - v_today, 0)));
  end if;
  if p_amount > v_account.balance then
    perform app_private.fail('INSUFFICIENT_BALANCE',
      jsonb_build_object('balance', v_account.balance, 'short', p_amount - v_account.balance));
  end if;
  update public.accounts set balance = balance - p_amount, total_out = total_out + p_amount, updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, operator_id, device_id)
  values (p_id, 'withdraw', p_student_no, p_amount, -p_amount, v_account.balance, -p_amount,
    v_me, app_private.request_header('x-device-id'))
  returning * into v_txn;
  return app_private.txn_result(v_txn);
end
$$;

-- p_items: [{"product_id": uuid, "qty": n}]; p_payment: account | cash; p_cash_received: {"10": 2} for cash.
create function public.purchase(p_id uuid, p_student_no text, p_items jsonb, p_payment text, p_cash_received jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_account public.accounts := app_private.lock_account(p_student_no, v_me);
  v_txn public.txns;
  v_ids uuid[];
  v_qtys integer[];
  v_item record;
  v_due integer := 0;
  v_received integer;
begin
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.txn_result(v_txn);
  end if;
  if p_payment is null or p_payment not in ('account', 'cash') then
    perform app_private.fail('INVALID_INPUT', '{"field":"payment"}');
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or exists (
       select 1 from jsonb_array_elements(p_items) e
       where coalesce(e ->> 'qty', '') !~ '^[1-9][0-9]{0,3}$'
          or coalesce(e ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    perform app_private.fail('INVALID_INPUT', '{"field":"items"}');
  end if;

  select array_agg(product_id order by product_id), array_agg(qty order by product_id) into v_ids, v_qtys
  from (select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'qty')::integer)::integer as qty
        from jsonb_array_elements(p_items) e group by 1) s;
  perform 1 from public.products where id = any(v_ids) order by id for update;

  for v_item in
    select i.product_id, i.qty, p.name, p.price, p.stock, p.listed
    from unnest(v_ids, v_qtys) i(product_id, qty) left join public.products p on p.id = i.product_id
    order by i.product_id
  loop
    if v_item.listed is not true then
      perform app_private.fail('PRODUCT_UNLISTED', jsonb_build_object('product_id', v_item.product_id, 'name', v_item.name));
    end if;
    if v_item.stock < v_item.qty then
      perform app_private.fail('OUT_OF_STOCK',
        jsonb_build_object('product_id', v_item.product_id, 'name', v_item.name, 'stock', v_item.stock));
    end if;
    v_due := v_due + v_item.price * v_item.qty;
  end loop;

  if p_payment = 'account' then
    if v_due > v_account.balance then
      perform app_private.fail('INSUFFICIENT_BALANCE',
        jsonb_build_object('balance', v_account.balance, 'short', v_due - v_account.balance));
    end if;
    update public.accounts set balance = balance - v_due, total_spent = total_spent + v_due, updated_at = now()
    where student_no = p_student_no returning * into v_account;
  else
    v_received := app_private.cash_total(p_cash_received);
    if v_received < v_due then
      perform app_private.fail('CASH_NOT_ENOUGH', jsonb_build_object('due', v_due, 'received', v_received));
    end if;
  end if;

  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment,
    denominations, change_given, operator_id, device_id)
  values (p_id, 'purchase', p_student_no, v_due,
    case when p_payment = 'account' then -v_due else 0 end, v_account.balance,
    case when p_payment = 'cash' then v_due else 0 end, p_payment,
    case when p_payment = 'cash' then p_cash_received end,
    case when p_payment = 'cash' then app_private.make_change(v_received - v_due) end,
    v_me, app_private.request_header('x-device-id'))
  returning * into v_txn;
  insert into public.txn_items (txn_id, product_id, name, unit_price, qty)
  select v_txn.id, p.id, p.name, p.price, i.qty from unnest(v_ids, v_qtys) i(product_id, qty) join public.products p on p.id = i.product_id;
  update public.products p set stock = p.stock - i.qty, updated_at = now()
  from unnest(v_ids, v_qtys) i(product_id, qty) where p.id = i.product_id;
  insert into public.stock_movements (product_id, kind, qty_delta, txn_id, operator_id)
  select i.product_id, 'sale', -i.qty, v_txn.id, v_me from unnest(v_ids, v_qtys) i(product_id, qty);
  return app_private.txn_result(v_txn);
end
$$;

-- p_reason: 金额录错 | 学号录错 | 业务选错 | 其他：<说明> (§6.3).
create function public.reverse_txn(p_id uuid, p_original_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'teacher');
  v_teacher boolean := app_private.has_role('teacher');
  v_orig public.txns;
  v_account public.accounts;
  v_txn public.txns;
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

  if v_orig.status <> 'normal'
     or not (v_orig.type in ('deposit', 'withdraw', 'purchase') or (v_teacher and v_orig.type = 'opening'))
     or not (v_teacher or (v_orig.operator_id = v_me and app_private.cn_date(v_orig.created_at) = app_private.cn_date(now()))) then
    perform app_private.fail('REVERSAL_NOT_ALLOWED');
  end if;
  if v_account.balance < v_orig.balance_delta then
    perform app_private.fail('REVERSAL_INSUFFICIENT_BALANCE',
      jsonb_build_object('balance', v_account.balance, 'amount', v_orig.amount));
  end if;

  update public.accounts set balance = balance - v_orig.balance_delta,
    total_in = total_in - case when v_orig.type in ('deposit', 'opening') then v_orig.amount else 0 end,
    total_out = total_out - case when v_orig.type = 'withdraw' then v_orig.amount else 0 end,
    total_spent = total_spent - case when v_orig.payment = 'account' then v_orig.amount else 0 end,
    updated_at = now()
  where student_no = v_orig.student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment,
    reversal_of, reason, operator_id, device_id)
  values (p_id, 'reversal', v_orig.student_no, v_orig.amount, -v_orig.balance_delta, v_account.balance,
    -v_orig.cash_delta, v_orig.payment, v_orig.id, p_reason, v_me, app_private.request_header('x-device-id'))
  returning * into v_txn;
  update public.txns set status = 'reversed' where id = v_orig.id;

  if v_orig.type = 'purchase' then
    perform 1 from public.products where id in (select product_id from public.txn_items where txn_id = v_orig.id)
    order by id for update;
    update public.products p set stock = p.stock + i.qty, updated_at = now()
    from public.txn_items i where i.txn_id = v_orig.id and p.id = i.product_id;
    insert into public.stock_movements (product_id, kind, qty_delta, txn_id, operator_id)
    select product_id, 'reversal', qty, v_txn.id, v_me from public.txn_items where txn_id = v_orig.id;
  end if;

  perform app_private.log('txn.reverse', 'txns:' || v_orig.id, to_jsonb(v_orig), to_jsonb(v_txn));
  return app_private.txn_result(v_txn);
end
$$;

-- Accounts and products whose stored balance or stock differs from their ledger; mismatches are logged (§5.4).
create function app_private.check_balances() returns table (kind text, key text, recorded integer, expected bigint)
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
  ) r;
  if jsonb_array_length(v_rows) > 0 then
    perform app_private.log('check.mismatch', null, null, v_rows);
  end if;
  return query select * from jsonb_to_recordset(v_rows) as x(kind text, key text, recorded integer, expected bigint);
end
$$;

grant execute on function public.lookup_student(text), public.deposit(uuid, text, jsonb, boolean, timestamptz),
  public.withdraw(uuid, text, integer), public.purchase(uuid, text, jsonb, text, jsonb),
  public.reverse_txn(uuid, uuid, text) to authenticated;
