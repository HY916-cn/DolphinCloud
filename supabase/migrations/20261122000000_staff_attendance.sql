-- 全员考勤与工资 (PHASE-1.md §6.9, PHASE-2.md §3, §5). Every staff identity but the sysadmin binds a 工资账户 and is
-- counted: a teller's shifts come from 上班 / 下班 as before, anyone else's are registered by the president or the bank
-- admin through makeup_attendance (confirmed at once). Pay is set per identity and shift in salary_rates; each shift
-- keeps the identity it was signed under, and a payout pays it at that identity's rate. A registered shift can be
-- voided with a reason until it is paid. The settings row salary_per_shift stays only for clients that still read it;
-- no payout uses it.

-- 工资标准: one row per identity and shift, every counted identity has both.
create table public.salary_rates (
  role       public.app_role not null check (role <> 'sysadmin'),
  shift      text not null check (shift in ('am', 'pm')),
  amount     integer not null check (amount between 1 and 10000),
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now(),
  primary key (role, shift)
);
create trigger audit after insert or update or delete on public.salary_rates for each row execute function app_private.audit_row();
alter table public.salary_rates enable row level security;
grant select on public.salary_rates to authenticated;
create policy read on public.salary_rates for select to authenticated using (true);

-- Every counted identity starts at the pay salary_per_shift has for its shift.
insert into public.salary_rates (role, shift, amount)
select r.role, s.shift, (v.value ->> s.shift)::integer
from public.settings v,
  unnest(array['teller', 'accountant', 'storekeeper', 'president', 'teacher']::public.app_role[]) r(role),
  unnest(array['am', 'pm']) s(shift)
where v.key = 'salary_per_shift';

-- The identity a shift was signed under; every shift so far is a teller's.
alter table public.attendance add column role public.app_role not null default 'teller' check (role <> 'sysadmin');
alter table public.attendance alter column role drop default;

create function app_private.attendance_role() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.role := coalesce(new.role, (select role from public.user_roles where user_id = new.user_id));
  return new;
end
$$;
create trigger attendance_role before insert on public.attendance for each row execute function app_private.attendance_role();

-- The identity of a staff login that can be counted: any but the sysadmin.
create function app_private.payroll_role(p_user_id uuid) returns public.app_role
language plpgsql stable security definer set search_path = '' as $$
declare
  v_role public.app_role := (select role from public.user_roles where user_id = p_user_id);
begin
  if v_role is null or v_role = 'sysadmin' then
    perform app_private.fail('INVALID_INPUT', '{"field":"user_id"}');
  end if;
  return v_role;
end
$$;

-- 工资标准 as {"teller": {"am": n, "pm": n}, …}.
create function app_private.salary_rates() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(role, rates) from (
    select role, jsonb_object_agg(shift, amount) as rates from public.salary_rates group by role) r
$$;

-- 设置工资标准 (president, bank admin): the whole table at once, each 1～10000 HTB; changes take effect at the next payout.
create function public.set_salary_rates(p_rates jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_role text;
begin
  if jsonb_typeof(p_rates) is distinct from 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_rates) k)
        is distinct from array['accountant', 'president', 'storekeeper', 'teacher', 'teller'] then
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

-- set_attendance, as in 20261105000200_duty.sql: any identity but the sysadmin.
create or replace function public.set_attendance(p_user_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
begin
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

-- bind_salary_account, as in 20261110000000_staff_import.sql. Anyone counted binds their own with the student's
-- password, the president included; the bank admin and the sysadmin bind for others without it.
create or replace function public.bind_salary_account(p_user_id uuid, p_student_no text, p_password text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'accountant', 'storekeeper', 'teacher', 'sysadmin');
  v_student public.students;
  v_hash text;
begin
  if p_user_id is distinct from v_me then
    perform app_private.forbid_president();
    if not (app_private.has_role('teacher') or app_private.has_role('sysadmin')) then
      perform app_private.fail('FORBIDDEN', '{"roles":["teacher","sysadmin"]}', '42501');
    end if;
  end if;
  perform app_private.payroll_role(p_user_id);
  if p_user_id is distinct from v_me then
    perform app_private.bind_salary(p_user_id, p_student_no);
    return jsonb_build_object('user_id', p_user_id, 'account', p_student_no,
      'name', (select name from public.students where student_no = p_student_no));
  end if;
  select * into v_student from public.students where student_no = p_student_no;
  if not found or v_student.user_id is null then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  if v_student.status <> 'normal' then
    perform app_private.fail('STUDENT_INACTIVE', jsonb_build_object('status', v_student.status));
  end if;
  if (select locked_until from app_private.login_attempts where user_id = v_student.user_id) > now() then
    return '{"error":"LOGIN_LOCKED"}';
  end if;
  select encrypted_password into v_hash from auth.users where id = v_student.user_id;
  if p_password is null or v_hash is null or public.crypt(p_password, v_hash) <> v_hash then
    return jsonb_build_object('error', case when app_private.login_failed(v_student.user_id) is null then 'WRONG_PASSWORD' else 'LOGIN_LOCKED' end);
  end if;
  if exists (select 1 from public.staff_payroll where account = p_student_no and user_id <> p_user_id) then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"account"}');
  end if;
  delete from app_private.login_attempts where user_id = v_student.user_id;
  insert into public.staff_payroll as s (user_id, account) values (p_user_id, p_student_no)
  on conflict (user_id) do update set account = excluded.account where s.account is distinct from excluded.account;
  return jsonb_build_object('user_id', p_user_id, 'account', p_student_no, 'name', v_student.name);
end
$$;

-- unbind_salary_account, as in 20261107000100_president_rights.sql: anyone their own, the bank admin and the
-- sysadmin anyone's.
create or replace function public.unbind_salary_account(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'accountant', 'storekeeper', 'teacher', 'sysadmin');
begin
  if p_user_id is distinct from v_me then
    perform app_private.forbid_president();
    if not (app_private.has_role('teacher') or app_private.has_role('sysadmin')) then
      perform app_private.fail('FORBIDDEN', '{"roles":["teacher","sysadmin"]}', '42501');
    end if;
  end if;
  if (select attendance from public.staff_payroll where user_id = p_user_id) then
    perform app_private.fail('ATTENDANCE_ON');
  end if;
  update public.staff_payroll set account = null where user_id = p_user_id and account is not null;
  return jsonb_build_object('user_id', p_user_id, 'account', null);
end
$$;

-- makeup_attendance, as in 20261104000100_attendance.sql: 补签 for a teller, and 登记 for anyone else counted; a
-- president's shifts are registered by the bank admin, the bank admin's by a president.
create or replace function public.makeup_attendance(p_user_id uuid, p_day date, p_shift text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row public.attendance;
begin
  if app_private.payroll_role(p_user_id) = (select role from public.user_roles where user_id = v_me) then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  if p_shift is null or p_shift not in ('am', 'pm') then
    perform app_private.fail('INVALID_INPUT', '{"field":"shift"}');
  end if;
  if p_day is null or p_day > app_private.cn_date(now())
     or (p_day = app_private.cn_date(now()) and p_shift = 'pm' and app_private.shift_of(now()) = 'am') then
    perform app_private.fail('INVALID_INPUT', '{"field":"day"}');
  end if;
  if nullif(trim(p_note), '') is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  insert into public.attendance (user_id, day, shift, status, signed_by, note, reviewed_by, reviewed_at)
  values (p_user_id, p_day, p_shift, 'confirmed', v_me, trim(p_note), v_me, now())
  on conflict (user_id, day, shift) do nothing returning * into v_row;
  if v_row.id is null then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"attendance"}');
  end if;
  return to_jsonb(v_row);
end
$$;

-- 作废 (president, bank admin): a registered shift, not a teller's, with a reason, until it is paid; a voided shift is
-- rejected and paid nothing. Who may not register a shift may not void it either.
create function public.void_attendance(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row public.attendance;
begin
  select * into v_row from public.attendance where id = p_id for update;
  if not found or v_row.role = 'teller' then
    perform app_private.fail('INVALID_INPUT', '{"field":"id"}');
  end if;
  if v_row.role = (select role from public.user_roles where user_id = v_me) then
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

-- pay_salaries, as in 20261105000200_duty.sql: each shift at the rate of the identity it was signed under and its
-- kind, from the 工资标准 read once at the start of the payout.
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

-- import_staff, as in 20261110000000_staff_import.sql: a 工资账户 for any identity but the sysadmin.
create or replace function public.import_staff(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '60s' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_row jsonb;
  v_index integer := 0;
  v_login text;
  v_name text;
  v_role public.app_role;
  v_account text;
  v_existing public.profiles;
  v_uid uuid;
  v_password text;
  v_seen text[] := '{}';
  v_created jsonb := '[]';
  v_updated integer := 0;
  v_bound integer := 0;
begin
  perform app_private.forbid_president();
  if jsonb_typeof(p_rows) is distinct from 'array' then
    perform app_private.fail('INVALID_INPUT', '{"field":"rows"}');
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    v_login := lower(trim(v_row ->> 'login_id'));
    v_name := nullif(trim(v_row ->> 'name'), '');
    v_account := nullif(trim(v_row ->> 'account'), '');
    if v_login is null or not app_private.valid_staff_login(v_login) or v_name is null then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index, 'field', 'login_id'));
    end if;
    if v_row ->> 'role' = 'teacher' then
      perform app_private.fail('ONE_BANK_ADMIN', jsonb_build_object('row', v_index));
    end if;
    if coalesce(v_row ->> 'role', '') not in ('teller', 'accountant', 'storekeeper', 'president', 'sysadmin') then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index, 'field', 'role'));
    end if;
    v_role := (v_row ->> 'role')::public.app_role;
    if v_account is not null and v_role = 'sysadmin' then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index, 'field', 'account'));
    end if;
    if v_login = any(v_seen) then
      perform app_private.fail('ALREADY_EXISTS', jsonb_build_object('row', v_index, 'field', 'login_id'));
    end if;
    v_seen := v_seen || v_login;

    select * into v_existing from public.profiles where login_kind = 'staff' and login_id = v_login;
    if found then
      if v_existing.closed_at is not null then
        perform app_private.fail('ACCOUNT_CLOSED', jsonb_build_object('row', v_index));
      end if;
      if v_existing.disabled then
        perform app_private.fail('ALREADY_EXISTS', jsonb_build_object('row', v_index, 'field', 'login_id'));
      end if;
      if (select role from public.user_roles where user_id = v_existing.id) is distinct from v_role then
        perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index, 'field', 'role'));
      end if;
      update public.profiles set display_name = v_name where id = v_existing.id and display_name <> v_name;
      if v_account is not null and app_private.bind_salary(v_existing.id, v_account, v_index) then
        v_bound := v_bound + 1;
      end if;
      v_updated := v_updated + 1;
      continue;
    end if;

    v_password := app_private.new_password('staff');
    v_uid := app_private.create_login(v_login || '@staff.dolphin.internal', v_password);
    insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'staff', v_login, v_name);
    insert into public.user_roles (user_id, role) values (v_uid, v_role);
    if v_account is not null and app_private.bind_salary(v_uid, v_account, v_index) then
      v_bound := v_bound + 1;
    end if;
    v_created := v_created || jsonb_build_object('login_id', v_login, 'name', v_name, 'role', v_role, 'password', v_password,
      'account', v_account, 'account_name', (select name from public.students where student_no = v_account));
  end loop;
  perform app_private.log('staff.import', null, null,
    jsonb_build_object('created', jsonb_array_length(v_created), 'updated', v_updated, 'bound', v_bound));
  return jsonb_build_object('created', jsonb_array_length(v_created), 'updated', v_updated, 'bound', v_bound, 'accounts', v_created);
end
$$;

revoke execute on function public.set_salary_rates(jsonb), public.void_attendance(uuid, text) from public, anon;
grant execute on function public.set_salary_rates(jsonb), public.void_attendance(uuid, text) to authenticated;
revoke all on function app_private.payroll_role(uuid), app_private.salary_rates(), app_private.attendance_role() from public;
