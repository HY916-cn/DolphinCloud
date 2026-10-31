-- Purchase cost is for the storekeeper, accountant and 银行管理员 only (PHASE-1.md §6.6). Everyone else who reads
-- products (students and tellers see listed ones) reads every column but cost; the three roles read it from product_costs.
revoke select on public.products from authenticated;
grant select (id, name, image_path, price, category, listed, stock, safety_stock, updated_at) on public.products to authenticated;

-- Runs as its owner (security_invoker off), so it reads cost; the role check decides whether any row comes back.
create view public.product_costs as
  select id, cost from public.products
  where app_private.has_role('storekeeper') or app_private.has_role('accountant') or app_private.has_role('teacher');
grant select on public.product_costs to authenticated;
