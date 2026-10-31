-- Input fixes: a purchase of an unknown product says PRODUCT_NOT_FOUND; cash counts are bounded so huge counts are
-- INVALID_AMOUNT instead of an integer overflow; upsert_product needs p_listed, so an edit that leaves it out cannot
-- take a product off sale.

-- Sum of a {"denomination": count} object; every key must be a configured denomination. Counts are 0–100000 and the
-- total at most 10000000, enough for a currency issue (register_issue uses it too) and far below integer overflow.
create or replace function app_private.cash_total(p_cash jsonb) returns integer
language plpgsql stable security definer set search_path = '' as $$
declare
  v_total bigint := 0;
  v_key text;
  v_count jsonb;
begin
  if jsonb_typeof(p_cash) is distinct from 'object' then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  for v_key, v_count in select key, value from jsonb_each(p_cash) loop
    if v_key !~ '^[0-9]{1,6}$' or not app_private.json_int_between(v_count, 0, 100000)
       or not app_private.setting('denominations') @> jsonb_build_array(v_key::integer) then
      perform app_private.fail('INVALID_AMOUNT');
    end if;
    v_total := v_total + v_key::bigint * v_count::bigint;
  end loop;
  if v_total > 10000000 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  return v_total;
end
$$;

-- p_items: [{"product_id": uuid, "qty": n}]; p_payment: account | cash; p_cash_received: {"10": 2} for cash.
create or replace function public.purchase(p_id uuid, p_student_no text, p_items jsonb, p_payment text, p_cash_received jsonb default null)
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

-- p_id null creates a product; stock changes only through stock_in and transactions. p_listed is required.
create or replace function public.upsert_product(p_id uuid, p_name text, p_price integer, p_cost integer default null,
  p_category text default null, p_image_path text default null, p_listed boolean default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('storekeeper', 'teacher');
  v_product public.products;
begin
  if nullif(trim(p_name), '') is null or p_price is null or p_price <= 0 or p_cost < 0 then
    perform app_private.fail('INVALID_INPUT', '{"field":"product"}');
  end if;
  if p_listed is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"listed"}');
  end if;
  if p_id is null then
    insert into public.products (name, price, cost, category, image_path, listed)
    values (trim(p_name), p_price, p_cost, p_category, p_image_path, p_listed)
    returning * into v_product;
  else
    update public.products set name = trim(p_name), price = p_price, cost = p_cost, category = p_category,
      image_path = p_image_path, listed = p_listed, updated_at = now()
    where id = p_id returning * into v_product;
    if not found then
      perform app_private.fail('PRODUCT_NOT_FOUND');
    end if;
  end if;
  return to_jsonb(v_product);
end
$$;
