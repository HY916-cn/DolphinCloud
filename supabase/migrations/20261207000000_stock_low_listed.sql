-- 库存不足 (PHASE-2.md §12.1) as 总览 lists it: a listed product at or under its 安全库存. app_private.risk_stock
-- (20261204000000_risk_alerts.sql) records one when a product becomes so: created so, listed so, its stock falling or
-- its 安全库存 rising. The products already so and without an open alert get one now. Running the file again changes
-- nothing (38_stock_low_listed.sql does).
drop trigger if exists risk_alert on public.products;
create or replace trigger risk_alert_insert after insert on public.products for each row when (new.listed and new.low)
  execute function app_private.risk_stock();
create or replace trigger risk_alert_update after update on public.products for each row
  when (new.listed and new.low and not (old.listed and old.low))
  execute function app_private.risk_stock();

select app_private.risk_alert('stock_low', 'products:' || p.id, null, null,
  jsonb_build_object('name', p.name, 'stock', p.stock, 'safety_stock', p.safety_stock))
from public.products p
where p.listed and p.low
  and not exists (select 1 from public.risk_alerts a where a.kind = 'stock_low' and a.target = 'products:' || p.id and a.status = 'open')
order by p.name;
