-- 手动登记指数涨跌 (PHASE-2.md §3, §10.10) by the bank admin alone: an entered change moves every open holding's return,
-- so a president is refused.

-- record_wealth_day as in 20261125000000_wealth_daily.sql, refusing a president.
create or replace function public.record_wealth_day(p_day date, p_change numeric, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row public.wealth_days;
begin
  perform app_private.forbid_president();
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
