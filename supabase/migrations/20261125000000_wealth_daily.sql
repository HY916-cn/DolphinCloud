-- 理财按天 (PHASE-2.md §10.10, PRODUCT.md 5.2): a holding's value moves every calendar day from the day after it is
-- bought. A day's rate is the daily base, (1 + weekly base)^(1/7) − 1, plus multiplier × factor × the index's change
-- that day, within the tier's daily bounds. The index is a Chinese one (沪深 300 by default); on a day the market is
-- closed (weekends and Chinese holidays) only the base counts. No holiday table: a weekday is closed when a later
-- trading day's close is in and it has none. A trading day's close waits for the fetch, or for the bank admin to enter
-- it, and the holdings that need it wait with it. Nobody holds 理财 yet, so the weekly table makes way for a daily one.

drop table public.wealth_weeks;
create table public.wealth_days (             -- 每个开盘日的指数行情
  day        date primary key,
  close      numeric(14,4),                   -- 收盘价；手动登记时为空
  prev_close numeric(14,4),                   -- 上一个开盘日的收盘价
  change     numeric(10,4) not null,          -- 当天涨跌（百分数）
  source     text not null check (source in ('tencent', 'sina', 'eastmoney', 'manual')),
  note       text,                            -- 手动登记的说明
  params     jsonb not null,                  -- wealth_params at the time
  created_by uuid references public.profiles(id), -- 登记人
  created_at timestamptz not null default now()
);
create trigger append_only before update or delete on public.wealth_days for each row execute function app_private.append_only();
alter table public.wealth_days enable row level security;
grant select on public.wealth_days to authenticated;
create policy read on public.wealth_days for select to authenticated using (true);

-- wealth_params: 沪深 300 (symbol as Tencent and Sina write it); factor 2; the weekly base by length, so that an index
-- that never moves pays at maturity what the 定期 of the length plus 1.5 points pays in simple interest: weekly base =
-- (1 + (定期 rate + 1.5) × weeks / 100)^(1/weeks) − 1, 2 weeks 3.923%, 4 weeks 4.0031%, 12 weeks 3.6637%, 24 weeks
-- 3.2208%, 48 weeks 2.5823% (100 HTB for 48 weeks comes to about 340 HTB, the 定期 268 HTB). 沪深 300 moves about 1% a
-- day: factor 2 makes 稳健 2, 平衡 4 and 进取 8 times the index. The daily bounds are what each tier takes on a day the
-- index moves 2.5%, so only the few biggest days of a year are cut; no day loses everything.
update public.settings set value = '{"symbol":"sh000300","name":"沪深 300","factor":2,
  "base":{"2":3.923,"4":4.0031,"12":3.6637,"24":3.2208,"48":2.5823},
  "tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-5,"max":5},
           {"key":"balanced","name":"平衡","multiplier":2,"min":-10,"max":10},
           {"key":"bold","name":"进取","multiplier":4,"min":-20,"max":20}]}'
where key = 'wealth_params';

-- The daily base of a weekly base (percentages, 4 decimals).
create function app_private.day_base(p_weekly numeric) returns numeric
language sql immutable as $$
  select round((power(1 + p_weekly / 100, 1 / 7.0) - 1) * 100, 4)
$$;

-- A day's rate for a holding: its daily base + multiplier × factor × the index's change, within its daily bounds.
create or replace function app_private.holding_rate(p_hold public.wealth_holdings, p_change numeric) returns numeric
language sql immutable as $$
  select least(p_hold.max_rate, greatest(p_hold.min_rate,
    round(app_private.day_base(p_hold.base) + p_hold.multiplier * p_hold.factor * p_change, 4)))
$$;

-- The rate a tier t of wealth_params p would take for a length on a day's change, as holding_rate works it out.
create or replace function app_private.tier_rate(p jsonb, p_weeks integer, t jsonb, p_change numeric) returns numeric
language sql immutable as $$
  select least((t ->> 'max')::numeric, greatest((t ->> 'min')::numeric,
    round(app_private.day_base((p -> 'base' ->> p_weeks::text)::numeric) + (t ->> 'multiplier')::numeric * (p ->> 'factor')::numeric * p_change, 4)))
$$;

-- The index's change on a day: the day's close when it has one; 0 on a weekend, and on a weekday with none when a later
-- trading day has one (a holiday); null while it is not known yet.
create function app_private.wealth_day_change(p_day date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select change from public.wealth_days where day = p_day),
    case when extract(isodow from p_day) >= 6 or exists (select 1 from public.wealth_days where day > p_day) then 0 end)
$$;

-- The index's daily closes from a source, as dolphin jobs fetch hands them over (the body as the source sends it): each
-- trading day with the one before it in the list gets a row, unless it has one; today's waits until 15:30 (Asia/
-- Shanghai), after the close. Tencent: data.<symbol>.day (or qfqday) of [day, open, close, …]; Sina: [{day, close, …}];
-- eastmoney: data.klines of "day,close". Returns the days added.
create function app_private.record_wealth_days(p_source text, p_body jsonb, p_at timestamptz default now()) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_params jsonb := app_private.setting('wealth_params');
  v_symbol text := app_private.setting('wealth_params') ->> 'symbol';
  v_last date := app_private.cn_date(p_at) - case when (p_at at time zone 'Asia/Shanghai')::time >= '15:30' then 0 else 1 end;
  v_rows jsonb;
  v_n integer;
begin
  v_rows := case p_source
    when 'tencent' then (select jsonb_agg(jsonb_build_array(e ->> 0, e ->> 2))
      from jsonb_array_elements(coalesce(p_body -> 'data' -> v_symbol -> 'day', p_body -> 'data' -> v_symbol -> 'qfqday')) e)
    when 'sina' then (select jsonb_agg(jsonb_build_array(left(e ->> 'day', 10), e ->> 'close')) from jsonb_array_elements(p_body) e)
    when 'eastmoney' then (select jsonb_agg(jsonb_build_array(split_part(e #>> '{}', ',', 1), split_part(e #>> '{}', ',', 2)))
      from jsonb_array_elements(p_body -> 'data' -> 'klines') e)
  end;
  if jsonb_typeof(v_rows) is distinct from 'array' then
    raise exception 'no daily closes from %', p_source;
  end if;
  insert into public.wealth_days (day, close, prev_close, change, source, params)
  select d, c, pc, round(100 * c / pc - 100, 4), p_source, v_params
  from (select d, c, lag(c) over (order by d) as pc
        from (select (e ->> 0)::date as d, (e ->> 1)::numeric as c from jsonb_array_elements(v_rows) e) k) x
  where pc is not null and d <= v_last and c > 0 and pc > 0
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
drop function app_private.record_wealth_klines(jsonb, date);

-- 每天的收益 (§10.10) by the end of p_day: each open holding takes, in order, every day it needs up to p_day whose change
-- is known, its value to 0.01 HTB (rounded), never below 0. A day not known yet holds up that holding's later days and
-- its maturity.
create or replace function app_private.value_wealth(p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_all integer := 0;
begin
  loop
    update public.wealth_holdings h set value_centi = round(h.value_centi * (100 + app_private.holding_rate(h, x.change)) / 100)::integer,
      valued_to = h.valued_to + 1
    from (select id, app_private.wealth_day_change(valued_to) as change from public.wealth_holdings
          where status = 'open' and valued_to <= p_day and valued_to <= matures_on) x
    where h.id = x.id and x.change is not null;
    get diagnostics v_n = row_count;
    exit when v_n = 0;
    v_all := v_all + v_n;
  end loop;
  return v_all;
end
$$;

-- Buys a holding at p_at, as in 20261120000300_wealth_multiplier.sql: from the next day for 7 × p_weeks days, maturing on
-- the day 定期 of the length would (the day bought + 7 × p_weeks). The wealth_buy says「12 周 · 进取 ×4，2月5日 到期」.
create or replace function app_private.start_wealth(p_id uuid, p_student_no text, p_amount integer, p_weeks integer, p_tier text,
  p_operator uuid, p_at timestamptz) returns public.wealth_holdings
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := app_private.cn_date(p_at);
  v_params jsonb := app_private.setting('wealth_params');
  v_tier jsonb := (select t from jsonb_array_elements(app_private.setting('wealth_params') -> 'tiers') t where t ->> 'key' = p_tier);
  v_txn uuid := gen_random_uuid();
  v_account public.accounts;
  v_hold public.wealth_holdings;
begin
  update public.accounts set balance = balance - p_amount, wealth_total = wealth_total + p_amount, updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.wealth_holdings (id, student_no, principal, weeks, opened_on, starts_on, matures_on, value_centi, valued_to, open_txn,
    tier, tier_name, multiplier, factor, base, min_rate, max_rate)
  values (p_id, p_student_no, p_amount, p_weeks, v_day, v_day + 1, v_day + 7 * p_weeks, 100 * p_amount, v_day + 1, v_txn,
    p_tier, v_tier ->> 'name', (v_tier ->> 'multiplier')::numeric, (v_params ->> 'factor')::numeric,
    (v_params -> 'base' ->> p_weeks::text)::numeric, (v_tier ->> 'min')::numeric, (v_tier ->> 'max')::numeric)
  returning * into v_hold;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id, wealth_id, created_at)
  values (v_txn, 'wealth_buy', p_student_no, p_amount, -p_amount, v_account.balance,
    p_weeks || ' 周 · ' || v_hold.tier_name || ' ×' || trim_scale(v_hold.multiplier) || '，' || to_char(v_hold.matures_on, 'FMMM月FMDD日') || ' 到期',
    p_operator, app_private.request_header('x-device-id'), p_id, p_at);
  return v_hold;
end
$$;

-- The name a source is shown by.
create function app_private.wealth_source_name(p_source text) returns text
language sql immutable as $$
  select case p_source when 'tencent' then '腾讯行情' when 'sina' then '新浪财经' when 'eastmoney' then '东方财富' when 'manual' then '手动登记' end
$$;

-- The trading days shown: the latest p_n, newest first, with the source's name, without the parameters and who entered
-- them.
create or replace function app_private.wealth_recent(p_n integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(w) - 'params' - 'created_by' || jsonb_build_object('source_name', app_private.wealth_source_name(w.source))
    order by w.day desc), '[]')
  from (select * from public.wealth_days order by day desc limit p_n) w
$$;

-- wealth_quote as in 20261120000300_wealth_multiplier.sql, by day: today ({"day","closed"}: true on a weekend, false once
-- today's close is in, null until then); the index, the tiers, each length with the day it starts, its last day, its
-- weekly and daily base and each tier with the rate it takes on the latest trading day's change and its daily bounds;
-- the latest 10 trading days (latest the first).
create or replace function public.wealth_quote(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
  v_params jsonb := app_private.setting('wealth_params');
  v_student public.students;
  v_recent jsonb := app_private.wealth_recent(10);
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
  return (select jsonb_build_object('student_no', p_student_no,
      'today', jsonb_build_object('day', v_today, 'closed', case when exists (select 1 from public.wealth_days where day = v_today) then false
        when extract(isodow from v_today) >= 6 then true end),
      'index', jsonb_build_object('symbol', v_params ->> 'symbol', 'name', v_params ->> 'name'),
      'factor', (v_params ->> 'factor')::numeric, 'tiers', v_params -> 'tiers',
      'options', (select jsonb_agg(jsonb_build_object('weeks', w, 'starts_on', v_today + 1, 'matures_on', v_today + 7 * w,
          'base', (v_params -> 'base' ->> w::text)::numeric, 'day_base', app_private.day_base((v_params -> 'base' ->> w::text)::numeric),
          'tiers', (select jsonb_agg(jsonb_build_object('key', t ->> 'key', 'name', t ->> 'name', 'multiplier', (t ->> 'multiplier')::numeric,
              'rate', app_private.tier_rate(v_params, w, t, (v_recent -> 0 ->> 'change')::numeric),
              'min', (t ->> 'min')::numeric, 'max', (t ->> 'max')::numeric) order by i)
            from jsonb_array_elements(v_params -> 'tiers') with ordinality x(t, i))) order by w)
        from unnest(array[2, 4, 12, 24, 48]) w),
      'latest', v_recent -> 0, 'recent', v_recent,
      'balance', a.balance, 'wealth_total', a.wealth_total,
      'holdings', coalesce((select jsonb_agg(to_jsonb(h) order by h.opened_on desc, h.id) from public.wealth_holdings h
        where h.student_no = p_student_no), '[]'))
    from public.accounts a where a.student_no = p_student_no);
end
$$;

-- 后台「理财」 (§16.2), by day: wealth_params with each length's daily base (day_base); the calendar days before p_before
-- (default today), the latest p_limit (1–366, default 30) newest first, each {"day","status","close","prev_close",
-- "change","source","source_name","note","created_by_name","created_at","rates"}: status open (its close), closed (a
-- weekend or holiday: no close, source closed, 休市), pending (not known yet: 待登记) or none (before the first close on
-- record: nothing); rates the rate each length and
-- tier takes that day under wealth_params now ({"<weeks>": {"<tier key>": rate}}, at the base on a closed day, null while
-- pending); a holding takes its own from the parameters it locked. And the weekdays over that open holdings still wait
-- for (missing, oldest first) and the holdings open in all.
drop function public.wealth_overview();
create function public.wealth_overview(p_before date default null, p_limit integer default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_today date := app_private.cn_date(now());
  v_before date := coalesce(p_before, app_private.cn_date(now()));
  v_params jsonb := app_private.setting('wealth_params');
  v_first date := (select min(day) from public.wealth_days);
begin
  if p_limit is null or p_limit not between 1 and 366 then
    perform app_private.fail('INVALID_INPUT', '{"field":"limit"}');
  end if;
  return jsonb_build_object(
    'params', v_params || jsonb_build_object('day_base', (select jsonb_object_agg(k, app_private.day_base((v_params -> 'base' ->> k)::numeric))
      from jsonb_object_keys(v_params -> 'base') k)),
    'days', (select jsonb_agg(jsonb_build_object('day', g.day,
        'status', case when w.day is not null then 'open' when v_first is null or g.day < v_first then 'none'
          when x.change is not null then 'closed' else 'pending' end,
        'close', w.close, 'prev_close', w.prev_close, 'change', w.change,
        'source', case when w.day is not null then w.source when v_first is null or g.day < v_first then null when x.change is not null then 'closed' end,
        'source_name', case when w.day is not null then app_private.wealth_source_name(w.source) when v_first is null or g.day < v_first then null
          when x.change is not null then '休市' else '待登记' end,
        'note', w.note, 'created_by_name', p.display_name, 'created_at', w.created_at,
        'rates', case when x.change is not null and g.day >= v_first then (select jsonb_object_agg(l, (select jsonb_object_agg(t ->> 'key', app_private.tier_rate(v_params, l, t, x.change))
            from jsonb_array_elements(v_params -> 'tiers') t)) from unnest(array[2, 4, 12, 24, 48]) l) end)
        order by g.day desc)
      from (select (v_before - i)::date as day from generate_series(1, p_limit) i) g
        cross join lateral (select app_private.wealth_day_change(g.day) as change) x
        left join public.wealth_days w on w.day = g.day left join public.profiles p on p.id = w.created_by),
    'missing', (select coalesce(jsonb_agg(g::date order by g), '[]')
      from generate_series((select min(valued_to) from public.wealth_holdings where status = 'open'), v_today - 1, interval '1 day') g
      where app_private.wealth_day_change(g::date) is null
        and exists (select 1 from public.wealth_holdings h where h.status = 'open' and g::date between h.valued_to and h.matures_on)),
    'open', (select jsonb_build_object('count', count(*), 'principal', coalesce(sum(principal), 0), 'value_centi', coalesce(sum(value_centi), 0))
      from public.wealth_holdings where status = 'open'));
end
$$;
grant execute on function public.wealth_overview(date, integer) to authenticated;

-- 手动登记 (§10.10) by the bank admin or the president, for a weekday over with no close: the index's change that day
-- (percentage, −50 to 50, up to 4 decimals) and where it came from. Once entered it is never changed; the next run_daily
-- applies it.
drop function public.record_wealth_week(date, numeric, text);
create function public.record_wealth_day(p_day date, p_change numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row public.wealth_days;
begin
  if p_day is null or extract(isodow from p_day) >= 6 or p_day >= app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', '{"field":"day"}');
  end if;
  if p_change is null or p_change <> round(p_change, 4) or p_change not between -50 and 50 then
    perform app_private.fail('INVALID_INPUT', '{"field":"change"}');
  end if;
  if nullif(trim(p_note), '') is null or length(trim(p_note)) > 200 then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  insert into public.wealth_days (day, change, source, note, params, created_by)
  values (p_day, p_change, 'manual', trim(p_note), app_private.setting('wealth_params'), v_me)
  on conflict do nothing
  returning * into v_row;
  if v_row.day is null then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"day"}');
  end if;
  perform app_private.log('wealth.record', 'wealth_days:' || p_day, null, to_jsonb(v_row));
  return to_jsonb(v_row) - 'params';
end
$$;
grant execute on function public.record_wealth_day(date, numeric, text) to authenticated;

-- set_setting as in 20261124000000_drop_salary_per_shift.sql, wealth_params with the index's symbol (sh000300) and
-- daily bounds (§14.3).
create or replace function public.set_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_value jsonb := p_value;
begin
  if p_key = 'denominations' then
    if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value) not between 1 and 10
       or not p_value @> '[1]' or exists (select 1 from jsonb_array_elements(p_value) e where not app_private.json_int_between(e, 1, 1000))
       or (select count(distinct e) <> count(*) from jsonb_array_elements(p_value) e) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
    v_value := (select jsonb_agg(e order by e::numeric) from jsonb_array_elements(p_value) e);
  elsif p_key in ('withdraw_single_limit', 'withdraw_daily_limit') then
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['junior', 'primary']
       or not app_private.json_int_between(p_value -> 'primary', 1, 1000000)
       or not app_private.json_int_between(p_value -> 'junior', 1, 1000000) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'promotion_date' then
    if jsonb_typeof(p_value) is distinct from 'string' or p_value #>> '{}' !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
       or to_char(to_date('2000-' || (p_value #>> '{}'), 'YYYY-MM-DD'), 'MM-DD') <> p_value #>> '{}' then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'ranking_size' then
    if not app_private.json_int_between(p_value, 1, 100) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'ranking_anonymous' then
    if jsonb_typeof(p_value) is distinct from 'boolean' then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'credit_curve' then
    -- 最低分 0–999; 额度 1–10000 HTB with limit_step ≤ limit_min ≤ limit_max, so a student who may borrow may borrow a
    -- step at least; 系数 0.1–10 with up to 4 decimals, loan_min ≤ loan_max and saving_min ≤ saving_max.
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> array['limit_max', 'limit_min', 'limit_step', 'loan_max', 'loan_min', 'min_score', 'saving_max', 'saving_min']
       or not app_private.json_int_between(p_value -> 'min_score', 0, 999)
       or exists (select 1 from unnest(array['limit_min', 'limit_max', 'limit_step']) k where not app_private.json_int_between(p_value -> k, 1, 10000))
       or exists (select 1 from unnest(array['loan_min', 'loan_max', 'saving_min', 'saving_max']) k
                  where not app_private.json_num_between(p_value -> k, 0.1, 10)) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
    if (p_value ->> 'limit_step')::integer > (p_value ->> 'limit_min')::integer
       or (p_value ->> 'limit_min')::integer > (p_value ->> 'limit_max')::integer
       or (p_value ->> 'loan_min')::numeric > (p_value ->> 'loan_max')::numeric
       or (p_value ->> 'saving_min')::numeric > (p_value ->> 'saving_max')::numeric then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'credit_rules' then
    -- every rule, gains 0–100 points and losses −100–0
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> (select array_agg(k order by k) from jsonb_object_keys(app_private.credit_rule_signs()) k)
       or exists (select 1 from jsonb_each(app_private.credit_rule_signs()) s(k, sign)
                  where not app_private.json_int_between(p_value -> k, least(0, sign::integer * 100), greatest(0, sign::integer * 100))) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'anchor_params' then
    -- 锚点 (§9.1), percentages: only initial, min and max change, 0.01–100 in whole hundredths with min ≤ initial ≤ max;
    -- the formula's other keys are fixed and must equal the saved ones.
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> array['growth_step', 'growth_target', 'initial', 'max', 'max_adjust', 'min', 'ratio_step', 'ratio_target', 'weight']
       or exists (select 1 from unnest(array['initial', 'min', 'max']) k where not app_private.json_num_between(p_value -> k, 0.01, 100))
       or exists (select 1 from jsonb_each(app_private.setting('anchor_params')) c
                  where c.key not in ('initial', 'min', 'max') and p_value -> c.key is distinct from c.value) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
    if exists (select 1 from unnest(array['initial', 'min', 'max']) k where (p_value ->> k)::numeric <> round((p_value ->> k)::numeric, 2))
       or (p_value ->> 'min')::numeric > (p_value ->> 'initial')::numeric
       or (p_value ->> 'initial')::numeric > (p_value ->> 'max')::numeric then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'term_rates' then
    -- 定期周利率 (§9.2): every length, 0.01–100 with up to 4 decimals
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['12', '2', '24', '4', '48']
       or exists (select 1 from jsonb_each(p_value) e where not app_private.json_num_between(e.value, 0.01, 100)) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'wealth_params' then
    -- the index (sh or sz and 6 digits); factor 0.01–10; weekly base by length 0–100; 1 to 5 tiers, each a key
    -- (lower-case letters, digits, _), a name (1–10 characters), a multiplier 0.1–20 and daily bounds, min −100–0 and max
    -- 0–100; numbers up to 4 decimals
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['base', 'factor', 'name', 'symbol', 'tiers']
       or jsonb_typeof(p_value -> 'symbol') <> 'string' or p_value ->> 'symbol' !~ '^(sh|sz)[0-9]{6}$'
       or jsonb_typeof(p_value -> 'name') <> 'string' or length(trim(p_value ->> 'name')) not between 1 and 20
       or not app_private.json_num_between(p_value -> 'factor', 0.01, 10)
       or jsonb_typeof(p_value -> 'base') <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value -> 'base') k) <> array['12', '2', '24', '4', '48']
       or exists (select 1 from jsonb_each(p_value -> 'base') e where not app_private.json_num_between(e.value, 0, 100))
       or jsonb_typeof(p_value -> 'tiers') <> 'array' or jsonb_array_length(p_value -> 'tiers') not between 1 and 5
       or exists (select 1 from jsonb_array_elements(p_value -> 'tiers') t
                  where jsonb_typeof(t) <> 'object'
                     or (select array_agg(k order by k) from jsonb_object_keys(t) k) <> array['key', 'max', 'min', 'multiplier', 'name']
                     or jsonb_typeof(t -> 'key') <> 'string' or t ->> 'key' !~ '^[a-z][a-z0-9_]{0,19}$'
                     or jsonb_typeof(t -> 'name') <> 'string' or length(trim(t ->> 'name')) not between 1 and 10
                     or not app_private.json_num_between(t -> 'multiplier', 0.1, 20)
                     or not app_private.json_num_between(t -> 'min', -100, 0)
                     or not app_private.json_num_between(t -> 'max', 0, 100))
       or (select count(distinct t ->> 'key') from jsonb_array_elements(p_value -> 'tiers') t) <> jsonb_array_length(p_value -> 'tiers') then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key in ('loan_multiplier', 'penalty_multiplier') then
    -- fixed by the system (§14.3)
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
  else
    perform app_private.fail('INVALID_INPUT', '{"field":"key"}');
  end if;
  update public.settings set value = v_value, updated_by = v_me, updated_at = now() where key = p_key;
  -- M13 风险提醒 setting_change：利率参数（含 term_rates）、credit_curve、credit_rules、风险阈值、取款限额（对象 settings:<key>；「终止」恢复修改前的值）
  return jsonb_build_object('key', p_key, 'value', v_value);
end
$$;
