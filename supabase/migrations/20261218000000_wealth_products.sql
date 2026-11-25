-- 理财六品种 (PHASE-2.md §10.10, §14.3): 国债, 黄金, 沪深 300, 创业板指, 恒生指数 and 纳斯达克 100, each with a net value
-- (净值) every calendar day from the day before this migration (1). A day's rate = the daily base of (that week's anchor
-- + the product's premium) + multiplier × the product's change that day, within ±cap; a closed day takes the base alone.
-- A holding is bought and sold at the product's latest net value, sellable from the day after it is bought (T+1), with
-- no term. The holdings bought for a term keep their length, tier and locked parameters (every one of them already on the
-- row) and go on by 沪深 300 to maturity; none are opened any more. The closes on record are 沪深 300's.

-- wealth_params: the six products; cap fixed; multiplier and premium per product (§14.3).
update public.settings set value = '{"cap":20,"products":[
  {"key":"bond","name":"国债","symbol":"sh000012","multiplier":10,"premium":0.25},
  {"key":"gold","name":"黄金","symbol":"sh518880","multiplier":1,"premium":1.75},
  {"key":"csi300","name":"沪深 300","symbol":"sh000300","multiplier":2,"premium":2},
  {"key":"chinext","name":"创业板指","symbol":"sz399006","multiplier":1,"premium":2},
  {"key":"hsi","name":"恒生指数","symbol":"hkHSI","multiplier":2,"premium":2},
  {"key":"ndx","name":"纳斯达克 100","symbol":"us.NDX","multiplier":2,"premium":2}]}'
where key = 'wealth_params';

-- 行情 by product: the closes on record are 沪深 300's.
alter table public.wealth_days add column product text not null default 'csi300'
  check (product in ('bond', 'gold', 'csi300', 'chinext', 'hsi', 'ndx'));
alter table public.wealth_days alter column product drop default;
alter table public.wealth_days drop constraint wealth_days_pkey, add primary key (product, day);

-- 净值: one row a product a calendar day, append-only. The first row of each (the day before this migration) is 1 with
-- no change or rate; each later one keeps what it was worked out from.
create table public.wealth_navs (
  product    text not null check (product in ('bond', 'gold', 'csi300', 'chinext', 'hsi', 'ndx')),
  day        date not null,
  change     numeric(10,4),                   -- 涨跌（百分数），休市为 0
  anchor     numeric(8,4),                    -- 当周锚点
  premium    numeric(8,4),                    -- 当时的基准加成
  multiplier numeric(8,4),                    -- 当时的倍率
  rate       numeric(8,4),                    -- 当天收益率（百分数）
  nav        numeric(12,6) not null,
  created_at timestamptz not null default now(),
  primary key (product, day)
);
create trigger append_only before update or delete on public.wealth_navs for each row execute function app_private.append_only();
alter table public.wealth_navs enable row level security;
grant select on public.wealth_navs to authenticated;
create policy read on public.wealth_navs for select to authenticated using (true);
insert into public.wealth_navs (product, day, nav)
select p ->> 'key', app_private.cn_date(now()) - 1, 1 from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p;

-- Holdings: a product and the net value bought at; a holding bought for a term has weeks, matures_on and its tier.
alter table public.wealth_holdings add column product text not null default 'csi300'
  check (product in ('bond', 'gold', 'csi300', 'chinext', 'hsi', 'ndx'));
alter table public.wealth_holdings alter column product drop default;
alter table public.wealth_holdings add column buy_nav numeric(12,6) check (buy_nav > 0);
alter table public.wealth_holdings alter column weeks drop not null, alter column matures_on drop not null,
  alter column tier drop not null, alter column tier_name drop not null, alter column multiplier drop not null,
  alter column factor drop not null, alter column base drop not null, alter column min_rate drop not null,
  alter column max_rate drop not null;
alter table public.wealth_holdings add constraint wealth_holdings_kind check (case when buy_nav is null
  then weeks is not null and matures_on is not null and tier is not null and tier_name is not null and multiplier is not null
    and factor is not null and base is not null and min_rate is not null and max_rate is not null
  else weeks is null and matures_on is null and tier is null end);

-- When a product's close of a day may be written (Asia/Shanghai): A shares 15:30, 恒生指数 16:40, 纳斯达克 100 (a US
-- date) 06:00 the next morning.
create function app_private.wealth_ready_at(p_product text, p_day date) returns timestamptz
language sql stable as $$
  select (p_day + case p_product when 'ndx' then 1 else 0 end
    + case p_product when 'hsi' then time '16:40' when 'ndx' then time '06:00' else time '15:30' end) at time zone 'Asia/Shanghai'
$$;

-- A product's change on a day: its close when it has one; 0 on a weekend, and on a weekday with none when a later
-- trading day of the product has one (closed); null while not known yet.
drop function app_private.wealth_day_change(date);
create function app_private.wealth_day_change(p_product text, p_day date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select change from public.wealth_days where product = p_product and day = p_day),
    case when extract(isodow from p_day) >= 6 or exists (select 1 from public.wealth_days where product = p_product and day > p_day) then 0 end)
$$;

-- Brings the open holdings bought at a net value (one, or all) to their product's latest: the value principal × net
-- value ÷ the net value bought at, to 0.01 HTB.
create function app_private.revalue_wealth(p_id uuid default null) returns void
language sql security definer set search_path = '' as $$
  update public.wealth_holdings h set value_centi = round(100 * h.principal * n.nav / h.buy_nav)::integer, valued_to = n.day + 1
  from (select distinct on (product) product, day, nav from public.wealth_navs order by product, day desc) n
  where h.product = n.product and h.status = 'open' and h.buy_nav is not null and h.valued_to <> n.day + 1
    and (p_id is null or h.id = p_id)
$$;

-- 计入净值 (§10.10): for each product, every day up to p_today whose change is known, in order; a day not known yet holds
-- that product's later days. A day waits for its week's anchor: run_weekly of its Monday is done. Then the holdings.
-- Returns the days added.
create function app_private.advance_wealth_navs(p_today date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_params jsonb := app_private.setting('wealth_params');
  v_weekly date := (select done_to from public.job_runs where job = 'weekly');
  v_cap numeric := (v_params ->> 'cap')::numeric;
  v_prod jsonb;
  v_last public.wealth_navs;
  v_day date;
  v_change numeric;
  v_anchor numeric;
  v_rate numeric;
  v_n integer := 0;
begin
  perform pg_advisory_xact_lock(hashtext('app_private.advance_wealth_navs'));
  for v_prod in select p from jsonb_array_elements(v_params -> 'products') p loop
    select * into v_last from public.wealth_navs where product = v_prod ->> 'key' order by day desc limit 1;
    continue when not found;
    loop
      v_day := v_last.day + 1;
      exit when v_day > p_today or date_trunc('week', v_day)::date > v_weekly;
      v_change := app_private.wealth_day_change(v_prod ->> 'key', v_day);
      exit when v_change is null;
      v_anchor := app_private.anchor_on(v_day);
      v_rate := least(v_cap, greatest(-v_cap, round(app_private.day_base(v_anchor + (v_prod ->> 'premium')::numeric)
        + (v_prod ->> 'multiplier')::numeric * v_change, 4)));
      insert into public.wealth_navs (product, day, change, anchor, premium, multiplier, rate, nav)
      values (v_prod ->> 'key', v_day, v_change, v_anchor, (v_prod ->> 'premium')::numeric, (v_prod ->> 'multiplier')::numeric,
        v_rate, round(v_last.nav * (1 + v_rate / 100), 6))
      returning * into v_last;
      v_n := v_n + 1;
    end loop;
  end loop;
  perform app_private.revalue_wealth();
  return v_n;
end
$$;

-- A product's latest net value on or before a day.
create function app_private.wealth_nav_on(p_product text, p_day date) returns public.wealth_navs
language sql stable security definer set search_path = '' as $$
  select * from public.wealth_navs where product = p_product and day <= p_day order by day desc limit 1
$$;

-- A product's daily closes from a source, as dolphin jobs fetch hands them over (the body as the source sends it): each
-- trading day with the one before it in the list gets a row, unless it has one, once its close may be written
-- (wealth_ready_at). Tencent: data.<symbol>.day (qfqday for an ETF) of [day, open, close, …]; Sina: [{day, close, …}];
-- eastmoney: data.klines of "day,close". Then the net values. Returns the days added.
drop function app_private.record_wealth_days(text, jsonb, timestamptz);
create function app_private.record_wealth_days(p_product text, p_source text, p_body jsonb, p_at timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_params jsonb := app_private.setting('wealth_params');
  v_symbol text := (select p ->> 'symbol' from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p where p ->> 'key' = p_product);
  v_rows jsonb;
  v_n integer;
begin
  if v_symbol is null then
    raise exception 'no product %', p_product;
  end if;
  v_rows := case p_source
    when 'tencent' then (select jsonb_agg(jsonb_build_array(e ->> 0, e ->> 2))
      from jsonb_array_elements(coalesce(p_body -> 'data' -> v_symbol -> 'day', p_body -> 'data' -> v_symbol -> 'qfqday')) e)
    when 'sina' then (select jsonb_agg(jsonb_build_array(left(e ->> 'day', 10), e ->> 'close')) from jsonb_array_elements(p_body) e)
    when 'eastmoney' then (select jsonb_agg(jsonb_build_array(split_part(e #>> '{}', ',', 1), split_part(e #>> '{}', ',', 2)))
      from jsonb_array_elements(p_body -> 'data' -> 'klines') e)
  end;
  if jsonb_typeof(v_rows) is distinct from 'array' then
    raise exception 'no daily closes of % from %', p_product, p_source;
  end if;
  insert into public.wealth_days (product, day, close, prev_close, change, source, params)
  select p_product, d, c, pc, round(100 * c / pc - 100, 4), p_source, v_params
  from (select d, c, lag(c) over (order by d) as pc
        from (select (e ->> 0)::date as d, (e ->> 1)::numeric as c from jsonb_array_elements(v_rows) e) k) x
  where pc is not null and app_private.wealth_ready_at(p_product, d) <= p_at and c > 0 and pc > 0
  on conflict do nothing;
  get diagnostics v_n = row_count;
  perform app_private.advance_wealth_navs(app_private.cn_date(p_at));
  return v_n;
end
$$;

-- 按期限买入的理财 by the end of p_day, as in 20261125000000_wealth_daily.sql, by 沪深 300's closes.
create or replace function app_private.value_wealth(p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_all integer := 0;
begin
  loop
    update public.wealth_holdings h set value_centi = round(h.value_centi * (100 + app_private.holding_rate(h, x.change)) / 100)::integer,
      valued_to = h.valued_to + 1
    from (select id, app_private.wealth_day_change('csi300', valued_to) as change from public.wealth_holdings
          where status = 'open' and weeks is not null and valued_to <= p_day and valued_to <= matures_on) x
    where h.id = x.id and x.change is not null;
    get diagnostics v_n = row_count;
    exit when v_n = 0;
    v_all := v_all + v_n;
  end loop;
  return v_all;
end
$$;

-- 买入 (§10.10) at p_at: the product's latest net value then; sellable from the next day (starts_on). The wealth_buy
-- says「沪深 300，净值 1.012345」.
drop function app_private.start_wealth(uuid, text, integer, integer, text, uuid, timestamptz);
create function app_private.start_wealth(p_id uuid, p_student_no text, p_amount integer, p_product text,
  p_operator uuid, p_at timestamptz) returns public.wealth_holdings
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := app_private.cn_date(p_at);
  v_nav public.wealth_navs := app_private.wealth_nav_on(p_product, app_private.cn_date(p_at));
  v_txn uuid := gen_random_uuid();
  v_account public.accounts;
  v_hold public.wealth_holdings;
begin
  update public.accounts set balance = balance - p_amount, wealth_total = wealth_total + p_amount, updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.wealth_holdings (id, student_no, principal, product, buy_nav, opened_on, starts_on, value_centi, valued_to, open_txn)
  values (p_id, p_student_no, p_amount, p_product, v_nav.nav, v_day, v_day + 1, 100 * p_amount, v_nav.day + 1, v_txn)
  returning * into v_hold;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id, wealth_id, created_at)
  values (v_txn, 'wealth_buy', p_student_no, p_amount, -p_amount, v_account.balance,
    (select p ->> 'name' from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p where p ->> 'key' = p_product)
      || '，净值 ' || to_char(v_nav.nav, 'FM9999990.000000'),
    p_operator, app_private.request_header('x-device-id'), p_id, p_at);
  return v_hold;
end
$$;

-- 卖出 or 到期 as in 20261120000200_wealth.sql: a holding bought at a net value first comes to its product's latest;
-- the wealth_close says 卖出 or 到期 and the gain.
create or replace function app_private.end_wealth(p_id uuid, p_status text, p_operator uuid, p_at timestamptz) returns public.txns
language plpgsql security definer set search_path = '' as $$
declare
  v_hold public.wealth_holdings;
  v_account public.accounts;
  v_paid integer;
  v_gain integer;
  v_txn public.txns;
begin
  select * into v_account from public.accounts where student_no = (select student_no from public.wealth_holdings where id = p_id) for update;
  perform app_private.revalue_wealth(p_id);
  select * into v_hold from public.wealth_holdings where id = p_id for update;
  if v_hold.status is distinct from 'open' then
    return null;
  end if;
  v_paid := (v_account.interest_carry + v_hold.value_centi) / 100;
  v_gain := v_hold.value_centi - 100 * v_hold.principal;
  update public.accounts set balance = balance + v_paid, wealth_total = wealth_total - v_hold.principal,
    interest_carry = (interest_carry + v_hold.value_centi) % 100, updated_at = now()
  where student_no = v_hold.student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id, wealth_id, created_at)
  values (gen_random_uuid(), 'wealth_close', v_hold.student_no, v_paid, v_paid, v_account.balance,
    case p_status when 'matured' then '到期' else '卖出' end || '，' || case sign(v_gain) when 0 then '持平'
      else case when v_gain > 0 then '盈 +' else '亏 −' end || to_char(abs(v_gain) / 100.0, 'FM999999990.00') || ' HTB' end,
    p_operator, app_private.request_header('x-device-id'), v_hold.id, p_at)
  returning * into v_txn;
  update public.wealth_holdings set status = p_status, close_txn = v_txn.id where id = p_id;
  -- M14 货币监控：理财的盈利计为新增发行，亏损计为回收（§9.6）
  return v_txn;
end
$$;

drop function app_private.tier_rate(jsonb, integer, jsonb, numeric);
drop function app_private.wealth_recent(integer);
