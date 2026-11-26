-- 理财六品种 (PHASE-2.md §10.10, §15, §16): the fields the counter, the student, the 理财 page and the 利率看板 read.
-- Each product says whether a close past its time is still missing (waiting); a holding reads as the counter and the
-- student see it, with the value of the open ones and their gain in all; 卖出 is sell_wealth; buy_wealth takes the
-- product before the amount; the transactions say the product: 「黄金，净值 1.0565」, 「卖出黄金，盈 +3.24 HTB」.

-- Whether a product has a weekday after its latest net value whose close may be written by now and is not known.
create function app_private.wealth_waiting(p_product text, p_after date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from generate_series(p_after + 1, app_private.cn_date(now()), interval '1 day') g
    where extract(isodow from g) <= 5 and app_private.wealth_ready_at(p_product, g::date) <= now()
      and app_private.wealth_day_change(p_product, g::date) is null)
$$;

-- wealth_products as in 20261218000100_wealth_product_functions.sql, with waiting.
create or replace function app_private.wealth_products(p_today date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(p || jsonb_build_object('day', n.day, 'nav', n.nav, 'change', n.change, 'rate', n.rate,
      'closed', n.change is not null and not exists (select 1 from public.wealth_days w where w.product = n.product and w.day = n.day),
      'waiting', app_private.wealth_waiting(p ->> 'key', n.day),
      'week_base', app_private.anchor_on(p_today) + (p ->> 'premium')::numeric,
      'day_base', app_private.day_base(app_private.anchor_on(p_today) + (p ->> 'premium')::numeric)) order by i), '[]')
  from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') with ordinality x(p, i)
    left join lateral app_private.wealth_nav_on(p ->> 'key', p_today) n on true
$$;

-- A holding as the counter and the student read it: id, product and its name, principal, the net value bought at, when
-- it was bought, its value (open: now; closed: what was paid back), the day it may be sold, status and the day it
-- closed, what came back (0.01 HTB, closed ones); one bought for a term adds weeks, tier_name, multiplier, matures_on.
drop function app_private.wealth_holding(public.wealth_holdings);
create function app_private.wealth_item(p_hold public.wealth_holdings) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', p_hold.id, 'product', p_hold.product,
      'name', (select p ->> 'name' from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p where p ->> 'key' = p_hold.product),
      'principal', p_hold.principal, 'buy_nav', p_hold.buy_nav, 'bought_at', (select created_at from public.txns where id = p_hold.open_txn),
      'value_centi', p_hold.value_centi, 'gain_centi', p_hold.value_centi - 100 * p_hold.principal, 'sellable_on', p_hold.opened_on + 1,
      'status', p_hold.status, 'closed_on', p_hold.closed_on,
      'returned_centi', case when p_hold.status in ('redeemed', 'matured') then p_hold.value_centi end)
    || case when p_hold.weeks is not null then jsonb_build_object('weeks', p_hold.weeks, 'tier_name', p_hold.tier_name,
      'multiplier', p_hold.multiplier, 'matures_on', p_hold.matures_on) else '{}' end
$$;

-- A student's 理财: every holding but the void, newest first, and the open ones' value and gain (0.01 HTB).
create function app_private.wealth_account(p_student_no text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'value_centi', coalesce(sum(h.value_centi) filter (where h.status = 'open'), 0),
    'gain_centi', coalesce(sum(h.value_centi - 100 * h.principal) filter (where h.status = 'open'), 0),
    'holdings', coalesce(jsonb_agg(app_private.wealth_item(h) order by h.opened_on desc, h.id) filter (where h.status <> 'reversed'), '[]'))
  from public.wealth_holdings h where h.student_no = p_student_no
$$;

create or replace function app_private.wealth_result(p_hold public.wealth_holdings, p_txn uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.txn_result(t) || jsonb_build_object('holding', app_private.wealth_item(p_hold)) from public.txns t where t.id = p_txn
$$;

-- Each product as the counter and the student read it: latest net value and its day, that day's rate, waiting.
create function app_private.wealth_quote_products(p_today date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', p ->> 'key', 'name', p ->> 'name', 'nav', p -> 'nav', 'nav_day', p -> 'day',
      'change', p -> 'rate', 'waiting', p -> 'waiting') order by i), '[]')
  from jsonb_array_elements(app_private.wealth_products(p_today)) with ordinality x(p, i)
$$;

-- 柜台「理财」 (§16.1): each product, the student's 活期, 理财本金, the open holdings' value and gain, and the holdings.
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
  return (select jsonb_build_object('student_no', p_student_no, 'today', v_today, 'products', app_private.wealth_quote_products(v_today),
      'balance', a.balance, 'wealth_total', a.wealth_total) || app_private.wealth_account(p_student_no)
    from public.accounts a where a.student_no = p_student_no);
end
$$;

-- 学生「我的理财」 (§16.3): the same as the counter's, for the student's own account.
create function public.my_wealth() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_no text := app_private.my_student_no();
  v_today date := app_private.cn_date(now());
begin
  if v_no is null then
    perform app_private.fail('FORBIDDEN', '{"roles":["student"]}', '42501');
  end if;
  return jsonb_build_object('student_no', v_no, 'today', v_today, 'products', app_private.wealth_quote_products(v_today),
    'wealth_total', (select wealth_total from public.accounts where student_no = v_no)) || app_private.wealth_account(v_no);
end
$$;
grant execute on function public.my_wealth() to authenticated;

-- 买入 as in 20261218000000_wealth_products.sql, the wealth_buy saying「黄金，净值 1.0565」.
create or replace function app_private.start_wealth(p_id uuid, p_student_no text, p_amount integer, p_product text,
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
      || '，净值 ' || to_char(round(v_nav.nav, 4), 'FM9999990.0000'),
    p_operator, app_private.request_header('x-device-id'), p_id, p_at);
  return v_hold;
end
$$;

-- 卖出 or 到期 as in 20261218000000_wealth_products.sql, a 卖出 saying the product:「卖出黄金，盈 +3.24 HTB」.
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
    case p_status when 'matured' then '到期'
      else '卖出' || (select p ->> 'name' from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p where p ->> 'key' = v_hold.product) end
    || '，' || case sign(v_gain) when 0 then '持平'
      else case when v_gain > 0 then '盈 +' else '亏 −' end || to_char(abs(v_gain) / 100.0, 'FM999999990.00') || ' HTB' end,
    p_operator, app_private.request_header('x-device-id'), v_hold.id, p_at)
  returning * into v_txn;
  update public.wealth_holdings set status = p_status, close_txn = v_txn.id where id = p_id;
  -- M14 货币监控：理财的盈利计为新增发行，亏损计为回收（§9.6）
  return v_txn;
end
$$;

-- 买入 with the product before the amount, as in 20261218000100_wealth_product_functions.sql otherwise.
drop function public.buy_wealth(uuid, text, integer, text);
create function public.buy_wealth(p_id uuid, p_student_no text, p_product text, p_amount integer) returns jsonb
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
grant execute on function public.buy_wealth(uuid, text, text, integer) to authenticated;

-- 卖出 (§10.10), as redeem_wealth in 20261218000100_wealth_product_functions.sql; a holding sold already returns its
-- 卖出 again (p_holding_id is the key), matured or void is INVALID_INPUT.
drop function public.redeem_wealth(uuid);
create function public.sell_wealth(p_holding_id uuid) returns jsonb
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
grant execute on function public.sell_wealth(uuid) to authenticated;

-- 后台「理财」 (§16.2) by product: wealth_params; each product's latest net value (nav, nav_day, change: that day's
-- rate, waiting), its holdings open (count, principal, value_centi), its weekdays to enter (missing) and its days (as in
-- 20261218000100_wealth_product_functions.sql: change the close's, rate and nav the day's); the holdings bought for a
-- term (term) and every holding open (open).
create or replace function public.wealth_overview(p_before date default null, p_limit integer default 30) returns jsonb
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
    'products', (select jsonb_agg(jsonb_build_object('key', k, 'name', p ->> 'name', 'nav', p -> 'nav', 'nav_day', p -> 'day',
        'change', p -> 'rate', 'waiting', p -> 'waiting') || (
        select jsonb_build_object('count', count(*), 'principal', coalesce(sum(principal), 0), 'value_centi', coalesce(sum(value_centi), 0))
          from public.wealth_holdings where status = 'open' and product = k) || jsonb_build_object(
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
    'term', (select jsonb_build_object('count', count(*), 'principal', coalesce(sum(principal), 0), 'value_centi', coalesce(sum(value_centi), 0))
      from public.wealth_holdings where status = 'open' and weeks is not null),
    'open', (select jsonb_build_object('count', count(*), 'principal', coalesce(sum(principal), 0), 'value_centi', coalesce(sum(value_centi), 0))
      from public.wealth_holdings where status = 'open'));
end
$$;

-- public_rates as in 20261218000100_wealth_product_functions.sql, with today; each product's latest day, rate and closed.
create or replace function public.public_rates() returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select app_private.cn_date(now()) as today),
  a as (select app_private.anchor_on(today) as anchor from t),
  c as (select app_private.setting('credit_enabled') <> 'false' as enabled)
  select jsonb_build_object('today', t.today, 'credit_enabled', c.enabled,
    'savings_enabled', app_private.savings_interest_on(t.today), 'current', app_private.saving_rate_on(t.today),
    'scores', (select jsonb_agg(jsonb_build_object('score', s, 'loan', app_private.loan_rate(a.anchor, s)) order by s)
      from unnest(case when c.enabled then array[600, 750, 900, 1000] else array[600] end) s),
    'term', app_private.setting('term_rates'),
    'wealth', (select jsonb_agg(jsonb_build_object('key', p ->> 'key', 'name', p ->> 'name', 'day', p -> 'day',
        'rate', p -> 'rate', 'closed', p -> 'closed') order by i)
      from jsonb_array_elements(app_private.wealth_products(t.today)) with ordinality x(p, i)))
  from t, a, c
$$;
