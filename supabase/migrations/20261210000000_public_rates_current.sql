-- 利率看板 (PHASE-2.md §15, §16.4): 活期 is one rate for everyone (20261209000000_saving_rate_anchor.sql), so the board
-- shows one number; loans stay by score.

-- public_rates as in 20261208000200_public_rates_board.sql: current is saving_rate at this week's anchor (the same for
-- every score); scores carry the loan rate alone, {"score","loan"}.
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
  select jsonb_build_object('credit_enabled', c.enabled, 'current', app_private.saving_rate(a.anchor, 600),
    'scores', (select jsonb_agg(jsonb_build_object('score', s, 'loan', app_private.loan_rate(a.anchor, s)) order by s)
      from unnest(case when c.enabled then array[600, 750, 900, 1000] else array[600] end) s),
    'term', app_private.setting('term_rates'),
    'wealth', jsonb_build_object('name', w.p ->> 'name', 'weeks', 12, 'day', d.day, 'change', d.change, 'closed', d.closed,
      'tiers', (select jsonb_agg(jsonb_build_object('key', tier ->> 'key', 'name', tier ->> 'name',
          'multiplier', (tier ->> 'multiplier')::numeric,
          -- tier_rate's bounds would turn an unknown change into the floor
          'rate', case when d.change is not null then app_private.tier_rate(w.p, 12, tier, d.change) end) order by i)
        from jsonb_array_elements(w.p -> 'tiers') with ordinality x(tier, i))))
  from a, c, w, d
$$;
