-- 出入库 (PHASE-1.md §7.9): the storekeeper stocks in or takes out several products at once, all or nothing.
-- 出库 (stock_out) takes goods off the books for a stated reason, e.g. damaged or given away; it never goes below 0.
alter table public.stock_movements drop constraint stock_movements_kind_check;
alter table public.stock_movements add constraint stock_movements_kind_check
  check (kind in ('stock_in', 'stock_out', 'sale', 'reversal'));

-- p_kind: stock_in | stock_out; p_items [{product_id, qty}] (one product in several lines is merged); p_note is the
-- 出库原因, required for stock_out. Returns {count, qty}: how many products and how many pieces moved.
create function public.stock_move(p_kind text, p_items jsonb, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('storekeeper', 'teacher');
  v_note text := nullif(trim(p_note), '');
  v_sign integer := case p_kind when 'stock_in' then 1 when 'stock_out' then -1 end;
  v_ids uuid[];
  v_qtys integer[];
  v_item record;
begin
  if v_sign is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"kind"}');
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) = 0 or exists (
       select 1 from jsonb_array_elements(p_items) e
       where coalesce(e ->> 'qty', '') !~ '^[1-9][0-9]{0,5}$'
          or coalesce(e ->> 'product_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
    perform app_private.fail('INVALID_INPUT', '{"field":"items"}');
  end if;
  if p_kind = 'stock_out' and v_note is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;

  select array_agg(product_id order by product_id), array_agg(qty order by product_id) into v_ids, v_qtys
  from (select (e ->> 'product_id')::uuid as product_id, sum((e ->> 'qty')::integer)::integer as qty
        from jsonb_array_elements(p_items) e group by 1) s;
  perform 1 from public.products where id = any(v_ids) order by id for update;

  for v_item in
    select i.product_id, i.qty, p.id, p.name, p.stock
    from unnest(v_ids, v_qtys) i(product_id, qty) left join public.products p on p.id = i.product_id
  loop
    if v_item.id is null then
      perform app_private.fail('PRODUCT_NOT_FOUND');
    end if;
    if v_sign < 0 and v_item.stock < v_item.qty then
      perform app_private.fail('OUT_OF_STOCK',
        jsonb_build_object('product_id', v_item.product_id, 'name', v_item.name, 'stock', v_item.stock));
    end if;
  end loop;

  update public.products p set stock = p.stock + v_sign * i.qty, updated_at = now()
  from unnest(v_ids, v_qtys) i(product_id, qty) where p.id = i.product_id;
  insert into public.stock_movements (product_id, kind, qty_delta, operator_id, note)
  select i.product_id, p_kind, v_sign * i.qty, v_me, v_note from unnest(v_ids, v_qtys) i(product_id, qty);
  return jsonb_build_object('count', cardinality(v_ids), 'qty', (select sum(q) from unnest(v_qtys) q));
end
$$;
grant execute on function public.stock_move(text, jsonb, text) to authenticated;
