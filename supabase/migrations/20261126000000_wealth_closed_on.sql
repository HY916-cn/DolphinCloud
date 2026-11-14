-- 理财的结束日期 (PHASE-2.md §14.2, §15): the counter reads no txns, so each holding carries closed_on, the day (Asia/
-- Shanghai) its wealth_close is dated: the day of a 赎回, the day after its last one for a maturity (dated the next
-- midnight). It is null while the holding is open, again after a 赎回 is reversed. wealth_quote's holdings carry it.

alter table public.wealth_holdings add column closed_on date;

-- closed_on follows close_txn, whatever writes it (end_wealth, reverse_txn).
create function app_private.wealth_closed_on() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.closed_on := (select app_private.cn_date(created_at) from public.txns where id = new.close_txn);
  return new;
end
$$;
create trigger closed_on before insert or update of close_txn on public.wealth_holdings
for each row execute function app_private.wealth_closed_on();

update public.wealth_holdings h set closed_on = app_private.cn_date(t.created_at) from public.txns t where t.id = h.close_txn;
