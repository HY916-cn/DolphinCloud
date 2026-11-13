-- 理财 (PHASE-2.md §9.6, §10.10, §13, §14, §15): the counter moves 活期 into a holding of 2, 4, 12, 24 or 48 weeks. From
-- the Monday after it is bought, its value (0.01 HTB) moves each week by that week's 收益率: the reference index's weekly
-- change × factor within the weekly bounds of wealth_params, which may be below 0. dolphin-jobs fetches the index's weekly
-- closes before the jobs run; a week it cannot fetch the bank admin or the president enters by hand. run_daily applies
-- each week once it is over and its rate is in wealth_weeks, then brings the holdings whose last week has been applied
-- back into 活期 at the end of their last day. The counter redeems a holding at its value at any time. The money paid
-- back is the value with the account's 零头 (interest_carry), its whole HTB into 活期 and the rest kept as 零头.
-- 存款余额 (the anchor, 日均余额, the ranking) counts the 理财本金 with 活期 and 定期本金.

-- wealth_params: the index (eastmoney secid and the name shown), the factor its weekly change is multiplied by and the
-- bounds of a week's rate (percentages).
insert into public.settings (key, value) values ('wealth_params', '{"secid":"100.SPX","name":"标普 500","factor":2,"min":-5,"max":5}');

create table public.wealth_weeks (            -- 每周收益
  week_start date primary key check (extract(isodow from week_start) = 1), -- 周一：这一周的涨跌
  close      numeric(14,4),                   -- 参考指数本周收盘；手动登记时为空
  prev_close numeric(14,4),                   -- 上周收盘
  change     numeric(10,4),                   -- 原始涨跌（百分数）
  rate       numeric(8,4) not null,           -- 采用的收益率（百分数）
  source     text not null check (source in ('eastmoney', 'manual')),
  note       text,                            -- 手动登记的说明
  params     jsonb not null,                  -- wealth_params at the time
  created_by uuid references public.profiles(id), -- 登记人
  created_at timestamptz not null default now()
);
create trigger append_only before update or delete on public.wealth_weeks for each row execute function app_private.append_only();

create table public.wealth_holdings (         -- 理财
  id          uuid primary key,               -- 客户端生成，作幂等键
  student_no  text not null references public.students(student_no),
  principal   integer not null check (principal > 0),
  weeks       integer not null check (weeks in (2, 4, 12, 24, 48)),
  opened_on   date not null,
  starts_on   date not null,                  -- 开始计收益的周一（买入后的第一个周一）
  matures_on  date not null,                  -- 到期日：最后一周的周日
  value_centi integer not null check (value_centi >= 0), -- 现值（0.01 HTB）
  valued_to   date not null,                  -- 下一周要计的收益（周一）；计完为 matures_on + 1
  status      text not null default 'open' check (status in ('open', 'matured', 'redeemed', 'reversed')),
  open_txn    uuid not null references public.txns(id) deferrable initially deferred, -- written just before its wealth_buy
  close_txn   uuid references public.txns(id)
);
create index on public.wealth_holdings (student_no);
create index on public.wealth_holdings (valued_to) where status = 'open';
-- The weekly value alone is not logged.
create trigger audit after insert or update or delete on public.wealth_holdings for each row execute function app_private.audit_row('value_centi', 'valued_to');

alter table public.wealth_weeks enable row level security;
alter table public.wealth_holdings enable row level security;
grant select on public.wealth_weeks, public.wealth_holdings to authenticated;
-- The weekly rates are for everyone signed in; a student reads their own holdings, the accountant, president and bank
-- admin everyone's (§3). The counter reads a student's through wealth_quote.
create policy read on public.wealth_weeks for select to authenticated using (true);
create policy read on public.wealth_holdings for select to authenticated using (
  student_no = (select app_private.my_student_no())
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

-- 理财本金合计 of each account; wealth_buy and wealth_close move it with the 活期 balance.
alter table public.accounts add column wealth_total integer not null default 0 check (wealth_total >= 0);
-- A small holding that lost may come back as less than 1 HTB: its wealth_close moves 0 HTB and the value goes to the
-- 零头, and the reversal of such a 赎回 may move 0 HTB too. Every other transaction still moves 1 HTB or more.
alter table public.txns drop constraint txns_amount_check;
alter table public.txns add constraint txns_amount_check check (amount > 0 or amount = 0 and type in ('wealth_close', 'reversal'));
-- The holding a wealth_buy, wealth_close or their reversal belongs to.
alter table public.txns add column wealth_id uuid references public.wealth_holdings(id);
create index on public.txns (wealth_id) where wealth_id is not null;

-- 采用的收益率 of a weekly change under wealth_params p: change × factor, to 4 decimals, within min and max.
create function app_private.wealth_rate(p_change numeric, p jsonb) returns numeric
language sql immutable as $$
  select least((p ->> 'max')::numeric, greatest((p ->> 'min')::numeric, round(p_change * (p ->> 'factor')::numeric, 4)))
$$;

-- The Monday of a day's week.
create function app_private.week_of(p_day date) returns date
language sql immutable as $$
  select p_day - (extract(isodow from p_day)::integer - 1)
$$;

-- The index's weekly closes from eastmoney (data.klines: "YYYY-MM-DD,close", the date the week's last trading day), as
-- dolphin-jobs fetches them: each week over by p_today's Monday with the week before it gets a row, unless it has one.
-- The last kline may be a week not over yet, which waits. Returns the weeks added.
create function app_private.record_wealth_klines(p_klines jsonb, p_today date default app_private.cn_date(now())) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_params jsonb := app_private.setting('wealth_params');
  v_n integer;
begin
  if jsonb_typeof(p_klines) is distinct from 'array' then
    raise exception 'no klines';
  end if;
  insert into public.wealth_weeks (week_start, close, prev_close, change, rate, source, params)
  select w, c, pc, round(100 * c / pc - 100, 4), app_private.wealth_rate(round(100 * c / pc - 100, 4), v_params), 'eastmoney', v_params
  from (select app_private.week_of(split_part(e, ',', 1)::date) as w, split_part(e, ',', 2)::numeric as c,
          lag(app_private.week_of(split_part(e, ',', 1)::date)) over (order by i) as pw, lag(split_part(e, ',', 2)::numeric) over (order by i) as pc
        from jsonb_array_elements_text(p_klines) with ordinality k(e, i)) x
  where pw = w - 7 and w + 7 <= app_private.week_of(p_today) and c > 0 and pc > 0
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- 理财本金 of a student at a time, from the transactions dated before it (as term_total_on).
create function app_private.wealth_total_on(p_student_no text, p_at timestamptz) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(h.principal * case when coalesce(o.type, t.type) = 'wealth_buy' then 1 else -1 end
                                  * case when t.type = 'reversal' then -1 else 1 end), 0)::integer
  from public.wealth_holdings h join public.txns t on t.wealth_id = h.id left join public.txns o on o.id = t.reversal_of
  where h.student_no = p_student_no and t.created_at < p_at
$$;

-- Buys a holding at p_at: from the next Monday for p_weeks weeks, its last day the Sunday of the last. The callers have
-- checked the account, the amount and the length. The wealth_buy says the length and the last day:「12 周，2月8日 到期」.
create function app_private.start_wealth(p_id uuid, p_student_no text, p_amount integer, p_weeks integer,
  p_operator uuid, p_at timestamptz) returns public.wealth_holdings
language plpgsql security definer set search_path = '' as $$
declare
  v_day date := app_private.cn_date(p_at);
  v_start date := app_private.week_of(app_private.cn_date(p_at)) + 7;
  v_txn uuid := gen_random_uuid();
  v_account public.accounts;
  v_hold public.wealth_holdings;
begin
  update public.accounts set balance = balance - p_amount, wealth_total = wealth_total + p_amount, updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.wealth_holdings (id, student_no, principal, weeks, opened_on, starts_on, matures_on, value_centi, valued_to, open_txn)
  values (p_id, p_student_no, p_amount, p_weeks, v_day, v_start, v_start + 7 * p_weeks - 1, 100 * p_amount, v_start, v_txn)
  returning * into v_hold;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id, wealth_id, created_at)
  values (v_txn, 'wealth_buy', p_student_no, p_amount, -p_amount, v_account.balance,
    p_weeks || ' 周，' || to_char(v_hold.matures_on, 'FMMM月FMDD日') || ' 到期', p_operator,
    app_private.request_header('x-device-id'), p_id, p_at);
  return v_hold;
end
$$;

-- Ends an open holding as p_status (matured, redeemed) at its value: the value and the account's 零头 go back into 活期 as
-- one wealth_close at p_at, whole HTB, the rest kept in interest_carry. The reason says how it ended and the gain or loss
-- against the principal:「到期，盈 +3.20 HTB」「赎回，亏 −3.50 HTB」「到期，持平」. Null when it is not open.
create function app_private.end_wealth(p_id uuid, p_status text, p_operator uuid, p_at timestamptz) returns public.txns
language plpgsql security definer set search_path = '' as $$
declare
  v_hold public.wealth_holdings;
  v_account public.accounts;
  v_paid integer;
  v_gain integer;
  v_txn public.txns;
begin
  select * into v_account from public.accounts where student_no = (select student_no from public.wealth_holdings where id = p_id) for update;
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
    case p_status when 'matured' then '到期' else '赎回' end || '，' || case sign(v_gain) when 0 then '持平'
      else case when v_gain > 0 then '盈 +' else '亏 −' end || to_char(abs(v_gain) / 100.0, 'FM999999990.00') || ' HTB' end,
    p_operator, app_private.request_header('x-device-id'), v_hold.id, p_at)
  returning * into v_txn;
  update public.wealth_holdings set status = p_status, close_txn = v_txn.id where id = p_id;
  -- M14 货币监控：理财的盈利计为新增发行，亏损计为回收（§9.6）
  return v_txn;
end
$$;

-- 每周收益 (§10.10) by the end of p_day: each open holding takes, in order, the rate of every week it needs that is over
-- by then and in wealth_weeks, its value to 0.01 HTB (less dropped). A week without a rate holds up that holding's
-- later weeks and its maturity until it is entered.
create function app_private.value_wealth(p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
  v_all integer := 0;
begin
  loop
    update public.wealth_holdings h set value_centi = floor(h.value_centi * (100 + w.rate) / 100)::integer, valued_to = h.valued_to + 7
    from public.wealth_weeks w
    where h.status = 'open' and w.week_start = h.valued_to and h.valued_to + 6 <= p_day and h.valued_to < h.matures_on;
    get diagnostics v_n = row_count;
    exit when v_n = 0;
    v_all := v_all + v_n;
  end loop;
  return v_all;
end
$$;

-- 到期 (§10.10) at the end of p_day, in term or not, dated the next midnight, by the system login: each holding whose
-- last day has come and whose every week has been applied.
create function app_private.mature_wealth(p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_n integer := 0;
  r record;
begin
  for r in
    select id from public.wealth_holdings where status = 'open' and matures_on <= p_day and valued_to > matures_on order by student_no, id
  loop
    v_n := v_n + (app_private.end_wealth(r.id, 'matured', app_private.system_user(),
      (p_day + 1)::timestamp at time zone 'Asia/Shanghai') is not null)::integer;
  end loop;
  return v_n;
end
$$;

create function app_private.wealth_result(p_hold public.wealth_holdings, p_txn uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select app_private.txn_result(t) || jsonb_build_object('holding', to_jsonb(p_hold)) from public.txns t where t.id = p_txn
$$;

-- The weekly rates shown: the latest p_n weeks, newest first, without the parameters.
create function app_private.wealth_recent(p_n integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(w) - 'params' - 'created_by' order by w.week_start desc), '[]')
  from (select * from public.wealth_weeks order by week_start desc limit p_n) w
$$;

-- 买理财 (§10.10) at the counter: 1 HTB or more of 活期 for 2, 4, 12, 24 or 48 weeks, in term or in the holidays; none
-- while a loan is not paid off. p_id is the holding's id: sent again, it returns the same result.
create function public.buy_wealth(p_id uuid, p_student_no text, p_amount integer, p_weeks integer) returns jsonb
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
  if p_amount is null or p_amount <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  if p_amount > v_account.balance then
    perform app_private.fail('INSUFFICIENT_BALANCE', jsonb_build_object('balance', v_account.balance, 'short', p_amount - v_account.balance));
  end if;
  if exists (select 1 from public.loans where student_no = p_student_no and status in ('active', 'overdue')) then
    perform app_private.fail('LOAN_OUTSTANDING');
  end if;
  v_hold := app_private.start_wealth(p_id, p_student_no, p_amount, p_weeks, v_me, now());
  return app_private.wealth_result(v_hold, v_hold.open_txn);
end
$$;

-- 赎回 (§10.10) at the counter, at any time while it is open: its value as of the last week applied. Sent again, it
-- returns the same result.
create function public.redeem_wealth(p_holding_id uuid) returns jsonb
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
  v_txn := app_private.end_wealth(p_holding_id, 'redeemed', v_me, now());
  select * into v_hold from public.wealth_holdings where id = p_holding_id;
  return app_private.wealth_result(v_hold, v_txn.id);
end
$$;

-- The counter's 理财 panel (§16.1): the index, the lengths with the Monday each starts and its last day, the latest 6
-- weeks' rates (newest first; latest is the first or null), 活期, 理财本金 and every holding of the student, latest first.
create function public.wealth_quote(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_today date := app_private.cn_date(now());
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
      'index', (select jsonb_build_object('secid', p ->> 'secid', 'name', p ->> 'name') from (select app_private.setting('wealth_params') p) x),
      'options', (select jsonb_agg(jsonb_build_object('weeks', w, 'starts_on', app_private.week_of(v_today) + 7,
          'matures_on', app_private.week_of(v_today) + 7 * w + 6) order by w) from unnest(array[2, 4, 12, 24, 48]) w),
      'latest', v_recent -> 0, 'recent', v_recent,
      'balance', a.balance, 'wealth_total', a.wealth_total,
      'holdings', coalesce((select jsonb_agg(to_jsonb(h) order by h.opened_on desc, h.id) from public.wealth_holdings h
        where h.student_no = p_student_no), '[]'))
    from public.accounts a where a.student_no = p_student_no);
end
$$;

-- 后台「理财」 (§16.2): wealth_params, every week's rate newest first with who entered it, the weeks over that open
-- holdings still wait for (missing: Mondays, oldest first) and the holdings open in all. The holdings themselves are the
-- wealth_holdings table.
create function public.wealth_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_today date := app_private.cn_date(now());
begin
  return jsonb_build_object('params', app_private.setting('wealth_params'),
    'weeks', (select coalesce(jsonb_agg(to_jsonb(w) - 'params' || jsonb_build_object('created_by_name', p.display_name)
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

-- 手动登记 (§10.10) by the bank admin or the president, for a week over that has no rate: the rate itself (percentage,
-- up to 4 decimals, within wealth_params min and max) and where it came from. Once entered it is never changed; the
-- next run_daily applies it.
create function public.record_wealth_week(p_week date, p_rate numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_params jsonb := app_private.setting('wealth_params');
  v_row public.wealth_weeks;
begin
  if p_week is null or extract(isodow from p_week) <> 1 or p_week > app_private.week_of(app_private.cn_date(now())) - 7 then
    perform app_private.fail('INVALID_INPUT', '{"field":"week"}');
  end if;
  if p_rate is null or p_rate <> round(p_rate, 4) or p_rate not between (v_params ->> 'min')::numeric and (v_params ->> 'max')::numeric then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'rate', 'min', (v_params ->> 'min')::numeric, 'max', (v_params ->> 'max')::numeric));
  end if;
  if nullif(trim(p_note), '') is null or length(trim(p_note)) > 200 then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  insert into public.wealth_weeks (week_start, rate, source, note, params, created_by)
  values (p_week, p_rate, 'manual', trim(p_note), v_params, v_me)
  on conflict do nothing
  returning * into v_row;
  if v_row.week_start is null then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"week"}');
  end if;
  perform app_private.log('wealth.record', 'wealth_weeks:' || p_week, null, to_jsonb(v_row));
  return to_jsonb(v_row) - 'params';
end
$$;
grant execute on function public.buy_wealth(uuid, text, integer, integer), public.redeem_wealth(uuid), public.wealth_quote(text),
  public.wealth_overview(), public.record_wealth_week(date, numeric, text) to authenticated;

-- 存款余额 of a student at the end of the day, as in 20261116000100_term_deposits.sql, with the 理财本金 (§8.2, §9.1).
create or replace function app_private.deposits_on(p_student_no text, p_day date) returns integer
language sql stable security definer set search_path = '' as $$
  select app_private.balance_on(p_student_no, p_day)
    + app_private.term_total_on(p_student_no, (p_day + 1)::timestamp at time zone 'Asia/Shanghai')
    + app_private.wealth_total_on(p_student_no, (p_day + 1)::timestamp at time zone 'Asia/Shanghai')
$$;

-- publish_anchor as in 20261119000100_loans.sql, 存款余额 with the 理财本金 at the Monday's start.
create or replace function app_private.publish_anchor(p_week date, p_first boolean) returns public.rate_weeks
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := p_week::timestamp at time zone 'Asia/Shanghai';
  v_params jsonb := app_private.setting('anchor_params');
  v_prev numeric := app_private.anchor_on(p_week - 1);
  v_before integer := (select deposits from public.rate_weeks where week_start = p_week - 7);
  v_deposits integer;
  v_loans integer := app_private.loans_on(v_at);
  v_ratio numeric;
  v_growth numeric;
  v_adjust numeric := 0;
  v_row public.rate_weeks;
begin
  v_deposits := (select coalesce(sum(balance_delta), 0) from public.txns where created_at < v_at)
    + (select coalesce(sum(app_private.term_total_on(student_no, v_at)), 0) from (select distinct student_no from public.term_deposits) s)
    + (select coalesce(sum(app_private.wealth_total_on(student_no, v_at)), 0) from (select distinct student_no from public.wealth_holdings) s);
  v_ratio := case when v_deposits > 0 then round(100.0 * v_loans / v_deposits, 4) else 0 end;
  if not p_first and v_before is not null then
    v_growth := case when v_deposits > 0 and v_before > 0 then round(100.0 * v_deposits / v_before - 100, 4) else 0 end;
    v_adjust := app_private.anchor_adjust(v_ratio, v_growth, v_params);
  end if;
  insert into public.rate_weeks (week_start, prev_anchor, deposits, loans, ratio, growth, adjust, anchor, params)
  values (p_week, v_prev, v_deposits, v_loans, v_ratio, v_growth, v_adjust,
    least((v_params ->> 'max')::numeric, greatest((v_params ->> 'min')::numeric, v_prev + v_adjust)), v_params)
  on conflict (week_start) do nothing
  returning * into v_row;
  if v_row.week_start is null then
    select * into v_row from public.rate_weeks where week_start = p_week;
  end if;
  return v_row;
end
$$;

-- deposit_ranking as in 20261119000100_loans.sql, with the 理财本金 (§16.3).
create or replace function public.deposit_ranking(p_division text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if app_private.my_student_no() is null then
    perform app_private.fail('FORBIDDEN', '{"roles":["student"]}', '42501');
  end if;
  return (
  with division as (
    select coalesce(p_division, (select division from public.students where student_no = app_private.my_student_no())) as d
  ), held as (                        -- 活期 + 定期本金 + 理财本金 − 未还贷款本金, below 0 when the loan is more
    select s.student_no, s.name, s.cohort, public.class_label(s) as class_label, a.balance + a.term_total + a.wealth_total
      - coalesce((select l.remaining from public.loans l where l.student_no = s.student_no and l.status in ('active', 'overdue')), 0) as held
    from public.students s join public.accounts a on a.student_no = s.student_no
    where s.status = 'normal' and s.division = (select d from division)
  ), ranked as (
    select s.student_no, s.held as balance,
           rank() over (order by s.held desc) as place,
           row_number() over (order by s.held desc, s.student_no) as n,
           jsonb_build_object('rank', rank() over (order by s.held desc),
             'name', case when app_private.setting('ranking_anonymous') = 'true' then app_private.mask_name(s.name) else s.name end,
             'class_label', s.class_label, 'cohort', s.cohort, 'balance', s.held,
             'me', s.student_no is not distinct from app_private.my_student_no()) as j
    from held s
  )
  select jsonb_build_object('division', (select d from division), 'total', (select count(*) from ranked),
    'anonymous', app_private.setting('ranking_anonymous') = 'true',
    'top', (select coalesce(jsonb_agg(j order by n), '[]') from ranked where n <= app_private.setting('ranking_size')::integer),
    'me', (select jsonb_build_object('rank', r.place, 'balance', r.balance,
              'above', (select jsonb_build_object('rank', a.place, 'balance', a.balance) from ranked a
                        where a.balance > r.balance order by a.balance limit 1),
              'behind', (select count(*) from ranked b where b.balance < r.balance),
              'near', (select jsonb_agg(x.j order by x.n) from ranked x where x.n between r.n - 1 and r.n + 1))
           from ranked r where r.student_no = app_private.my_student_no())));
end
$$;

-- lookup_student as in 20261119000100_loans.sql, with the 理财: wealth_total (本金) and wealth_value_centi (现值, 0.01
-- HTB) of the holdings open (§16.1 查询).
create or replace function public.lookup_student(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
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
  return jsonb_build_object('student_no', v_student.student_no, 'name', v_student.name, 'division', v_student.division,
    'cohort', v_student.cohort, 'class_no', v_student.class_no, 'grade', public.grade(v_student),
    'class_label', public.class_label(v_student), 'status', v_student.status,
    'balance', (select balance from public.accounts where student_no = p_student_no),
    'term_total', (select term_total from public.accounts where student_no = p_student_no),
    'wealth_total', (select wealth_total from public.accounts where student_no = p_student_no),
    'wealth_value_centi', (select coalesce(sum(value_centi), 0) from public.wealth_holdings where student_no = p_student_no and status = 'open'),
    'loan_remaining', coalesce((select remaining from public.loans where student_no = p_student_no and status in ('active', 'overdue')), 0),
    'loan_overdue', exists (select 1 from public.loans where student_no = p_student_no and status = 'overdue'),
    'withdrawn_today', app_private.withdrawn_today(p_student_no),
    'credit', app_private.credit_info(p_student_no) - 'student_no');
end
$$;

-- require_duty as in 20261119000100_loans.sql, with 买理财 and 赎回 among the counter's business.
create or replace function app_private.require_duty() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_started timestamptz;
begin
  if new.type in ('deposit', 'withdraw', 'purchase', 'reversal', 'term_open', 'term_close', 'loan', 'repay', 'wealth_buy', 'wealth_close') and not new.offline
     and exists (select 1 from public.user_roles where user_id = new.operator_id and role = 'teller') then
    v_started := (select started_at from public.duty where user_id = new.operator_id and ended_at is null);
    if v_started is null then
      perform app_private.fail('OFF_DUTY');
    elsif app_private.cn_date(v_started) < app_private.cn_date(now()) then
      perform app_private.fail('STALE_DUTY', jsonb_build_object('started_at', v_started));
    end if;
  end if;
  return new;
end
$$;

-- reverse_txn as in 20261119000100_loans.sql, with the 理财 (§10.9): a wealth_buy (the teller their own of today, the
-- president and bank admin any) while its holding is open and no week has been applied to it, the principal back to
-- 活期; a 赎回 (the president and bank admin, up to the holding's last day) restores the holding at the value it had,
-- what it paid taken back out of 活期 and interest_carry; run_daily then applies the weeks it missed. A maturity is never
-- reversed.
create or replace function public.reverse_txn(p_id uuid, p_original_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'teacher');
  v_teacher boolean := app_private.has_role('teacher');
  v_orig public.txns;
  v_account public.accounts;
  v_txn public.txns;
  v_dep public.term_deposits;
  v_loan public.loans;
  v_hold public.wealth_holdings;
  v_pay public.loan_payments;
  v_amount integer;
  v_carry integer;
begin
  if p_reason is null or not (p_reason in ('金额录错', '学号录错', '业务选错') or p_reason ~ '^其他[：:]\s*\S') then
    perform app_private.fail('INVALID_INPUT', '{"field":"reason"}');
  end if;
  select * into v_orig from public.txns where id = p_original_id;
  if not found then
    perform app_private.fail('TXN_NOT_FOUND');
  end if;
  select * into v_account from public.accounts where student_no = v_orig.student_no for update;
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.txn_result(v_txn);
  end if;
  select * into v_orig from public.txns where id = p_original_id for update;
  select * into v_dep from public.term_deposits where id = v_orig.term_id for update;
  select * into v_loan from public.loans where id = v_orig.loan_id for update;
  select * into v_hold from public.wealth_holdings where id = v_orig.wealth_id for update;
  select * into v_pay from public.loan_payments where txn_id = v_orig.id;

  if v_orig.status <> 'normal'
     or not (v_orig.type in ('deposit', 'withdraw', 'purchase', 'term_open', 'loan', 'repay', 'wealth_buy')
             or (v_teacher and v_orig.type in ('opening', 'term_close', 'wealth_close')))
     or not (v_teacher or (v_orig.operator_id = v_me and app_private.cn_date(v_orig.created_at) = app_private.cn_date(now())))
     or v_orig.type = 'term_open' and v_dep.status <> 'open'
     or v_orig.type = 'term_close' and (v_dep.status <> 'early' or v_dep.matures_on < app_private.cn_date(now()))
     or v_orig.type = 'wealth_buy' and (v_hold.status <> 'open' or v_hold.valued_to > v_hold.starts_on)
     or v_orig.type = 'wealth_close' and (v_hold.status <> 'redeemed' or v_hold.matures_on < app_private.cn_date(now()))
     or v_orig.type = 'loan' and (v_loan.status <> 'active'
       or exists (select 1 from public.txns where loan_id = v_loan.id and type = 'repay' and status = 'normal'))
     or v_orig.type = 'repay' and (exists (select 1 from public.txns where loan_id = v_loan.id and type = 'repay' and status = 'normal' and seq > v_orig.seq)
       or v_loan.status = 'closed' and exists (select 1 from public.loans where student_no = v_loan.student_no and status in ('active', 'overdue'))) then
    perform app_private.fail('REVERSAL_NOT_ALLOWED');
  end if;
  -- What the reversal takes out of 活期 (negative: puts back), and the 零头 left.
  v_amount := v_orig.balance_delta;
  v_carry := v_account.interest_carry;
  if v_orig.type = 'term_close' then
    -- The interest paid comes back: its whole HTB were in this transaction, its 零头 in interest_carry; a carry since
    -- spent or grown past 1 HTB moves whole HTB between the two.
    v_carry := v_carry - v_dep.interest_centi + 100 * (v_orig.amount - v_dep.principal);
    v_amount := v_amount - floor(v_carry / 100.0)::integer;
    v_carry := v_carry - 100 * floor(v_carry / 100.0)::integer;
  elsif v_orig.type = 'wealth_close' then
    -- The value paid comes back the same way: its whole HTB here, the rest out of interest_carry.
    v_carry := v_carry - v_hold.value_centi + 100 * v_orig.amount;
    v_amount := v_amount - floor(v_carry / 100.0)::integer;
    v_carry := v_carry - 100 * floor(v_carry / 100.0)::integer;
  end if;
  if v_account.balance < v_amount then
    perform app_private.fail('REVERSAL_INSUFFICIENT_BALANCE', jsonb_build_object('balance', v_account.balance,
      'amount', case when v_orig.type in ('term_close', 'wealth_close') then v_amount else v_orig.amount end));
  end if;

  update public.accounts set balance = balance - v_amount,
    total_in = total_in - case when v_orig.type in ('deposit', 'opening') then v_orig.amount else 0 end,
    total_out = total_out - case when v_orig.type = 'withdraw' then v_orig.amount else 0 end,
    total_spent = total_spent - case when v_orig.type = 'purchase' and v_orig.payment = 'account' then v_orig.amount else 0 end,
    term_total = term_total + case v_orig.type when 'term_open' then -v_dep.principal when 'term_close' then v_dep.principal else 0 end,
    wealth_total = wealth_total + case v_orig.type when 'wealth_buy' then -v_hold.principal when 'wealth_close' then v_hold.principal else 0 end,
    interest_carry = v_carry,
    updated_at = now()
  where student_no = v_orig.student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, payment,
    reversal_of, reason, operator_id, device_id, term_id, loan_id, wealth_id)
  values (p_id, 'reversal', v_orig.student_no, case when v_orig.type = 'term_close' then v_amount when v_orig.type = 'wealth_close' then abs(v_amount)
    else v_orig.amount end,
    -v_amount, v_account.balance, -v_orig.cash_delta, v_orig.payment, v_orig.id, p_reason, v_me,
    app_private.request_header('x-device-id'), v_orig.term_id, v_orig.loan_id, v_orig.wealth_id)
  returning * into v_txn;
  update public.txns set status = 'reversed' where id = v_orig.id;

  if v_orig.type = 'purchase' then
    perform 1 from public.products where id in (select product_id from public.txn_items where txn_id = v_orig.id)
    order by id for update;
    update public.products p set stock = p.stock + i.qty, updated_at = now()
    from public.txn_items i where i.txn_id = v_orig.id and p.id = i.product_id;
    insert into public.stock_movements (product_id, kind, qty_delta, txn_id, operator_id)
    select product_id, 'reversal', qty, v_txn.id, v_me from public.txn_items where txn_id = v_orig.id;
  elsif v_orig.type = 'term_open' then
    update public.term_deposits set status = 'reversed' where id = v_dep.id;
  elsif v_orig.type = 'term_close' then
    update public.term_deposits set status = 'open', close_txn = null, interest_centi = null where id = v_dep.id;
  elsif v_orig.type = 'wealth_buy' then
    update public.wealth_holdings set status = 'reversed' where id = v_hold.id;
  elsif v_orig.type = 'wealth_close' then
    update public.wealth_holdings set status = 'open', close_txn = null where id = v_hold.id;
  elsif v_orig.type = 'loan' then
    -- 作废: no interest, no points
    update public.loans set status = 'reversed', remaining = 0, interest_centi = 0 where id = v_loan.id;
  elsif v_orig.type = 'repay' then
    update public.loan_periods p set principal = (e ->> 'principal')::integer, paid = (e ->> 'paid')::integer
    from jsonb_array_elements(v_pay.before -> 'periods') e where p.loan_id = v_loan.id and p.seq = (e ->> 'seq')::integer;
    update public.loans set remaining = remaining + v_pay.principal,
      interest_centi = case when status = 'closed' then (v_pay.before ->> 'interest_centi')::integer else interest_centi + 100 * v_pay.interest end,
      closed_on = null,
      status = case when exists (select 1 from public.loan_periods where loan_id = v_loan.id and paid < principal and overdue_at is not null)
        then 'overdue' else 'active' end
    where id = v_loan.id;
    perform app_private.mark_overdue(v_loan.id, app_private.cn_date(now()) - 1, now());
  end if;

  perform app_private.log('txn.reverse', 'txns:' || v_orig.id, to_jsonb(v_orig), to_jsonb(v_txn));
  return app_private.txn_result(v_txn);
end
$$;

-- run_daily as in 20261120000100_fixed_term.sql, with the 理财 after the 定期 that matured, in the holidays too: the
-- weeks over by the day's end, then the holdings whose last day it is.
create or replace function app_private.run_daily(p_day date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done date;
  v_term public.terms := app_private.current_term(p_day);
begin
  select done_to into v_done from public.job_runs where job = 'daily' for update;
  if p_day <= v_done then
    return jsonb_build_object('job', 'daily', 'day', p_day, 'status', 'skipped');
  end if;
  if p_day <> v_done + 1 or p_day >= app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'day', 'next', v_done + 1));
  end if;
  -- In this order (§13); in the holidays only the 定期 and 理财.
  if v_term.id is not null then
    perform app_private.accrue_interest(p_day);
  end if;
  perform app_private.mature_term_deposits(p_day);
  perform app_private.value_wealth(p_day);
  perform app_private.mature_wealth(p_day);
  if v_term.id is not null then
    perform app_private.collect_loans(p_day, p_day = v_term.ends_on);
    perform app_private.accrue_loans(p_day);
    if p_day = v_term.ends_on then
      perform app_private.settle_interest((p_day + 1)::timestamp at time zone 'Asia/Shanghai');
    end if;
  end if;
  update public.job_runs set done_to = p_day, last_ok = now(), last_err = null where job = 'daily';
  return jsonb_build_object('job', 'daily', 'day', p_day, 'status', case when v_term.id is null then 'holiday' else 'done' end,
    'term_id', v_term.id);
end
$$;

-- close_accounts as in 20261119000100_loans.sql: a student's 理财 open are redeemed at their value first (§10.10).
create or replace function public.close_accounts(p_user_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_uid uuid;
  v_student public.students;
  v_account public.accounts;
  v_loan_no text;
  v_cleared integer := 0;
  v_closed jsonb := '[]';
begin
  perform app_private.forbid_president();
  if coalesce(cardinality(p_user_ids), 0) = 0 or v_me = any(p_user_ids) then
    perform app_private.fail('INVALID_INPUT', '{"field":"user_id"}');
  end if;
  for v_uid in select distinct u from unnest(p_user_ids) u order by u loop
    if not exists (select 1 from public.profiles where id = v_uid and closed_at is null) then
      perform app_private.fail('USER_NOT_FOUND');
    end if;
    perform app_private.guard_teacher(app_private.is_teacher(v_uid));
    if app_private.is_teacher(v_uid) then
      perform app_private.fail('INVALID_INPUT', '{"field":"user_id"}');
    end if;
    select * into v_student from public.students where user_id = v_uid;
    if found then
      v_loan_no := (select loan_no from public.loans where student_no = v_student.student_no and status in ('active', 'overdue'));
      if v_loan_no is not null then
        perform app_private.fail('LOAN_OUTSTANDING', jsonb_build_object('student_no', v_student.student_no, 'loan_no', v_loan_no));
      end if;
      perform app_private.end_wealth(h.id, 'redeemed', v_me, now())
      from public.wealth_holdings h where h.student_no = v_student.student_no and h.status = 'open';
      perform app_private.end_term_deposit(d.id, 'early', 0, v_me, now())
      from public.term_deposits d where d.student_no = v_student.student_no and d.status = 'open';
      select * into v_account from public.accounts where student_no = v_student.student_no for update;
      if v_account.balance > 0 then
        update public.accounts set balance = 0, updated_at = now() where student_no = v_student.student_no;
        insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id)
        values (gen_random_uuid(), 'closing', v_student.student_no, v_account.balance, -v_account.balance, 0, '注销账号',
          v_me, app_private.request_header('x-device-id'));
        v_cleared := v_cleared + v_account.balance;
      end if;
      update public.students set status = 'closed' where student_no = v_student.student_no;
      update public.staff_payroll set account = null, attendance = false where account = v_student.student_no;
    end if;
    update public.staff_payroll set account = null, attendance = false where user_id = v_uid;
    update public.profiles set disabled = true, closed_at = now() where id = v_uid;
    update auth.users set banned_until = '9999-12-31' where id = v_uid;
    perform app_private.end_sessions(v_uid);
    v_closed := v_closed || jsonb_build_object('user_id', v_uid, 'name', (select display_name from public.profiles where id = v_uid),
      'balance', case when v_student.user_id = v_uid then v_account.balance end);
    v_student := null;
    v_account := null;
  end loop;
  perform app_private.log('user.close', null, null, jsonb_build_object('closed', v_closed, 'cleared', v_cleared));
  return jsonb_build_object('closed', jsonb_array_length(v_closed), 'cleared', v_cleared);
end
$$;

-- check_balances as in 20261119000100_loans.sql, with kind wealth (理财本金合计与 wealth_holdings 一致) and the 理财 in kind
-- interest: what each wealth_close paid over its principal (less what its reversal took back) against value − principal
-- of the holdings closed, as for the 定期 interest.
create or replace function app_private.check_balances() returns table (kind text, key text, recorded integer, expected bigint)
language plpgsql security definer set search_path = '' as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(r), '[]') into v_rows from (
    select 'account' as kind, a.student_no as key, a.balance as recorded, coalesce(sum(t.balance_delta), 0) as expected
    from public.accounts a left join public.txns t on t.student_no = a.student_no
    group by a.student_no, a.balance having a.balance <> coalesce(sum(t.balance_delta), 0)
    union all
    select 'product', p.id::text, p.stock, coalesce(sum(m.qty_delta), 0)
    from public.products p left join public.stock_movements m on m.product_id = p.id
    group by p.id, p.stock having p.stock <> coalesce(sum(m.qty_delta), 0)
    union all
    select 'balance_after', c.txn_no, c.balance_after, c.expected
    from (select txn_no, balance_after,
            coalesce(lag(balance_after) over (partition by student_no order by seq), 0)::bigint + balance_delta as expected
          from public.txns) c
    where c.balance_after <> c.expected
    union all
    select x.kind, x.key, x.recorded, x.expected
    from (select a.student_no, a.total_in, a.total_out, a.total_spent,
            coalesce(sum(t.amount) filter (where t.type in ('deposit', 'opening')), 0) as e_in,
            coalesce(sum(t.amount) filter (where t.type = 'withdraw'), 0) as e_out,
            coalesce(sum(t.amount) filter (where t.type = 'purchase' and t.payment = 'account'), 0) as e_spent
          from public.accounts a left join public.txns t on t.student_no = a.student_no and t.status = 'normal'
          group by a.student_no) s,
      lateral (values ('total_in', s.student_no, s.total_in, s.e_in), ('total_out', s.student_no, s.total_out, s.e_out),
                      ('total_spent', s.student_no, s.total_spent, s.e_spent)) x(kind, key, recorded, expected)
    where x.recorded <> x.expected
    union all
    select 'txn_items', t.txn_no, t.amount, coalesce(sum(i.unit_price * i.qty), 0)
    from public.txns t left join public.txn_items i on i.txn_id = t.id
    where t.type = 'purchase'
    group by t.id, t.txn_no, t.amount having t.amount <> coalesce(sum(i.unit_price * i.qty), 0)
    union all
    -- 利息累计与计息记录一致 (PHASE-2.md §14.1), 活期 and 定期
    select 'interest', a.student_no, (100 * (coalesce(p.paid, 0) + coalesce(tp.paid, 0) + coalesce(wp.paid, 0)) + a.interest_carry)::integer,
      coalesce(s.centi, 0) + coalesce(te.centi, 0) + coalesce(we.centi, 0)
    from public.accounts a
      left join (select student_no, sum(amount) as paid from public.txns where type = 'interest' group by student_no) p using (student_no)
      left join (select student_no, sum(centi) as centi from public.interest_accruals where settled_txn is not null group by student_no) s using (student_no)
      left join (select t.student_no, sum(case when t.type = 'term_close' then t.amount - d.principal else d.principal - t.amount end) as paid
                 from public.txns t join public.term_deposits d on d.id = t.term_id left join public.txns o on o.id = t.reversal_of
                 where t.type = 'term_close' or o.type = 'term_close' group by t.student_no) tp using (student_no)
      left join (select student_no, sum(interest_centi) as centi from public.term_deposits where status in ('matured', 'early')
                 group by student_no) te using (student_no)
      left join (select t.student_no, sum(case when t.type = 'wealth_close' then t.balance_delta - h.principal else h.principal + t.balance_delta end) as paid
                 from public.txns t join public.wealth_holdings h on h.id = t.wealth_id left join public.txns o on o.id = t.reversal_of
                 where t.type = 'wealth_close' or o.type = 'wealth_close' group by t.student_no) wp using (student_no)
      left join (select student_no, sum(value_centi - 100 * principal) as centi from public.wealth_holdings where status in ('matured', 'redeemed')
                 group by student_no) we using (student_no)
    where 100 * (coalesce(p.paid, 0) + coalesce(tp.paid, 0) + coalesce(wp.paid, 0)) + a.interest_carry
      <> coalesce(s.centi, 0) + coalesce(te.centi, 0) + coalesce(we.centi, 0)
    union all
    -- 定期本金合计与 term_deposits 一致 (§14.1)
    select 'term', a.student_no, a.term_total, coalesce(sum(d.principal) filter (where d.status = 'open'), 0)
    from public.accounts a left join public.term_deposits d using (student_no)
    group by a.student_no, a.term_total having a.term_total <> coalesce(sum(d.principal) filter (where d.status = 'open'), 0)
    union all
    -- 理财本金合计与 wealth_holdings 一致 (§14.1)
    select 'wealth', a.student_no, a.wealth_total, coalesce(sum(h.principal) filter (where h.status = 'open'), 0)
    from public.accounts a left join public.wealth_holdings h using (student_no)
    group by a.student_no, a.wealth_total having a.wealth_total <> coalesce(sum(h.principal) filter (where h.status = 'open'), 0)
    union all
    -- 贷款剩余本金与放款、还款流水一致 (§14.1)
    select 'loan', l.loan_no, l.remaining, coalesce(sum(case when t.type = 'loan' then t.amount else -p.principal end), 0)
    from public.loans l left join public.txns t on t.loan_id = l.id and t.type in ('loan', 'repay') and t.status = 'normal'
      left join public.loan_payments p on p.txn_id = t.id
    group by l.id, l.loan_no, l.remaining having l.remaining <> coalesce(sum(case when t.type = 'loan' then t.amount else -p.principal end), 0)
    union all
    select 'loan_plan', l.loan_no, l.remaining, sum(p.principal - p.paid)
    from public.loans l join public.loan_periods p on p.loan_id = l.id
    where l.status <> 'reversed'
    group by l.id, l.loan_no, l.remaining having l.remaining <> sum(p.principal - p.paid)
  ) r;
  if jsonb_array_length(v_rows) > 0 then
    perform app_private.log('check.mismatch', null, null, v_rows);
  end if;
  return query select * from jsonb_to_recordset(v_rows) as x(kind text, key text, recorded integer, expected bigint);
end
$$;

-- set_setting as in 20261120000100_fixed_term.sql, with wealth_params (§14.3): the index's eastmoney secid and the name
-- shown, the factor 0.01–10 and the weekly bounds, min −50–0 and max 0–50, up to 4 decimals.
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
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['factor', 'max', 'min', 'name', 'secid']
       or coalesce(p_value ->> 'secid', '') !~ '^[0-9]{1,3}\.[A-Za-z0-9_]{1,20}$' or jsonb_typeof(p_value -> 'secid') <> 'string'
       or jsonb_typeof(p_value -> 'name') is distinct from 'string' or length(trim(p_value ->> 'name')) not between 1 and 20
       or not app_private.json_num_between(p_value -> 'factor', 0.01, 10)
       or not app_private.json_num_between(p_value -> 'min', -50, 0)
       or not app_private.json_num_between(p_value -> 'max', 0, 50) then
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
