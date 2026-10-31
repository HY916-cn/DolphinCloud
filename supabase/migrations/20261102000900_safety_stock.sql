-- 安全库存: every product has one (5 unless the storekeeper sets another), and products.low says whether the stock is
-- at or under it, so 总览 lists the products to stock in with one filter. upsert_product takes it; left out, an edit
-- keeps the product's current one.
-- low follows the stock, which is not audited either; filling in the old products is not an edit to audit.
drop trigger audit on public.products;
update public.products set safety_stock = 5 where safety_stock is null;
alter table public.products
  alter column safety_stock set default 5,
  alter column safety_stock set not null,
  add constraint products_safety_stock_check check (safety_stock >= 0),
  add column low boolean generated always as (stock <= safety_stock) stored;
grant select (low) on public.products to authenticated;
create trigger audit after insert or update or delete on public.products for each row execute function app_private.audit_row('stock', 'low', 'updated_at');

drop function public.upsert_product(uuid, text, integer, integer, text, text, boolean);
create function public.upsert_product(p_id uuid, p_name text, p_price integer, p_cost integer default null,
  p_category text default null, p_image_path text default null, p_listed boolean default null,
  p_safety_stock integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('storekeeper', 'teacher');
  v_product public.products;
begin
  if nullif(trim(p_name), '') is null or p_price is null or p_price <= 0 or p_cost < 0 or p_safety_stock < 0 then
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
grant execute on function public.upsert_product(uuid, text, integer, integer, text, text, boolean, integer) to authenticated;
