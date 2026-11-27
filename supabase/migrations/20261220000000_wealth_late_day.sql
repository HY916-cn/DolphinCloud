-- 补登行情 (PHASE-2.md §10.10): a product's net values are append-only, so a day already worked into them (a weekday
-- taken as closed because a later close came first) cannot take a close any more. record_wealth_day refuses it with
-- WEALTH_DAY_SETTLED, the fetch skips it, and wealth_overview lists each product's weekdays taken as closed among its
-- last 30 days of net values (inferred) for the bank admin to check.

-- Whether a product's net value of a day has been worked out (the first row, the starting 1, is not).
create function app_private.wealth_settled(p_product text, p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.wealth_navs where product = p_product and day = p_day and change is not null)
$$;
revoke all on function app_private.wealth_settled(text, date) from public;

-- record_wealth_days as in 20261218000000_wealth_products.sql, leaving out the days already worked out.
create or replace function app_private.record_wealth_days(p_product text, p_source text, p_body jsonb, p_at timestamptz default now()) returns integer
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
    and not app_private.wealth_settled(p_product, d)
  on conflict do nothing;
  get diagnostics v_n = row_count;
  perform app_private.advance_wealth_navs(app_private.cn_date(p_at));
  return v_n;
end
$$;

-- record_wealth_day as in 20261218000100_wealth_product_functions.sql: after the checks of its input, ALREADY_EXISTS for a
-- day entered, then WEALTH_DAY_SETTLED ({"product","day","nav_day"}, nav_day the product's latest net value) for a day
-- worked out.
create or replace function public.record_wealth_day(p_product text, p_day date, p_change numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row public.wealth_days;
begin
  perform app_private.forbid_president();
  if not exists (select 1 from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p where p ->> 'key' = p_product) then
    perform app_private.fail('INVALID_INPUT', '{"field":"product"}');
  end if;
  if p_day is null or extract(isodow from p_day) >= 6 or app_private.wealth_ready_at(p_product, p_day) > now() then
    perform app_private.fail('INVALID_INPUT', '{"field":"day"}');
  end if;
  if p_change is null or p_change <> round(p_change, 4) or p_change not between -50 and 50 then
    perform app_private.fail('INVALID_INPUT', '{"field":"change"}');
  end if;
  if nullif(trim(p_note), '') is null or length(trim(p_note)) > 200 then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  if exists (select 1 from public.wealth_days where product = p_product and day = p_day) then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"day"}');
  end if;
  if app_private.wealth_settled(p_product, p_day) then
    perform app_private.fail('WEALTH_DAY_SETTLED', jsonb_build_object('product', p_product, 'day', p_day,
      'nav_day', (select max(day) from public.wealth_navs where product = p_product)));
  end if;
  insert into public.wealth_days (product, day, change, source, note, params, created_by)
  values (p_product, p_day, p_change, 'manual', trim(p_note), app_private.setting('wealth_params'), v_me)
  on conflict do nothing
  returning * into v_row;
  if v_row.day is null then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"day"}');
  end if;
  perform app_private.log('wealth.record', 'wealth_days:' || p_product || ':' || p_day, null, to_jsonb(v_row));
  perform app_private.advance_wealth_navs(app_private.cn_date(now()));
  return to_jsonb(v_row) - 'params';
end
$$;

-- wealth_overview as in 20261218000200_wealth_interface.sql, with each product's inferred: the weekdays among its last 30
-- days of net values that took no close (closed, or a different one), oldest first.
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
        'inferred', (select coalesce(jsonb_agg(n.day order by n.day), '[]') from public.wealth_navs n
          where n.product = k and n.day > (p ->> 'day')::date - 30 and n.change is not null and extract(isodow from n.day) <= 5
            and not exists (select 1 from public.wealth_days w where w.product = k and w.day = n.day and w.change = n.change)),
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
