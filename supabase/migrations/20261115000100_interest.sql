-- 利率与活期利息 (PHASE-2.md §9.1–9.4, §9.6, §13, §14): every Monday in term run_weekly pays last week's 活期利息, then
-- publishes the week's 锚点 in rate_weeks; every day in term run_daily accrues each student's 活期利息 in
-- interest_accruals. All rates are weekly percentages hung on the anchor. Accruals and the anchor read the day or the
-- Monday they are for, never now(): balances by the transactions dated before it and scores by the credit events dated
-- before it, so a catch-up gives what running every day would have.

-- §14.3. anchor_params: the anchor's start and bounds, the 存贷比 and 增速 targets with the step that moves the anchor by
-- weight, and the most one week moves it (percentages, percentage points). The multipliers of 定期, 贷款 and 罚息 (§9.2).
insert into public.settings (key, value) values
  ('anchor_params', '{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4}'),
  ('term_multipliers', '{"2":1.25,"4":1.5,"8":2}'),
  ('loan_multiplier', '2'),
  ('penalty_multiplier', '1.5');

create table public.rate_weeks (              -- 每周的锚点
  week_start  date primary key,               -- 周一
  prev_anchor numeric(6,2) not null,          -- 上周锚点（百分数）
  deposits    integer not null,               -- 存款余额（活期 + 定期）at the Monday's start
  loans       integer not null,               -- 贷款剩余本金
  ratio       numeric(12,4) not null,         -- 存贷比（百分数）
  growth      numeric(12,4),                  -- 增速（百分数）; null when the anchor is not adjusted
  adjust      numeric(6,2) not null,          -- 调整（百分点）
  anchor      numeric(6,2) not null,          -- 本周锚点（百分数）
  params      jsonb not null,                 -- anchor_params at the time
  created_at  timestamptz not null default now()
);
create trigger append_only before update or delete on public.rate_weeks for each row execute function app_private.append_only();

create table public.interest_accruals (       -- 活期每天每人一行
  student_no  text not null references public.students(student_no),
  day         date not null,
  balance     integer not null,               -- 当天结束时的活期余额
  rate        numeric(8,4) not null,          -- 当天活期周利率（百分数）
  centi       integer not null,               -- 当天利息，单位 0.01 HTB
  settled_txn uuid references public.txns(id), -- 结息流水
  primary key (student_no, day)
);
create index on public.interest_accruals (student_no) where settled_txn is null;

-- 未入账的零头 (0.01 HTB): what a settlement left below 1 HTB, paid with a later one.
alter table public.accounts add column interest_carry integer not null default 0 check (interest_carry between 0 and 99);

alter table public.rate_weeks enable row level security;
alter table public.interest_accruals enable row level security;
grant select on public.rate_weeks, public.interest_accruals to authenticated;
-- 利率 (§3, §16.2): the accountant, president and bank admin. A student reads their own accruals; their rates come from
-- interest_profile.
create policy read on public.rate_weeks for select to authenticated using (
  (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));
create policy read on public.interest_accruals for select to authenticated using (
  student_no = (select app_private.my_student_no())
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

-- The system login (§14.2) that 结息 and M11's automatic repayments are made by: closed and banned, so no one signs in as
-- it and it is in no staff list.
do $$
declare
  v_id uuid := app_private.create_login('system@staff.dolphin.internal', gen_random_uuid()::text);
begin
  update auth.users set banned_until = '9999-12-31' where id = v_id;
  insert into public.profiles (id, login_kind, login_id, display_name, must_change_password, disabled, closed_at)
  values (v_id, 'staff', 'system', '系统', false, true, now());
end $$;

create function app_private.system_user() returns uuid
language sql stable security definer set search_path = '' as $$
  select id from public.profiles where login_kind = 'staff' and login_id = 'system'
$$;

-- The factors of the credit curve unrounded, for the rates; the 4-decimal factors shown (§8.1) round them. A rate rounds
-- once, at the end: 2 × 2 × 1.5666… = 6.2667, as §9.2 has it.
create function app_private.saving_factor_raw(p_score integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select (c ->> 'saving_min')::numeric + p_score * ((c ->> 'saving_max')::numeric - (c ->> 'saving_min')::numeric) / 1000
  from (select app_private.setting('credit_curve') c) s
$$;
create function app_private.loan_factor_raw(p_score integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when p_score >= m then
    (c ->> 'loan_max')::numeric - (p_score - m) * ((c ->> 'loan_max')::numeric - (c ->> 'loan_min')::numeric) / (1000 - m)
  end
  from (select app_private.setting('credit_curve') c) s, lateral (select (c ->> 'min_score')::integer m) x
$$;
-- saving_factor and loan_factor as in 20261114000000_credit.sql, rounding the unrounded factors.
create or replace function app_private.saving_factor(p_score integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(app_private.saving_factor_raw(p_score), 4)
$$;
create or replace function app_private.loan_factor(p_score integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(app_private.loan_factor_raw(p_score), 4)
$$;

-- The rates of §9.2: weekly percentages with 4 decimals, from an anchor and a score. M10 locks term_rate when a 定期 is
-- opened; M11 locks loan_rate when a loan is made and charges penalty_rate on an overdue one. No loan rate below the
-- curve's min_score, and no 定期 rate for a term length without a multiplier.
create function app_private.saving_rate(p_anchor numeric, p_score integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(p_anchor * app_private.saving_factor_raw(p_score), 4)
$$;
create function app_private.term_rate(p_anchor numeric, p_weeks integer, p_score integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(p_anchor * (app_private.setting('term_multipliers') ->> p_weeks::text)::numeric * app_private.saving_factor_raw(p_score), 4)
$$;
create function app_private.loan_rate(p_anchor numeric, p_score integer) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(p_anchor * (app_private.setting('loan_multiplier') #>> '{}')::numeric * app_private.loan_factor_raw(p_score), 4)
$$;
create function app_private.penalty_rate(p_loan_rate numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select round(p_loan_rate * (app_private.setting('penalty_multiplier') #>> '{}')::numeric, 4)
$$;

-- Every rate a score gets under an anchor: {"current", "term": {"2", "4", "8"}, "loan"}.
create function app_private.rates(p_anchor numeric, p_score integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('current', app_private.saving_rate(p_anchor, p_score),
    'term', (select jsonb_object_agg(k, app_private.term_rate(p_anchor, k::integer, p_score))
             from jsonb_object_keys(app_private.setting('term_multipliers')) k),
    'loan', app_private.loan_rate(p_anchor, p_score))
$$;

-- The week's 锚点 on a day: the one published on the latest Monday up to it (after the holidays, the one from before
-- them), or anchor_params.initial before the first.
create function app_private.anchor_on(p_day date) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select anchor from public.rate_weeks where week_start <= p_day order by week_start desc limit 1),
    (app_private.setting('anchor_params') ->> 'initial')::numeric)
$$;

-- 调整 (§9.1) from 存贷比 and 增速 (percentages) under anchor_params p: +weight per ratio_step above ratio_target, −weight
-- per growth_step above growth_target, within ±max_adjust, to 2 decimals.
create function app_private.anchor_adjust(p_ratio numeric, p_growth numeric, p jsonb) returns numeric
language sql immutable as $$
  select round(greatest(-(p ->> 'max_adjust')::numeric, least((p ->> 'max_adjust')::numeric,
    (p ->> 'weight')::numeric * (p_ratio - (p ->> 'ratio_target')::numeric) / (p ->> 'ratio_step')::numeric
    - (p ->> 'weight')::numeric * (p_growth - (p ->> 'growth_target')::numeric) / (p ->> 'growth_step')::numeric)), 2)
$$;

-- 计算并公布本周锚点 (§9.1) for the Monday p_week, from the balances at its start. A term's first Monday (p_first) and a
-- Monday with no row for the Monday before keep the last anchor: the 增速 since a holiday, or since nothing, means
-- nothing. 存贷比 and 增速 are 0 while there are no deposits. The row keeps every input and anchor_params, so any week can
-- be worked out again; a week already published keeps its row.
create function app_private.publish_anchor(p_week date, p_first boolean) returns public.rate_weeks
language plpgsql security definer set search_path = '' as $$
declare
  v_at timestamptz := p_week::timestamp at time zone 'Asia/Shanghai';
  v_params jsonb := app_private.setting('anchor_params');
  v_prev numeric := app_private.anchor_on(p_week - 1);
  v_before integer := (select deposits from public.rate_weeks where week_start = p_week - 7);
  v_deposits integer;
  v_loans integer := 0;               -- M11 贷款剩余本金 at v_at
  v_ratio numeric;
  v_growth numeric;
  v_adjust numeric := 0;
  v_row public.rate_weeks;
begin
  v_deposits := (select coalesce(sum(balance_delta), 0) from public.txns where created_at < v_at);
  -- M10 加上 v_at 时的定期本金
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

-- 活期 at the end of the day (Asia/Shanghai): the transactions dated before midnight, whatever order they were written in
-- (结息 is dated the Monday's midnight even when a catch-up writes it later). As in 20261114000000_credit.sql otherwise.
create or replace function app_private.balance_on(p_student_no text, p_day date) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(balance_delta), 0)::integer from public.txns
  where student_no = p_student_no and created_at < (p_day + 1)::timestamp at time zone 'Asia/Shanghai'
$$;

-- 信用分 at the end of the day: today's score less every change dated after that day's midnight.
create function app_private.score_on(p_student_no text, p_day date) returns integer
language sql stable security definer set search_path = '' as $$
  select greatest(0, least(1000, c.score - coalesce((select sum(e.delta) from public.credit_events e
    where e.student_no = c.student_no and e.at >= (p_day + 1)::timestamp at time zone 'Asia/Shanghai'), 0)))::integer
  from public.credit_scores c where c.student_no = p_student_no
$$;

-- 活期计息 (§9.3) for the day p_day in term: each 在读 account opened by then, one row, at the week's anchor and the
-- student's score at the end of the day; the interest to 0.01 HTB, less dropped. 冻结、毕业、注销 accounts get no row (by
-- their status when the job runs). A day already accrued keeps its rows.
create function app_private.accrue_interest(p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_anchor numeric := app_private.anchor_on(p_day);
  v_n integer;
begin
  insert into public.interest_accruals (student_no, day, balance, rate, centi)
  select student_no, p_day, balance, rate, floor(balance * rate / 7)::integer
  from (select s.student_no, app_private.balance_on(s.student_no, p_day) as balance,
          app_private.saving_rate(v_anchor, app_private.score_on(s.student_no, p_day)) as rate
        from public.students s
        where s.status = 'normal' and s.opened_at < (p_day + 1)::timestamp at time zone 'Asia/Shanghai') x
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- 结息 (§9.4): each account's unsettled accruals and carry; the whole HTB as one interest transaction dated p_at, the
-- rest kept as interest_carry. Accruals that add up to less than 1 HTB stay unsettled for the next one, so the settled
-- accruals always equal 100 × the interest paid + the carry (check_balances). 注销 accounts are not paid.
create function app_private.settle_interest(p_at timestamptz) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_system uuid := app_private.system_user();
  v_account public.accounts;
  v_txn public.txns;
  v_n integer := 0;
  r record;
begin
  for r in
    select a.student_no, a.interest_carry + sum(i.centi) as total, min(i.day) as first, max(i.day) as last
    from public.accounts a join public.students s using (student_no)
      join public.interest_accruals i on i.student_no = a.student_no and i.settled_txn is null
    where s.status <> 'closed'
    group by a.student_no, a.interest_carry
    having a.interest_carry + sum(i.centi) >= 100
    order by a.student_no
  loop
    update public.accounts set balance = balance + r.total / 100, interest_carry = r.total % 100, updated_at = now()
    where student_no = r.student_no returning * into v_account;
    insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, created_at)
    values (gen_random_uuid(), 'interest', r.student_no, r.total / 100, r.total / 100, v_account.balance,
      case when r.first = r.last then to_char(r.first, 'FMMM月FMDD日') else to_char(r.first, 'FMMM月FMDD日') || '至' || to_char(r.last, 'FMMM月FMDD日') end
        || '活期利息', v_system, p_at)
    returning * into v_txn;
    update public.interest_accruals set settled_txn = v_txn.id where student_no = r.student_no and settled_txn is null;
    v_n := v_n + 1;
  end loop;
  -- M14 货币监控：interest 流水计为电子币新增（§9.6）
  return v_n;
end
$$;

-- 待入账利息 (§9.4), in 0.01 HTB: the carry and every accrual not yet paid.
create function app_private.pending_interest(p_student_no text) returns integer
language sql stable security definer set search_path = '' as $$
  select a.interest_carry + coalesce((select sum(centi) from public.interest_accruals i
    where i.student_no = a.student_no and i.settled_txn is null), 0)::integer
  from public.accounts a where a.student_no = p_student_no
$$;

-- 本周各项利率与待入账利息 for the student app (no argument: their own) and the back office (a student number: the
-- accountant, president and bank admin), at this week's anchor and the student's score now.
create function public.interest_profile(p_student_no text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_no text := app_private.my_student_no();
  v_today date := app_private.cn_date(now());
  v_anchor numeric := app_private.anchor_on(v_today);
begin
  if p_student_no is null or p_student_no is not distinct from v_no then
    if v_no is null then
      perform app_private.fail('FORBIDDEN', '{"roles":["student"]}', '42501');
    end if;
  else
    perform app_private.require_role('accountant', 'teacher');
    v_no := p_student_no;
    if not exists (select 1 from public.students where student_no = v_no) then
      perform app_private.fail('STUDENT_NOT_FOUND');
    end if;
  end if;
  return (select jsonb_build_object('student_no', v_no, 'score', c.score,
      'week_start', (select max(week_start) from public.rate_weeks where week_start <= v_today), 'anchor', v_anchor,
      'rates', app_private.rates(v_anchor, c.score), 'pending_centi', app_private.pending_interest(v_no))
    from public.credit_scores c where c.student_no = v_no);
end
$$;

-- 后台「利率」 (§16.2): this week's anchor and the rates of §9.2's scores (and the curve's min_score) under it. The weekly
-- history is the rate_weeks table; the parameters are in settings.
create function public.rate_overview() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_today date := app_private.cn_date(now());
  v_anchor numeric := app_private.anchor_on(v_today);
begin
  return jsonb_build_object('week_start', (select max(week_start) from public.rate_weeks where week_start <= v_today),
    'anchor', v_anchor,
    'table', (select jsonb_agg(jsonb_build_object('score', s) || app_private.rates(v_anchor, s) order by s)
              from (select distinct unnest(array[0, (app_private.setting('credit_curve') ->> 'min_score')::integer, 600, 750, 900, 1000]) s) x));
end
$$;
grant execute on function public.interest_profile(text), public.rate_overview() to authenticated;

-- run_daily as in 20261113000000_terms_jobs.sql, with 活期计息 and, on the term's last day, 结清 the interest of its last
-- days (dated the next midnight): the Monday after a term is in the holidays.
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
  if v_term.id is not null then
    -- In term, in this order (§13):
    perform app_private.accrue_interest(p_day);
    -- M11 贷款计息
    -- M10 到期的定期转回活期并付息（利息零头并入 interest_carry，在下面的结息之前）
    -- M11 应还日到期的分期自动扣款或记逾期；逾期贷款自动扣款
    if p_day = v_term.ends_on then
      perform app_private.settle_interest((p_day + 1)::timestamp at time zone 'Asia/Shanghai');
    end if;
  end if;
  update public.job_runs set done_to = p_day, last_ok = now(), last_err = null where job = 'daily';
  return jsonb_build_object('job', 'daily', 'day', p_day, 'status', case when v_term.id is null then 'holiday' else 'done' end,
    'term_id', v_term.id);
end
$$;

-- run_weekly as in 20261114000000_credit.sql, with 结息 (dated the Monday's midnight) and the week's anchor.
create or replace function app_private.run_weekly(p_week date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_done date;
  v_term public.terms := app_private.current_term(p_week);
  v_first boolean := v_term.starts_on > p_week - 7;
begin
  select done_to into v_done from public.job_runs where job = 'weekly' for update;
  if p_week <= v_done then
    return jsonb_build_object('job', 'weekly', 'day', p_week, 'status', 'skipped');
  end if;
  if extract(isodow from p_week) <> 1 or p_week > v_done + 7
     or (select done_to from public.job_runs where job = 'daily') < p_week - 1 then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'week'));
  end if;
  if v_term.id is not null then
    -- In term, in this order (§13):
    perform app_private.settle_interest(p_week::timestamp at time zone 'Asia/Shanghai');
    if not v_first then
      perform app_private.credit_weekly(p_week);
      -- M11 逾期后仍未还清每满一周：credit_change(student_no, null, 'overdue_week', '贷款逾期满 N 周', 'loans:<id>:' || p_week, null, <周一 0 点>)
    end if;
    perform app_private.publish_anchor(p_week, v_first);
  end if;
  update public.job_runs set done_to = p_week, last_ok = now(), last_err = null where job = 'weekly';
  return jsonb_build_object('job', 'weekly', 'day', p_week, 'status', case when v_term.id is null then 'holiday' else 'done' end,
    'term_id', v_term.id, 'first', coalesce(v_first, false));
end
$$;

-- credit_change as in 20261114000000_credit.sql, with the time the change is dated: the weekly rules date theirs the
-- Monday's midnight, so the scores of the days after it read the same in a catch-up.
drop function app_private.credit_change(text, integer, text, text, text, uuid);
create function app_private.credit_change(p_student_no text, p_delta integer, p_rule text, p_reason text,
  p_ref text default null, p_actor uuid default null, p_at timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_old integer;
  v_new integer;
  v_event public.credit_events;
begin
  if p_rule is null or p_rule <> 'manual' and not app_private.setting('credit_rules') ? p_rule
     or p_rule = 'manual' and p_delta is null or nullif(trim(p_reason), '') is null then
    perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'rule', 'rule', p_rule));
  end if;
  select score into v_old from public.credit_scores where student_no = p_student_no for update;
  if v_old is null then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  v_new := greatest(0, least(1000, v_old + coalesce(p_delta, (app_private.setting('credit_rules') ->> p_rule)::integer)));
  if v_new = v_old then
    return null;
  end if;
  insert into public.credit_events (student_no, at, delta, score, rule, reason, ref, actor_id)
  values (p_student_no, p_at, v_new - v_old, v_new, p_rule, trim(p_reason), p_ref, p_actor)
  on conflict (student_no, rule, ref) where ref is not null do nothing
  returning * into v_event;
  if v_event.id is null then
    return null;
  end if;
  update public.credit_scores set score = v_new, updated_at = now() where student_no = p_student_no;
  return to_jsonb(v_event);
end
$$;

-- credit_weekly as in 20261114000000_credit.sql, its changes dated the Monday's midnight.
create or replace function app_private.credit_weekly(p_week date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_from timestamptz := (p_week - 7)::timestamp at time zone 'Asia/Shanghai';
  v_to timestamptz := p_week::timestamp at time zone 'Asia/Shanghai';
  v_ref text := 'weeks:' || p_week;
  v_n integer := 0;
  r record;
begin
  for r in
    with counted as (               -- 柜台存款 and 取款 not reversed by p_week
      select t.student_no, t.type, t.amount, t.created_at, app_private.cn_date(t.created_at) as day from public.txns t
      where t.type in ('deposit', 'withdraw') and t.created_at < v_to
        and not exists (select 1 from public.txns x where x.reversal_of = t.id and x.created_at < v_to)
    ), last_week as (
      select student_no, bool_or(type = 'deposit') as deposited, coalesce(sum(amount) filter (where type = 'withdraw'), 0) as withdrawn
      from counted where created_at >= v_from group by student_no
    ), streaks as (                 -- weeks with a deposit, counted back from last week until one without
      select student_no, count(*) filter (where w = p_week - 7 * k) as streak
      from (select student_no, w, (row_number() over (partition by student_no order by w desc))::integer as k
            from (select distinct student_no, day - (extract(isodow from day)::integer - 1) as w from counted where type = 'deposit') d) x
      group by student_no
    )
    select s.student_no, app_private.cn_date(s.opened_at) as opened, coalesce(l.deposited, false) as deposited,
      coalesce(k.streak, 0) as streak, coalesce(l.withdrawn, 0) as withdrawn,
      app_private.balance_on(s.student_no, p_week - 8) as start_balance,
      -- 日均余额 by the end of each day; M10 adds each day's 定期本金 here
      (select sum(app_private.balance_on(s.student_no, d::date)) from generate_series(p_week - 7, p_week - 1, interval '1 day') d) as balance_sum
    from public.students s left join last_week l using (student_no) left join streaks k using (student_no)
    where s.status = 'normal' and app_private.cn_date(s.opened_at) < p_week
    order by s.student_no
  loop
    if r.deposited then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'deposit_week', '上周有存款', v_ref, null, v_to) is not null)::integer;
    end if;
    if r.streak > 0 and r.streak % 4 = 0 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'deposit_streak', '连续 ' || r.streak || ' 周都有存款', v_ref, null, v_to) is not null)::integer;
    end if;
    if r.withdrawn * 2 > r.start_balance then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'withdraw_half', '上周取款超过周初余额的一半', v_ref, null, v_to) is not null)::integer;
    end if;
    if (p_week - r.opened) / 28 > (p_week - 7 - r.opened) / 28 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'account_age', '开户满 ' || (p_week - r.opened) / 28 * 4 || ' 周', v_ref, null, v_to) is not null)::integer;
    end if;
    if r.balance_sum >= 700 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'balance_100', '上周日均余额不少于 100 HTB', v_ref, null, v_to) is not null)::integer;
    end if;
    if r.balance_sum >= 2100 then
      v_n := v_n + (app_private.credit_change(r.student_no, null, 'balance_300', '上周日均余额不少于 300 HTB', v_ref, null, v_to) is not null)::integer;
    end if;
  end loop;
  return v_n;
end
$$;


-- set_setting as in 20261114000000_credit.sql, with the rate settings (§14.3; the president and the bank admin, §3). A
-- change applies from the next calculation that reads it.
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
    -- 锚点 (§9.1), percentages: the start and bounds 0.01–100 in whole hundredths, min ≤ initial ≤ max; the 存贷比 target
    -- 0–100 and the 增速 target −100–100, each step 0.01–100; weight 0–10 and max_adjust 0–100; up to 4 decimals.
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k)
          <> array['growth_step', 'growth_target', 'initial', 'max', 'max_adjust', 'min', 'ratio_step', 'ratio_target', 'weight']
       or exists (select 1 from (values ('initial', 0.01, 100), ('min', 0.01, 100), ('max', 0.01, 100), ('ratio_target', 0, 100),
                    ('ratio_step', 0.01, 100), ('growth_target', -100, 100), ('growth_step', 0.01, 100), ('weight', 0, 10),
                    ('max_adjust', 0, 100)) r(k, lo, hi)
                  where not app_private.json_num_between(p_value -> r.k, r.lo, r.hi)) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
    if exists (select 1 from unnest(array['initial', 'min', 'max']) k where (p_value ->> k)::numeric <> round((p_value ->> k)::numeric, 2))
       or (p_value ->> 'min')::numeric > (p_value ->> 'initial')::numeric
       or (p_value ->> 'initial')::numeric > (p_value ->> 'max')::numeric then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'term_multipliers' then
    -- 存期倍数 of the 2, 4 and 8 week 定期: 0.1–10, up to 4 decimals
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['2', '4', '8']
       or exists (select 1 from jsonb_each(p_value) e where not app_private.json_num_between(e.value, 0.1, 10)) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'loan_multiplier' then
    if not app_private.json_num_between(p_value, 0.1, 10) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'penalty_multiplier' then
    -- 罚息 is never below the loan's own rate
    if not app_private.json_num_between(p_value, 1, 10) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  else
    perform app_private.fail('INVALID_INPUT', '{"field":"key"}');
  end if;
  update public.settings set value = v_value, updated_by = v_me, updated_at = now() where key = p_key;
  -- M13 风险提醒 setting_change：利率参数、credit_curve、credit_rules、风险阈值、取款限额（对象 settings:<key>；「终止」恢复修改前的值）
  return jsonb_build_object('key', p_key, 'value', v_value);
end
$$;


-- check_balances as in 20261102000200_check_balances.sql, with kind interest: key the student number, recorded
-- 100 × Σ interest + interest_carry, expected Σ settled accruals (0.01 HTB).
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
    -- 利息累计与计息记录一致 (PHASE-2.md §14.1): per account, 100 × the interest paid + the carry = the settled accruals
    select 'interest', a.student_no, (100 * coalesce(p.paid, 0) + a.interest_carry)::integer, coalesce(s.centi, 0)
    from public.accounts a
      left join (select student_no, sum(amount) as paid from public.txns where type = 'interest' group by student_no) p using (student_no)
      left join (select student_no, sum(centi) as centi from public.interest_accruals where settled_txn is not null group by student_no) s using (student_no)
    where 100 * coalesce(p.paid, 0) + a.interest_carry <> coalesce(s.centi, 0)
  ) r;
  if jsonb_array_length(v_rows) > 0 then
    perform app_private.log('check.mismatch', null, null, v_rows);
  end if;
  return query select * from jsonb_to_recordset(v_rows) as x(kind text, key text, recorded integer, expected bigint);
end
$$;

-- bank_report as in 20261111000200_report_closed.sql; the tellers' table leaves out 结息, which the system login makes.
-- 结息 shows as its own key in balance.changes.
create or replace function public.bank_report(p_from date, p_to date, p_division text default null, p_cohort integer default null,
  p_class_no integer default null, p_student_no text default null, p_time_from time default null, p_time_to time default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'teacher');
  v_start timestamptz := p_from::timestamp at time zone 'Asia/Shanghai';
  v_end timestamptz := (p_to + 1)::timestamp at time zone 'Asia/Shanghai';
begin
  if p_from is null or p_to is null or p_from > p_to or p_to - p_from > 366 then
    perform app_private.fail('INVALID_INPUT', '{"field":"period"}');
  end if;
  if p_time_from >= p_time_to then
    perform app_private.fail('INVALID_INPUT', '{"field":"time"}');
  end if;
  return (
    with scope as (
      select s.student_no, s.division, s.cohort, s.class_no, s.status, public.class_label(s) as class_label
      from public.students s
      -- Students opened by the end of the period; one with a transaction before then counts whatever opened_at says.
      where (s.opened_at < v_end or exists (select 1 from public.txns x where x.student_no = s.student_no and x.created_at < v_end))
        and (p_division is null or s.division = p_division) and (p_cohort is null or s.cohort = p_cohort)
        and (p_class_no is null or s.class_no = p_class_no) and (p_student_no is null or s.student_no = p_student_no)
    ),
    whole_days as (
      select x.* from public.txns x join scope using (student_no) where x.created_at >= v_start and x.created_at < v_end
    ),
    t as (
      select * from whole_days x
      where (p_time_from is null or public.cn_time(x) >= p_time_from) and (p_time_to is null or public.cn_time(x) < p_time_to)
    ),
    live as (select * from t where status = 'normal' and type in ('deposit', 'withdraw', 'purchase')),
    opening as (
      select distinct on (x.student_no) x.student_no, x.balance_after as balance
      from public.txns x join scope using (student_no) where x.created_at < v_start order by x.student_no, x.seq desc
    ),
    closing as (
      select distinct on (x.student_no) x.student_no, x.balance_after as balance
      from public.txns x join scope using (student_no) where x.created_at < v_end order by x.student_no, x.seq desc
    ),
    per_student as (
      select student_no, count(*) as n,
        coalesce(sum(amount) filter (where type = 'deposit'), 0) as deposit,
        coalesce(sum(amount) filter (where type = 'withdraw'), 0) as withdraw,
        coalesce(sum(amount) filter (where type = 'purchase' and payment = 'account'), 0) as spent
      from live group by student_no
    ),
    holders as (
      select s.*, coalesce(c.balance, 0) as balance, coalesce(p.n, 0) as n, coalesce(p.deposit, 0) as deposit,
        coalesce(p.withdraw, 0) as withdraw, coalesce(p.spent, 0) as spent
      from scope s left join closing c using (student_no) left join per_student p using (student_no)
    )
    select jsonb_build_object(
      'business', (select jsonb_build_object(
        'deposit', jsonb_build_object('count', count(*) filter (where type = 'deposit'),
          'amount', coalesce(sum(amount) filter (where type = 'deposit'), 0)),
        'withdraw', jsonb_build_object('count', count(*) filter (where type = 'withdraw'),
          'amount', coalesce(sum(amount) filter (where type = 'withdraw'), 0)),
        'purchase_account', jsonb_build_object('count', count(*) filter (where type = 'purchase' and payment = 'account'),
          'amount', coalesce(sum(amount) filter (where type = 'purchase' and payment = 'account'), 0)),
        'purchase_cash', jsonb_build_object('count', count(*) filter (where type = 'purchase' and payment = 'cash'),
          'amount', coalesce(sum(amount) filter (where type = 'purchase' and payment = 'cash'), 0)),
        'students', count(distinct student_no)) from live),
      'reversals', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t where type = 'reversal'),
      'reversed', (select count(*) from t where status = 'reversed'),
      'openings', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from t where type = 'opening'),
      'balance', jsonb_build_object(
        'opening', (select coalesce(sum(balance), 0) from opening),
        'closing', (select coalesce(sum(balance), 0) from closing),
        'changes', (select coalesce(jsonb_object_agg(type, delta), '{}') from (
          select type, sum(balance_delta) as delta from whole_days group by type) d)),
      'cash', (select jsonb_build_object('in', coalesce(sum(cash_delta) filter (where cash_delta > 0), 0),
        'out', coalesce(-sum(cash_delta) filter (where cash_delta < 0), 0)) from t),
      'days', (select jsonb_agg(jsonb_build_object('day', g.day,
          'deposit', coalesce(d.deposit, 0), 'deposit_count', coalesce(d.deposit_count, 0),
          'withdraw', coalesce(d.withdraw, 0), 'withdraw_count', coalesce(d.withdraw_count, 0),
          'purchase', coalesce(d.purchase, 0), 'purchase_count', coalesce(d.purchase_count, 0),
          'students', coalesce(d.students, 0), 'change', coalesce(e.change, 0)) order by g.day)
        from (select generate_series(p_from, p_to, interval '1 day')::date as day) g
        left join (select app_private.cn_date(created_at) as day, sum(balance_delta) as change from whole_days group by 1) e using (day)
        left join (select app_private.cn_date(created_at) as day,
            coalesce(sum(amount) filter (where type = 'deposit'), 0) as deposit, count(*) filter (where type = 'deposit') as deposit_count,
            coalesce(sum(amount) filter (where type = 'withdraw'), 0) as withdraw, count(*) filter (where type = 'withdraw') as withdraw_count,
            coalesce(sum(amount) filter (where type = 'purchase'), 0) as purchase, count(*) filter (where type = 'purchase') as purchase_count,
            count(distinct student_no) as students
          from live group by 1) d using (day)),
      'hours', (select coalesce(jsonb_agg(jsonb_build_object('hour', h, 'count', n) order by h), '[]') from (
        select extract(hour from created_at at time zone 'Asia/Shanghai')::integer as h, count(*) as n from live group by 1) x),
      'tellers', (select coalesce(jsonb_agg(jsonb_build_object('name', p.display_name, 'count', x.n,
          'deposit_count', x.deposit_count, 'deposit', x.deposit, 'withdraw_count', x.withdraw_count, 'withdraw', x.withdraw,
          'purchase_count', x.purchase_count, 'purchase', x.purchase, 'reversed', x.reversed, 'reversals', x.reversals)
          order by x.n desc, p.display_name), '[]')
        from (select operator_id,
            count(*) filter (where status = 'normal' and type in ('deposit', 'withdraw', 'purchase')) as n,
            count(*) filter (where status = 'normal' and type = 'deposit') as deposit_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'deposit'), 0) as deposit,
            count(*) filter (where status = 'normal' and type = 'withdraw') as withdraw_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'withdraw'), 0) as withdraw,
            count(*) filter (where status = 'normal' and type = 'purchase') as purchase_count,
            coalesce(sum(amount) filter (where status = 'normal' and type = 'purchase'), 0) as purchase,
            count(*) filter (where status = 'reversed' and type <> 'opening') as reversed,
            count(*) filter (where type = 'reversal') as reversals
          from t where type not in ('opening', 'interest') group by operator_id) x
        join public.profiles p on p.id = x.operator_id),
      'classes', (select coalesce(jsonb_agg(to_jsonb(c) order by c.division desc, c.cohort desc, c.class_no), '[]') from (
        select division, cohort, class_no, class_label, count(*) as students, count(*) filter (where n > 0) as active,
          sum(balance) as balance, sum(deposit) as deposit, sum(withdraw) as withdraw, sum(spent) as spent
        from holders group by division, cohort, class_no, class_label) c),
      'students', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where n > 0),
          'normal', count(*) filter (where status = 'normal'), 'frozen', count(*) filter (where status = 'frozen'),
          'graduated', count(*) filter (where status = 'graduated'),
          'closed', count(*) filter (where status = 'closed'), 'balance', coalesce(sum(balance), 0),
          'median', coalesce(percentile_disc(0.5) within group (order by balance), 0), 'max', coalesce(max(balance), 0))
        from holders),
      'distribution', (select jsonb_agg(jsonb_build_object('label', b.label, 'count', (
          select count(*) from holders a where a.balance >= b.lo and (b.hi is null or a.balance <= b.hi))) order by b.lo)
        from (values ('0', 0, 0), ('1–19', 1, 19), ('20–49', 20, 49), ('50–99', 50, 99), ('100–199', 100, 199),
          ('200 以上', 200, null)) b(label, lo, hi)),
      'products', (select coalesce(jsonb_agg(to_jsonb(x) order by x.qty desc, x.name), '[]') from (
        select p.name, sum(i.qty) as qty, sum(i.qty * i.unit_price) as amount,
          coalesce(sum(i.qty * i.unit_price) filter (where l.payment = 'account'), 0) as account,
          coalesce(sum(i.qty * i.unit_price) filter (where l.payment = 'cash'), 0) as cash,
          case when bool_and(p.cost is not null) then sum(i.qty * p.cost) end as cost
        from live l join public.txn_items i on i.txn_id = l.id join public.products p on p.id = i.product_id
        where l.type = 'purchase' group by p.id, p.name) x),
      'stock', (select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]') from (
        select p.name, p.price, p.cost,
          p.stock - coalesce(sum(m.qty_delta) filter (where m.created_at >= v_start), 0) as opening,
          coalesce(sum(m.qty_delta) filter (where m.kind = 'stock_in' and m.created_at >= v_start and m.created_at < v_end), 0) as stock_in,
          coalesce(-sum(m.qty_delta) filter (where m.kind = 'stock_out' and m.created_at >= v_start and m.created_at < v_end), 0) as stock_out,
          coalesce(-sum(m.qty_delta) filter (where m.kind in ('sale', 'reversal') and m.created_at >= v_start and m.created_at < v_end), 0) as sold,
          p.stock - coalesce(sum(m.qty_delta) filter (where m.created_at >= v_end), 0) as closing
        from public.products p left join public.stock_movements m on m.product_id = p.id group by p.id) x),
      'issues', jsonb_build_object(
        'batches', (select coalesce(jsonb_agg(jsonb_build_object('batch_no', batch_no, 'issued_on', issued_on, 'total', total,
            'purpose', purpose, 'approver', approver_name, 'denominations', denominations) order by issued_on, batch_no), '[]')
          from public.currency_issues where issued_on between p_from and p_to),
        'total', (select coalesce(sum(total), 0) from public.currency_issues where issued_on <= p_to))));
end
$$;
