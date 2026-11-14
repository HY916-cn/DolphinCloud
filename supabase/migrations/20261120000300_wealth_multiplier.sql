-- 理财的基础收益与倍率 (PHASE-2.md §10.10, §14.3, PRODUCT.md 5.2): a holding's weekly rate is the base of its length
-- plus the multiplier of the tier the student picks × factor × the index's weekly change, within that tier's bounds.
-- The base, the factor and the tier (multiplier and bounds) are locked when it is bought, so a change to wealth_params
-- moves only the holdings bought after it. wealth_weeks keeps the index's change of each week; each holding works out
-- its own rate from it. A week entered by hand is the index's change too.

-- wealth_params: the index; factor; the weekly base by length, 1.5 points above the 定期 rate of the same length (4 /
-- 4.25 / 4.5 / 4.75 / 5); three tiers. With factor 3 the 稳健 tier already moves 3 times the index, 平衡 6 and 进取 12
-- times. The lower bounds keep any one week's loss to a tenth, a fifth and under a third; the upper bounds sit about as
-- far above the base, so both only bite in weeks the index moves 3%–5%.
update public.settings set value = '{"secid":"100.SPX","name":"标普 500","factor":3,
  "base":{"2":4,"4":4.25,"12":4.5,"24":4.75,"48":5},
  "tiers":[{"key":"steady","name":"稳健","multiplier":1,"min":-10,"max":15},
           {"key":"balanced","name":"平衡","multiplier":2,"min":-20,"max":25},
           {"key":"bold","name":"进取","multiplier":4,"min":-30,"max":40}]}'
where key = 'wealth_params';

-- What a holding locked when it was bought. A holding bought before keeps the rule it had: the change × 2 within ±5%.
alter table public.wealth_holdings
  add column tier       text not null default 'steady',  -- 档位
  add column tier_name  text not null default '稳健',    -- 档位名称
  add column multiplier numeric(6,4) not null default 1, -- 倍率
  add column factor     numeric(6,4) not null default 2, -- 系数
  add column base       numeric(8,4) not null default 0, -- 基础收益（百分数）
  add column min_rate   numeric(8,4) not null default -5, -- 每周下限（百分数）
  add column max_rate   numeric(8,4) not null default 5;  -- 每周上限（百分数）
alter table public.wealth_holdings alter column tier drop default, alter column tier_name drop default, alter column multiplier drop default, alter column factor drop default,
  alter column base drop default, alter column min_rate drop default, alter column max_rate drop default;

-- A week's rate for a holding: base + multiplier × factor × change, to 4 decimals, within its bounds.
create function app_private.holding_rate(p_hold public.wealth_holdings, p_change numeric) returns numeric
language sql immutable as $$
  select least(p_hold.max_rate, greatest(p_hold.min_rate, round(p_hold.base + p_hold.multiplier * p_hold.factor * p_change, 4)))
$$;

-- The rate a tier t of wealth_params p would take for a length on a week's change (null without a change), as
-- holding_rate works it out for a holding bought under p.
create function app_private.tier_rate(p jsonb, p_weeks integer, t jsonb, p_change numeric) returns numeric
language sql immutable as $$
  select least((t ->> 'max')::numeric, greatest((t ->> 'min')::numeric,
    round((p -> 'base' ->> p_weeks::text)::numeric + (t ->> 'multiplier')::numeric * (p ->> 'factor')::numeric * p_change, 4)))
$$;

-- record_wealth_klines as in 20261120000200_wealth.sql: each week's change only.
create or replace function app_private.record_wealth_klines(p_klines jsonb, p_today date default app_private.cn_date(now())) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_params jsonb := app_private.setting('wealth_params');
  v_n integer;
begin
  if jsonb_typeof(p_klines) is distinct from 'array' then
    raise exception 'no klines';
  end if;
  insert into public.wealth_weeks (week_start, close, prev_close, change, source, params)
  select w, c, pc, round(100 * c / pc - 100, 4), 'eastmoney', v_params
  from (select app_private.week_of(split_part(e, ',', 1)::date) as w, split_part(e, ',', 2)::numeric as c,
          lag(app_private.week_of(split_part(e, ',', 1)::date)) over (order by i) as pw, lag(split_part(e, ',', 2)::numeric) over (order by i) as pc
        from jsonb_array_elements_text(p_klines) with ordinality k(e, i)) x
  where pw = w - 7 and w + 7 <= app_private.week_of(p_today) and c > 0 and pc > 0
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
drop function app_private.wealth_rate(numeric, jsonb);

-- The index's change is what each week keeps; a week entered by hand has it too.
alter table public.wealth_weeks drop column rate;
alter table public.wealth_weeks alter column change set not null;

-- value_wealth as in 20261120000200_wealth.sql, each holding at its own rate of the week.
create or replace function app_private.value_wealth(p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_all integer := 0;
begin
  loop
    update public.wealth_holdings h set value_centi = floor(h.value_centi * (100 + app_private.holding_rate(h, w.change)) / 100)::integer,
      valued_to = h.valued_to + 7
    from public.wealth_weeks w
    where h.status = 'open' and w.week_start = h.valued_to and h.valued_to + 6 <= p_day and h.valued_to < h.matures_on;
    get diagnostics v_n = row_count;
    exit when v_n = 0;
    v_all := v_all + v_n;
  end loop;
  return v_all;
end
$$;

-- mature_wealth as in 20261120000200_wealth.sql, counting the holdings it brings back (a txns row with a null column is
-- not "is not null", its id is).
create or replace function app_private.mature_wealth(p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  r record;
begin
  for r in
    select id from public.wealth_holdings where status = 'open' and matures_on <= p_day and valued_to > matures_on order by student_no, id
  loop
    v_n := v_n + ((app_private.end_wealth(r.id, 'matured', app_private.system_user(),
      (p_day + 1)::timestamp at time zone 'Asia/Shanghai')).id is not null)::integer;
  end loop;
  return v_n;
end
$$;

-- Buys a holding at p_at, as in 20261120000200_wealth.sql, locking the base of its length, the factor and the tier p_tier
-- of wealth_params. The callers have checked the account, the amount, the length and the tier. The wealth_buy says the
-- length, the tier and the last day:「12 周 · 进取 ×4，2月7日 到期」.
drop function app_private.start_wealth(uuid, text, integer, integer, uuid, timestamptz);
create function app_private.start_wealth(p_id uuid, p_student_no text, p_amount integer, p_weeks integer, p_tier text,
  p_operator uuid, p_at timestamptz) returns public.wealth_holdings
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := app_private.cn_date(p_at);
  v_start date := app_private.week_of(app_private.cn_date(p_at)) + 7;
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
  values (p_id, p_student_no, p_amount, p_weeks, v_day, v_start, v_start + 7 * p_weeks - 1, 100 * p_amount, v_start, v_txn,
    p_tier, v_tier ->> 'name', (v_tier ->> 'multiplier')::numeric, (v_params ->> 'factor')::numeric, (v_params -> 'base' ->> p_weeks::text)::numeric,
    (v_tier ->> 'min')::numeric, (v_tier ->> 'max')::numeric)
  returning * into v_hold;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id, wealth_id, created_at)
  values (v_txn, 'wealth_buy', p_student_no, p_amount, -p_amount, v_account.balance,
    p_weeks || ' 周 · ' || v_hold.tier_name || ' ×' || trim_scale(v_hold.multiplier) || '，' || to_char(v_hold.matures_on, 'FMMM月FMDD日') || ' 到期',
    p_operator, app_private.request_header('x-device-id'), p_id, p_at);
  return v_hold;
end
$$;

-- 买理财 as in 20261120000200_wealth.sql, in a tier of wealth_params (p_tier its key).
drop function public.buy_wealth(uuid, text, integer, integer);
create function public.buy_wealth(p_id uuid, p_student_no text, p_amount integer, p_weeks integer, p_tier text) returns jsonb
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
  if p_weeks is null or p_weeks not in (2, 4, 12, 24, 48) then
    perform app_private.fail('INVALID_INPUT', '{"field":"weeks"}');
  end if;
  if not exists (select 1 from jsonb_array_elements(app_private.setting('wealth_params') -> 'tiers') t where t ->> 'key' = p_tier) then
    perform app_private.fail('INVALID_INPUT', '{"field":"tier"}');
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
  v_hold := app_private.start_wealth(p_id, p_student_no, p_amount, p_weeks, p_tier, v_me, now());
  return app_private.wealth_result(v_hold, v_hold.open_txn);
end
$$;
grant execute on function public.buy_wealth(uuid, text, integer, integer, text) to authenticated;

-- wealth_quote as in 20261120000200_wealth.sql, with the tiers of wealth_params and, for each length, its base and each
-- tier: {"key","name","multiplier","rate","min","max"}, rate what it would have taken in the latest week (null before
-- any week), min and max its weekly bounds.
create or replace function public.wealth_quote(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
  v_params jsonb := app_private.setting('wealth_params');
  v_student public.students;
  v_recent jsonb := app_private.wealth_recent(6);
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
      'index', jsonb_build_object('secid', v_params ->> 'secid', 'name', v_params ->> 'name'),
      'factor', (v_params ->> 'factor')::numeric, 'tiers', v_params -> 'tiers',
      'options', (select jsonb_agg(jsonb_build_object('weeks', w, 'starts_on', app_private.week_of(v_today) + 7,
          'matures_on', app_private.week_of(v_today) + 7 * w + 6, 'base', (v_params -> 'base' ->> w::text)::numeric,
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

-- 手动登记 as in 20261120000200_wealth.sql: the index's change of the week (percentage, −50 to 50, up to 4 decimals);
-- each holding works out its rate from it.
drop function public.record_wealth_week(date, numeric, text);
create function public.record_wealth_week(p_week date, p_change numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row public.wealth_weeks;
begin
  if p_week is null or extract(isodow from p_week) <> 1 or p_week > app_private.week_of(app_private.cn_date(now())) - 7 then
    perform app_private.fail('INVALID_INPUT', '{"field":"week"}');
  end if;
  if p_change is null or p_change <> round(p_change, 4) or p_change not between -50 and 50 then
    perform app_private.fail('INVALID_INPUT', '{"field":"change"}');
  end if;
  if nullif(trim(p_note), '') is null or length(trim(p_note)) > 200 then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  insert into public.wealth_weeks (week_start, change, source, note, params, created_by)
  values (p_week, p_change, 'manual', trim(p_note), app_private.setting('wealth_params'), v_me)
  on conflict do nothing
  returning * into v_row;
  if v_row.week_start is null then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"week"}');
  end if;
  perform app_private.log('wealth.record', 'wealth_weeks:' || p_week, null, to_jsonb(v_row));
  return to_jsonb(v_row) - 'params';
end
$$;
grant execute on function public.record_wealth_week(date, numeric, text) to authenticated;

-- set_setting as in 20261120000200_wealth.sql, wealth_params taking its bases by length and its tiers (§14.3): the president
-- and the bank admin change them for the holdings bought after.
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
  elsif p_key = 'salary_per_shift' then
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['am', 'pm']
       or not app_private.json_int_between(p_value -> 'am', 1, 10000)
       or not app_private.json_int_between(p_value -> 'pm', 1, 10000) then
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
    -- the index; factor 0.01–10; base by length 0–100; 1 to 5 tiers, each a key (lower-case letters, digits, _), a name
    -- (1–10 characters), a multiplier 0.1–20 and weekly bounds, min −90–0 and max 0–500; numbers up to 4 decimals
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['base', 'factor', 'name', 'secid', 'tiers']
       or jsonb_typeof(p_value -> 'secid') <> 'string' or p_value ->> 'secid' !~ '^[0-9]{1,3}\.[A-Za-z0-9_]{1,20}$'
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
                     or not app_private.json_num_between(t -> 'min', -90, 0)
                     or not app_private.json_num_between(t -> 'max', 0, 500))
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

-- wealth_overview as in 20261120000200_wealth.sql, each week with the rate every length and tier would take on its change
-- under wealth_params now (rates: {"<weeks>": {"<tier key>": rate}}); a holding takes its own rate from the parameters it
-- locked.
create or replace function public.wealth_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_today date := app_private.cn_date(now());
  v_params jsonb := app_private.setting('wealth_params');
begin
  return jsonb_build_object('params', v_params,
    'weeks', (select coalesce(jsonb_agg(to_jsonb(w) - 'params' || jsonb_build_object('created_by_name', p.display_name,
        'rates', (select jsonb_object_agg(l, (select jsonb_object_agg(t ->> 'key', app_private.tier_rate(v_params, l, t, w.change))
            from jsonb_array_elements(v_params -> 'tiers') t)) from unnest(array[2, 4, 12, 24, 48]) l))
        order by w.week_start desc), '[]') from public.wealth_weeks w left join public.profiles p on p.id = w.created_by),
    'missing', (select coalesce(jsonb_agg(g::date order by g), '[]')
      from generate_series((select min(valued_to) from public.wealth_holdings where status = 'open'),
        app_private.week_of(v_today) - 7, interval '7 days') g
      where not exists (select 1 from public.wealth_weeks where week_start = g::date)
        and exists (select 1 from public.wealth_holdings h where h.status = 'open' and g::date between h.valued_to and h.matures_on - 6)),
    'open', (select jsonb_build_object('count', count(*), 'principal', coalesce(sum(principal), 0), 'value_centi', coalesce(sum(value_centi), 0))
      from public.wealth_holdings where status = 'open'));
end
$$;
