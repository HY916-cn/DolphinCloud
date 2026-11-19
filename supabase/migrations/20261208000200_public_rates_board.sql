-- 利率看板 in four cards (PHASE-2.md §15, §16.4): 活期 and loans at 600, 750, 900 and 1000, term_rates, and 理财 today:
-- each tier's rate for 12 weeks on the latest day, as a holding takes it (tier_rate, wealth_day_change). No anchor.

-- public_rates as in 20261208000000_public_pages.sql: scores 600–1000 only (600 alone while 信用分 is paused); wealth is
-- {"name","weeks":12,"day","change","closed","tiers":[{"key","name","multiplier","rate"}]}. On a closed today (a
-- weekend) day is today, change 0 and each rate the daily base; otherwise day and change are the latest trading day's,
-- all null (rates too) before the first.
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
    'scores', (select jsonb_agg(jsonb_build_object('score', s, 'current', app_private.saving_rate(a.anchor, s),
        'loan', app_private.loan_rate(a.anchor, s)) order by s)
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
