-- 商品价格 (PHASE-1.md §6.7): 1 to 1,000,000 HTB, INVALID_INPUT {"field":"price","min":1,"max":1000000} otherwise; a
-- 兑换's total adds up in bigint, so a large order is INSUFFICIENT_BALANCE or CASH_NOT_ENOUGH (both keep it within an
-- integer before it is written), never an integer overflow.

-- Products already priced above the limit keep their price until edited.

-- upsert_product as in 20261102000900_safety_stock.sql, with the price's own check.
create or replace function public.upsert_product(p_id uuid, p_name text, p_price integer, p_cost integer default null,
  p_category text default null, p_image_path text default null, p_listed boolean default null,
  p_safety_stock integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('storekeeper', 'teacher');
  v_product public.products;
begin
  if p_price is null or p_price not between 1 and 1000000 then
    perform app_private.fail('INVALID_INPUT', '{"field":"price","min":1,"max":1000000}');
  end if;
  if nullif(trim(p_name), '') is null or p_cost < 0 or p_safety_stock < 0 then
    perform app_private.fail('INVALID_INPUT', '{"field":"product"}');
  end if;
  if p_listed is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"listed"}');
  end if;
  if p_id is null then
    insert into public.products (name, price, cost, category, image_path, listed, safety_stock)
    values (trim(p_name), p_price, p_cost, p_category, p_image_path, p_listed, coalesce(p_safety_stock, 5))
    returning * into v_product;
  else
    update public.products set name = trim(p_name), price = p_price, cost = p_cost, category = p_category,
      image_path = p_image_path, listed = p_listed, safety_stock = coalesce(p_safety_stock, safety_stock), updated_at = now()
    where id = p_id returning * into v_product;
    if not found then
      perform app_private.fail('PRODUCT_NOT_FOUND');
    end if;
  end if;
  return to_jsonb(v_product);
end
$$;

-- purchase as in 20261102000400_rpc_fixes.sql, the total in bigint.
create or replace function public.purchase(p_id uuid, p_student_no text, p_items jsonb, p_payment text, p_cash_received jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_account public.accounts := app_private.lock_account(p_student_no, v_me);
  v_txn public.txns;
  v_ids uuid[];
  v_qtys integer[];
  v_item record;
  v_due bigint := 0;
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
    select i.product_id, i.qty, p.id, p.name, p.price, p.stock, p.listed
    from unnest(v_ids, v_qtys) i(product_id, qty) left join public.products p on p.id = i.product_id
    order by i.product_id
  loop
    if v_item.id is null then
      perform app_private.fail('PRODUCT_NOT_FOUND', jsonb_build_object('product_id', v_item.product_id));
    end if;
    if not v_item.listed then
      perform app_private.fail('PRODUCT_UNLISTED', jsonb_build_object('product_id', v_item.product_id, 'name', v_item.name));
    end if;
    if v_item.stock < v_item.qty then
      perform app_private.fail('OUT_OF_STOCK',
        jsonb_build_object('product_id', v_item.product_id, 'name', v_item.name, 'stock', v_item.stock));
    end if;
    v_due := v_due + v_item.price::bigint * v_item.qty;
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
    case when p_payment = 'cash' then app_private.make_change((v_received - v_due)::integer) end,
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

-- manual_post as in 20261127000100_manual_entry_functions.sql, the amount and its change to 活期 in bigint.
create or replace function app_private.manual_post(p_id uuid, p_student_no text, p_type text, p_amount integer, p_payment text,
  p_denominations jsonb, p_items jsonb, p_at timestamptz, p_reason text, p_corrects uuid, p_me uuid) returns public.txns
language plpgsql security definer set search_path = '' as $$
declare
  v_account public.accounts;
  v_txn public.txns;
  v_amount bigint;
  v_delta bigint;
  v_cash integer := 0;
  v_notes jsonb;
  v_change jsonb;
  v_ids uuid[];
  v_qtys integer[];
  v_item record;
begin
  if p_type is null or p_type not in ('deposit', 'withdraw', 'purchase', 'adjust') then
    perform app_private.fail('INVALID_INPUT', '{"field":"type"}');
  end if;
  if p_type = 'deposit' then
    v_amount := app_private.cash_total(p_denominations);
    if v_amount <= 0 then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
    v_delta := v_amount;
    v_cash := v_amount;
    v_notes := p_denominations;
  elsif p_type = 'withdraw' then
    if p_amount is null or p_amount <= 0 or p_denominations is not null and app_private.cash_total(p_denominations) <> p_amount then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
    v_amount := p_amount;
    v_delta := -p_amount;
    v_cash := -p_amount;
    v_notes := coalesce(p_denominations, app_private.make_change(p_amount));
  elsif p_type = 'adjust' then
    if p_amount is null or p_amount = 0 or abs(p_amount) > 100000 then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
    v_amount := abs(p_amount);
    v_delta := p_amount;
  else
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
    v_amount := 0;
    for v_item in
      select i.product_id, i.qty, p.id, p.name, p.price, p.stock
      from unnest(v_ids, v_qtys) i(product_id, qty) left join public.products p on p.id = i.product_id
      order by i.product_id
    loop
      if v_item.id is null then
        perform app_private.fail('PRODUCT_NOT_FOUND', jsonb_build_object('product_id', v_item.product_id));
      end if;
      if v_item.stock < v_item.qty then
        perform app_private.fail('OUT_OF_STOCK',
          jsonb_build_object('product_id', v_item.product_id, 'name', v_item.name, 'stock', v_item.stock));
      end if;
      v_amount := v_amount + v_item.price::bigint * v_item.qty;
    end loop;
    if p_payment = 'account' then
      v_delta := -v_amount;
    else
      v_delta := 0;
      v_cash := app_private.cash_total(p_denominations);
      if v_cash < v_amount then
        perform app_private.fail('CASH_NOT_ENOUGH', jsonb_build_object('due', v_amount, 'received', v_cash));
      end if;
      v_notes := p_denominations;
      v_change := app_private.make_change((v_cash - v_amount)::integer);
      v_cash := v_amount;
    end if;
  end if;

  select * into v_account from public.accounts where student_no = p_student_no;
  if v_account.balance + v_delta < 0 then
    perform app_private.fail('INSUFFICIENT_BALANCE',
      jsonb_build_object('balance', v_account.balance, 'short', -(v_account.balance + v_delta)));
  end if;
  update public.accounts set balance = balance + v_delta,
    total_in = total_in + case when p_type = 'deposit' then v_amount else 0 end,
    total_out = total_out + case when p_type = 'withdraw' then v_amount else 0 end,
    total_spent = total_spent + case when p_type = 'purchase' and p_payment = 'account' then v_amount else 0 end,
    updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment, denominations,
    change_given, reason, operator_id, device_id, created_at, entered_at, corrects)
  values (p_id, p_type::public.txn_type, p_student_no, v_amount, v_delta, v_account.balance, v_cash,
    case when p_type = 'purchase' then p_payment end, v_notes, v_change, p_reason, p_me,
    app_private.request_header('x-device-id'), p_at, now(), p_corrects)
  returning * into v_txn;
  if p_type = 'purchase' then
    insert into public.txn_items (txn_id, product_id, name, unit_price, qty)
    select v_txn.id, p.id, p.name, p.price, i.qty from unnest(v_ids, v_qtys) i(product_id, qty) join public.products p on p.id = i.product_id;
    update public.products p set stock = p.stock - i.qty, updated_at = now()
    from unnest(v_ids, v_qtys) i(product_id, qty) where p.id = i.product_id;
    insert into public.stock_movements (product_id, kind, qty_delta, txn_id, operator_id, created_at)
    select i.product_id, 'sale', -i.qty, v_txn.id, p_me, p_at from unnest(v_ids, v_qtys) i(product_id, qty);
  end if;
  return v_txn;
end
$$;
