-- 考勤签到合并与行长权限 (PHASE-1.md §4.2, §6.9; PHASE-2.md §3). Tellers, accountants, storekeepers and presidents
-- are counted; the bank admin and the sysadmin are not. A teller's shift comes from 上班 as before; an accountant,
-- storekeeper or president signs in to the shift of now (sign_in_attendance), which waits for review like a teller's.
-- The president or the bank admin signs anyone else's shift in the 考勤 table (makeup_attendance, confirmed at once) and
-- voids a confirmed one; a president's are the bank admin's. Review and payout are the bank admin's alone. The
-- president no longer manages settings, 工资标准, 参与考勤 or reads the audit log.

-- The bank admin is no longer counted: nothing to sign, nothing bound. Their shifts so far stay as they are.
update public.staff_payroll s set attendance = false, account = null
from public.user_roles r
where r.user_id = s.user_id and r.role = 'teacher' and (s.attendance or s.account is not null);

delete from public.salary_rates where role = 'teacher';
alter table public.salary_rates drop constraint salary_rates_role_check,
  add constraint salary_rates_role_check check (role in ('teller', 'accountant', 'storekeeper', 'president'));

-- payroll_role, as in 20261122000000_staff_attendance.sql: the counted identities only.
create or replace function app_private.payroll_role(p_user_id uuid) returns public.app_role
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.app_role := (select role from public.user_roles where user_id = p_user_id);
begin
  if v_role is null or v_role not in ('teller', 'accountant', 'storekeeper', 'president') then
    perform app_private.fail('INVALID_INPUT', '{"field":"user_id"}');
  end if;
  return v_role;
end
$$;

-- 签到 (accountant, storekeeper, president): their own shift of now, 中午班 before 13:30 Shanghai time and 下午班
-- from then, as 上班 signs a teller's; it waits for the bank admin's review. Once per shift, a voided one included.
create function public.sign_in_attendance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('accountant', 'storekeeper', 'president');
  v_payroll public.staff_payroll;
  v_row public.attendance;
begin
  select * into v_payroll from public.staff_payroll where user_id = v_me;
  if v_payroll.account is null then
    perform app_private.fail('SALARY_UNBOUND');
  end if;
  if not v_payroll.attendance then
    perform app_private.fail('ATTENDANCE_OFF');
  end if;
  insert into public.attendance (user_id, day, shift, signed_by)
  values (v_me, app_private.cn_date(now()), app_private.shift_of(now()), v_me)
  on conflict (user_id, day, shift) do nothing returning * into v_row;
  if v_row.id is null then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"attendance"}');
  end if;
  return to_jsonb(v_row);
end
$$;

-- void_attendance, as in 20261122000000_staff_attendance.sql: any confirmed shift not yet paid, a teller's included;
-- a waiting one is reviewed instead. Not their own, and a president's only by the bank admin.
create or replace function public.void_attendance(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row public.attendance;
begin
  select * into v_row from public.attendance where id = p_id for update;
  if not found or v_row.status = 'pending' then
    perform app_private.fail('INVALID_INPUT', '{"field":"id"}');
  end if;
  if v_row.user_id = v_me or v_row.role = (select role from public.user_roles where user_id = v_me) then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  if v_row.salary_txn is not null then
    perform app_private.fail('ATTENDANCE_PAID');
  end if;
  if v_row.status = 'rejected' then
    perform app_private.fail('ATTENDANCE_REVIEWED');
  end if;
  if nullif(trim(p_note), '') is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  update public.attendance set status = 'rejected', note = trim(p_note), reviewed_by = v_me, reviewed_at = now()
  where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end
$$;

-- set_salary_rates, as in 20261122000000_staff_attendance.sql: the bank admin's, the counted identities only.
create or replace function public.set_salary_rates(p_rates jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_role text;
begin
  perform app_private.forbid_president();
  if jsonb_typeof(p_rates) is distinct from 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_rates) k)
        is distinct from array['accountant', 'president', 'storekeeper', 'teller'] then
    perform app_private.fail('INVALID_INPUT', '{"field":"rates"}');
  end if;
  for v_role in select jsonb_object_keys(p_rates) loop
    if jsonb_typeof(p_rates -> v_role) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_rates -> v_role) k) is distinct from array['am', 'pm']
       or not app_private.json_int_between(p_rates -> v_role -> 'am', 1, 10000)
       or not app_private.json_int_between(p_rates -> v_role -> 'pm', 1, 10000) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', 'rates', 'role', v_role));
    end if;
  end loop;
  update public.salary_rates r set amount = (p_rates -> r.role::text ->> r.shift)::integer, updated_by = v_me, updated_at = now()
  where r.amount <> (p_rates -> r.role::text ->> r.shift)::integer;
  return app_private.salary_rates();
end
$$;

-- set_attendance, as in 20261122000000_staff_attendance.sql: the bank admin's.
create or replace function public.set_attendance(p_user_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
begin
  perform app_private.forbid_president();
  perform app_private.payroll_role(p_user_id);
  if p_on is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"attendance"}');
  end if;
  if p_on and (select disabled from public.profiles where id = p_user_id) then
    perform app_private.fail('INVALID_INPUT', '{"field":"user_id"}');
  end if;
  if p_on and (select account from public.staff_payroll where user_id = p_user_id) is null then
    perform app_private.fail('SALARY_UNBOUND');
  end if;
  insert into public.staff_payroll as s (user_id, attendance) values (p_user_id, p_on)
  on conflict (user_id) do update set attendance = excluded.attendance where s.attendance <> excluded.attendance;
  return jsonb_build_object('user_id', p_user_id, 'attendance', p_on);
end
$$;

-- review_attendance, as in 20261105000200_duty.sql: the bank admin's.
create or replace function public.review_attendance(p_ids uuid[], p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_count integer;
begin
  perform app_private.forbid_president();
  if p_status is null or p_status not in ('confirmed', 'rejected') then
    perform app_private.fail('INVALID_INPUT', '{"field":"status"}');
  end if;
  if coalesce(cardinality(p_ids), 0) = 0 then
    perform app_private.fail('INVALID_INPUT', '{"field":"attendance"}');
  end if;
  perform 1 from public.attendance where id = any(p_ids) order by id for update;
  if exists (select 1 from public.attendance where id = any(p_ids) and status <> 'pending') then
    perform app_private.fail('ATTENDANCE_REVIEWED');
  end if;
  update public.attendance
  set status = p_status, reviewed_by = v_me, reviewed_at = now(), note = coalesce(nullif(trim(p_note), ''), note)
  where id = any(p_ids);
  get diagnostics v_count = row_count;
  return jsonb_build_object('count', v_count);
end
$$;

-- pay_salaries, as in 20261122000000_staff_attendance.sql: the bank admin's.
create or replace function public.pay_salaries(p_week date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_from date := p_week - (extract(isodow from p_week)::integer - 1);
  v_to date := v_from + 6;
  v_rates jsonb := app_private.salary_rates();
  v_pending integer;
  v_paid jsonb := '[]';
  v_skipped jsonb := '[]';
  v_status text;
  v_account public.accounts;
  v_txn public.txns;
  r record;
begin
  perform app_private.forbid_president();
  if p_week is null or v_from > app_private.cn_date(now()) then
    perform app_private.fail('INVALID_INPUT', '{"field":"week"}');
  end if;
  perform 1 from public.attendance where salary_txn is null and day <= v_to order by id for update;
  select count(*) into v_pending from public.attendance a join public.profiles p on p.id = a.user_id
  where a.status = 'pending' and a.day <= v_to and not p.disabled;
  if v_pending > 0 then
    perform app_private.fail('ATTENDANCE_PENDING', jsonb_build_object('count', v_pending));
  end if;
  for r in
    select a.user_id, p.display_name, p.disabled, s.account, array_agg(a.id) as ids, count(*)::integer as n,
      count(*) filter (where a.shift = 'am')::integer as n_am, count(*) filter (where a.shift = 'pm')::integer as n_pm,
      sum((v_rates -> a.role::text ->> a.shift)::integer)::integer as amount, min(a.day) as first, max(a.day) as last
    from public.attendance a join public.profiles p on p.id = a.user_id left join public.staff_payroll s on s.user_id = a.user_id
    where a.status = 'confirmed' and a.salary_txn is null and a.day <= v_to
    group by a.user_id, p.display_name, p.disabled, s.account order by p.display_name
  loop
    v_status := (select status from public.students where student_no = r.account);
    if r.disabled or v_status is distinct from 'normal' then
      v_skipped := v_skipped || jsonb_build_object('user_id', r.user_id, 'name', r.display_name, 'shifts', r.n,
        'reason', case when r.disabled then 'disabled' when r.account is null then 'unbound' else 'inactive' end);
      continue;
    end if;
    perform app_private.lock_account(r.account, null); -- the payer's own 工资账户 is paid like any other
    update public.accounts set balance = balance + r.amount, updated_at = now()
    where student_no = r.account returning * into v_account;
    insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id)
    values (gen_random_uuid(), 'salary', r.account, r.amount, r.amount, v_account.balance,
      case when r.first = r.last then to_char(r.first, 'FMMM月FMDD日') else to_char(r.first, 'FMMM月FMDD日') || '至' || to_char(r.last, 'FMMM月FMDD日') end
        || '，' || concat_ws('、', case when r.n_am > 0 then '中午班 ' || r.n_am || ' 个' end, case when r.n_pm > 0 then '下午班 ' || r.n_pm || ' 个' end),
      v_me, app_private.request_header('x-device-id'))
    returning * into v_txn;
    update public.attendance set salary_txn = v_txn.id, pay = (v_rates -> role::text ->> shift)::integer where id = any(r.ids);
    v_paid := v_paid || jsonb_build_object('user_id', r.user_id, 'name', r.display_name, 'account', r.account,
      'shifts', r.n, 'amount', v_txn.amount, 'txn_no', v_txn.txn_no);
  end loop;
  if jsonb_array_length(v_paid) > 0 then
    perform app_private.log('salary.pay', null, null, jsonb_build_object('from', v_from, 'to', v_to, 'rates', v_rates, 'paid', v_paid));
  end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'rates', v_rates, 'paid', v_paid, 'skipped', v_skipped);
end
$$;

-- set_settings, as in 20261102001000_ledger_settings.sql: the bank admin's.
create or replace function public.set_settings(p_values jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_key text;
  v_saved jsonb := '{}';
begin
  perform app_private.forbid_president();
  if jsonb_typeof(p_values) is distinct from 'object' or p_values = '{}' then
    perform app_private.fail('INVALID_INPUT', '{"field":"values"}');
  end if;
  for v_key in select jsonb_object_keys(p_values) loop
    v_saved := v_saved || jsonb_build_object(v_key, public.set_setting(v_key, p_values -> v_key) -> 'value');
  end loop;
  return v_saved;
end
$$;

-- set_setting, as in 20261125000000_wealth_daily.sql: the bank admin's.
create or replace function public.set_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_value jsonb := p_value;
begin
  perform app_private.forbid_president();
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

-- 日志: the bank admin and the sysadmin.
alter policy read on public.audit_log using (
  ((select app_private.has_role('teacher')) and not (select app_private.has_role('president')))
  or (select app_private.has_role('sysadmin')));

revoke execute on function public.sign_in_attendance() from public, anon;
grant execute on function public.sign_in_attendance() to authenticated;
