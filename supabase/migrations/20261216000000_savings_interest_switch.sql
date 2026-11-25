-- 活期计息开关 (PHASE-2.md §9.3, §9.5, §14.3): the bank admin turns 活期 interest off and on. A day accrues at the
-- anchor when the switch is on at its end (24:00 Shanghai) and at 0 when it is off; every turn is kept with its time, so
-- a catch-up, 提前支取 and a 补录's correction read the same day the same way as the job did on time. 结息 goes on and
-- pays what was accrued; 锚点, loans, 信用分, 定期 and 理财 are untouched.

-- Whether 活期 accrues; only set_savings_interest_enabled (and 终止 of its setting_change alert) writes this row.
insert into public.settings (key, value) values ('savings_interest_enabled', 'true');

-- Every turn of the switch, in order; before the first the switch is on.
create table public.savings_interest_switches (
  id       bigserial primary key,
  at       timestamptz not null,
  enabled  boolean not null,
  actor_id uuid references public.profiles(id)
);
create index on public.savings_interest_switches (at);
create trigger append_only before update or delete on public.savings_interest_switches for each row execute function app_private.append_only();
create trigger audit after insert or update or delete on public.savings_interest_switches for each row execute function app_private.audit_row();
alter table public.savings_interest_switches enable row level security;
grant select on public.savings_interest_switches to authenticated;
-- As rate_weeks: the accountant, president and bank admin.
create policy read on public.savings_interest_switches for select to authenticated using (
  (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

-- Each change of the setting, by set_savings_interest_enabled or by handle_alert's 终止, is a turn.
create function app_private.savings_interest_turned() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.savings_interest_switches (at, enabled, actor_id) values (clock_timestamp(), new.value = 'true', new.updated_by);
  return null;
end
$$;
create trigger savings_interest_turned after update on public.settings for each row
  when (new.key = 'savings_interest_enabled' and old.value is distinct from new.value)
  execute function app_private.savings_interest_turned();

-- Whether 活期 accrues on p_day: the switch as it stood at the day's end.
create function app_private.savings_interest_on(p_day date) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select enabled from public.savings_interest_switches
    where at < (p_day + 1)::timestamp at time zone 'Asia/Shanghai' order by at desc, id desc limit 1), true)
$$;

-- The 活期 weekly rate of p_day: the day's anchor, or 0 while the switch is off.
create function app_private.saving_rate_on(p_day date) returns numeric
language sql stable security definer set search_path = '' as $$
  select case when app_private.savings_interest_on(p_day) then app_private.saving_rate(app_private.anchor_on(p_day), 600) else 0 end
$$;

-- 活期计息开关, the bank admin alone: not the president. Asking for the state it is already in changes nothing. Logged
-- as interest.switch; each turn is a setting_change alert, whose 终止 turns it back.
create function public.set_savings_interest_enabled(p_enabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_before jsonb;
begin
  perform app_private.forbid_president();
  if p_enabled is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"enabled"}');
  end if;
  select value into v_before from public.settings where key = 'savings_interest_enabled' for update;
  if v_before = to_jsonb(p_enabled) then
    return jsonb_build_object('enabled', p_enabled, 'changed', false);
  end if;
  update public.settings set value = to_jsonb(p_enabled), updated_by = v_me, updated_at = clock_timestamp()
  where key = 'savings_interest_enabled';
  perform app_private.log('interest.switch', 'settings:savings_interest_enabled', jsonb_build_object('enabled', not p_enabled),
    jsonb_build_object('enabled', p_enabled));
  perform app_private.risk_alert('setting_change', 'settings:savings_interest_enabled', null, v_me,
    jsonb_build_object('key', 'savings_interest_enabled', 'before', v_before, 'after', to_jsonb(p_enabled)));
  return jsonb_build_object('enabled', p_enabled, 'changed', true);
end
$$;
revoke execute on function public.set_savings_interest_enabled(boolean) from public, anon;
grant execute on function public.set_savings_interest_enabled(boolean) to authenticated;

-- accrue_interest as in 20261115000100_interest.sql, at saving_rate_on(p_day): a day the switch is off still has its
-- rows, at 0, so a 补录's correction (§10.11, at the rate kept in the row) gives 0 for it too.
create or replace function app_private.accrue_interest(p_day date) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rate numeric := app_private.saving_rate_on(p_day);
  v_n integer;
begin
  insert into public.interest_accruals (student_no, day, balance, rate, centi)
  select s.student_no, p_day, b.balance, v_rate, floor(b.balance * v_rate / 7)::integer
  from public.students s, lateral (select app_private.balance_on(s.student_no, p_day) as balance) b
  where s.status = 'normal' and s.opened_at < (p_day + 1)::timestamp at time zone 'Asia/Shanghai'
  on conflict do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

-- 提前支取的利息 (§9.5) as in 20261129000000_no_holidays.sql, each day at saving_rate_on.
create or replace function app_private.early_interest(p_dep public.term_deposits, p_to date) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(floor(p_dep.principal * app_private.saving_rate_on(g::date) / 7)), 0)::integer
  from generate_series(p_dep.opened_on, p_to - 1, interval '1 day') g
$$;

-- interest_profile as in 20261115000100_interest.sql, with savings_enabled; rates.current is today's 活期 rate, 0 while
-- the switch is off (anchor stays the week's anchor).
create or replace function public.interest_profile(p_student_no text default null) returns jsonb
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
      'savings_enabled', app_private.savings_interest_on(v_today),
      'rates', app_private.rates(v_anchor, c.score) || jsonb_build_object('current', app_private.saving_rate_on(v_today)),
      'pending_centi', app_private.pending_interest(v_no))
    from public.credit_scores c where c.student_no = v_no);
end
$$;

-- public_rates as in 20261210000000_public_rates_current.sql, with savings_enabled; current is saving_rate_on(today),
-- 0 while the switch is off.
create or replace function public.public_rates() returns jsonb
language sql stable security definer set search_path = '' as $$
  with t as (select app_private.cn_date(now()) as today),
  a as (select app_private.anchor_on(today) as anchor from t),
  c as (select app_private.setting('credit_enabled') <> 'false' as enabled),
  w as (select app_private.setting('wealth_params') as p),
  d as (select case when x.closed then t.today else l.day end as day, case when x.closed then 0 else l.change end as change, x.closed
        from t cross join lateral (select not exists (select 1 from public.wealth_days where day = t.today)
            and coalesce(app_private.wealth_day_change(t.today) = 0, false) as closed) x
          left join lateral (select day, change from public.wealth_days order by day desc limit 1) l on true)
  select jsonb_build_object('credit_enabled', c.enabled,
    'savings_enabled', app_private.savings_interest_on(t.today), 'current', app_private.saving_rate_on(t.today),
    'scores', (select jsonb_agg(jsonb_build_object('score', s, 'loan', app_private.loan_rate(a.anchor, s)) order by s)
      from unnest(case when c.enabled then array[600, 750, 900, 1000] else array[600] end) s),
    'term', app_private.setting('term_rates'),
    'wealth', jsonb_build_object('name', w.p ->> 'name', 'weeks', 12, 'day', d.day, 'change', d.change, 'closed', d.closed,
      'tiers', (select jsonb_agg(jsonb_build_object('key', tier ->> 'key', 'name', tier ->> 'name',
          'multiplier', (tier ->> 'multiplier')::numeric,
          -- tier_rate's bounds would turn an unknown change into the floor
          'rate', case when d.change is not null then app_private.tier_rate(w.p, 12, tier, d.change) end) order by i)
        from jsonb_array_elements(w.p -> 'tiers') with ordinality x(tier, i))))
  from t, a, c, w, d
$$;
