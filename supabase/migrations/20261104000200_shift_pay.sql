-- 中午班 and 下午班 each have their own pay (PHASE-1.md §6.9): salary_per_shift becomes {"am": n, "pm": n}, and a
-- payout pays each shift at the pay of its kind.
update public.settings set value = jsonb_build_object('am', value, 'pm', value) where key = 'salary_per_shift';

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
  else
    perform app_private.fail('INVALID_INPUT', '{"field":"key"}');
  end if;
  update public.settings set value = v_value, updated_by = v_me, updated_at = now() where key = p_key;
  return jsonb_build_object('key', p_key, 'value', v_value);
end
$$;

-- 发放工资 (bank admin) for the week (Monday to Sunday) holding p_week: every confirmed shift not yet paid up to its
-- Sunday, earlier ones included, each at its kind's pay, one salary transaction per teller. A teller with no bound
-- account, or whose account is frozen or graduated, is skipped and paid in a later payout. Paying again pays only
-- shifts confirmed since.
create or replace function public.pay_salaries(p_week date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_from date := p_week - (extract(isodow from p_week)::integer - 1);
  v_to date := v_from + 6;
  v_rates jsonb := app_private.setting('salary_per_shift');
  v_amount integer;
  v_paid jsonb := '[]';
  v_skipped jsonb := '[]';
  v_status text;
  v_account public.accounts;
  v_txn public.txns;
  r record;
begin
  if p_week is null or v_from > app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', '{"field":"week"}');
  end if;
  perform 1 from public.attendance where status = 'confirmed' and salary_txn is null and day <= v_to order by id for update;
  for r in
    select a.user_id, p.display_name, s.account, array_agg(a.id) as ids, count(*)::integer as n,
      count(*) filter (where a.shift = 'am')::integer as n_am, count(*) filter (where a.shift = 'pm')::integer as n_pm,
      min(a.day) as first, max(a.day) as last
    from public.attendance a join public.profiles p on p.id = a.user_id left join public.staff_payroll s on s.user_id = a.user_id
    where a.status = 'confirmed' and a.salary_txn is null and a.day <= v_to
    group by a.user_id, p.display_name, s.account order by p.display_name
  loop
    v_status := (select status from public.students where student_no = r.account);
    if v_status is distinct from 'normal' then
      v_skipped := v_skipped || jsonb_build_object('user_id', r.user_id, 'name', r.display_name, 'shifts', r.n,
        'reason', case when r.account is null then 'unbound' else 'inactive' end);
      continue;
    end if;
    perform app_private.lock_account(r.account, v_me);
    v_amount := r.n_am * (v_rates ->> 'am')::integer + r.n_pm * (v_rates ->> 'pm')::integer;
    update public.accounts set balance = balance + v_amount, updated_at = now()
    where student_no = r.account returning * into v_account;
    insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id)
    values (gen_random_uuid(), 'salary', r.account, v_amount, v_amount, v_account.balance,
      case when r.first = r.last then to_char(r.first, 'FMMM月FMDD日') else to_char(r.first, 'FMMM月FMDD日') || '至' || to_char(r.last, 'FMMM月FMDD日') end
        || '，' || concat_ws('、', case when r.n_am > 0 then '中午班 ' || r.n_am || ' 个' end, case when r.n_pm > 0 then '下午班 ' || r.n_pm || ' 个' end),
      v_me, app_private.request_header('x-device-id'))
    returning * into v_txn;
    update public.attendance set salary_txn = v_txn.id, pay = (v_rates ->> shift)::integer where id = any(r.ids);
    v_paid := v_paid || jsonb_build_object('user_id', r.user_id, 'name', r.display_name, 'account', r.account,
      'shifts', r.n, 'amount', v_txn.amount, 'txn_no', v_txn.txn_no);
  end loop;
  if jsonb_array_length(v_paid) > 0 then
    perform app_private.log('salary.pay', null, null, jsonb_build_object('from', v_from, 'to', v_to, 'rates', v_rates, 'paid', v_paid));
  end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'rates', v_rates, 'paid', v_paid, 'skipped', v_skipped);
end
$$;
