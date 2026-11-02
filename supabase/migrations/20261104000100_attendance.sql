-- 考勤与工资 (PHASE-1.md §6.9). A teller the bank admin counts signs in once per shift: 上午班 before 13:30
-- Asia/Shanghai, 下午班 from 13:30, any day of the week. A shift counts once the bank admin confirms it; the bank admin
-- can also sign one in (补签, confirmed at once). Each week the bank admin pays every confirmed, unpaid shift at
-- salary_per_shift into the student account the teller bound with that account's password.

insert into public.settings (key, value) values ('salary_per_shift', '10');

-- account: the student account the pay goes to, one staff login per account.
create table public.staff_payroll (
  user_id    uuid primary key references public.profiles(id),
  attendance boolean not null default false,
  account    text unique references public.students(student_no)
);

-- signed_by is the teller, or the bank admin for a 补签; pay is salary_per_shift when the shift was paid.
create table public.attendance (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles(id),
  day         date not null,
  shift       text not null check (shift in ('am', 'pm')),
  status      text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  signed_at   timestamptz not null default now(),
  signed_by   uuid not null references public.profiles(id),
  note        text,
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  salary_txn  uuid references public.txns(id),
  pay         integer,
  unique (user_id, day, shift),
  check ((salary_txn is null) = (pay is null)),
  check (salary_txn is null or status = 'confirmed')
);
create index on public.attendance (day);

-- Paying a shift is logged once per payout (salary.pay), not per shift.
create trigger audit after insert or update or delete on public.staff_payroll for each row execute function app_private.audit_row();
create trigger audit after insert or update or delete on public.attendance for each row execute function app_private.audit_row('salary_txn', 'pay');

alter table public.staff_payroll enable row level security;
alter table public.attendance enable row level security;
grant select on public.staff_payroll, public.attendance to authenticated;
create policy read on public.staff_payroll for select to authenticated using (
  user_id = auth.uid() or (select app_private.has_role('teacher')) or (select app_private.has_role('sysadmin')));
create policy read on public.attendance for select to authenticated using (
  user_id = auth.uid() or (select app_private.has_role('teacher')));

-- The shift a moment falls in.
create function app_private.shift_of(p_at timestamptz) returns text
language sql immutable as $$
  select case when (p_at at time zone 'Asia/Shanghai')::time < '13:30' then 'am' else 'pm' end
$$;

create function app_private.require_teller(p_user_id uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.user_roles where user_id = p_user_id and role = 'teller') then
    perform app_private.fail('INVALID_INPUT', '{"field":"user_id"}');
  end if;
end
$$;

-- A wrong password for a student login outside sign-in counts as at sign-in (login_lockout.sql): the 5th within
-- 15 minutes locks the login for 15 minutes. Returns the end of the lock, or null.
create function app_private.login_failed(p_uid uuid) returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare
  v_failures integer;
  v_locked timestamptz;
begin
  insert into app_private.login_attempts as a (user_id, failures) values (p_uid, array[now()])
  on conflict (user_id) do update
    set failures = array(select f from unnest(a.failures) f where f > now() - interval '15 minutes') || now()
  returning cardinality(failures) into v_failures;
  if v_failures >= 5 then
    update app_private.login_attempts set failures = '{}', locked_until = now() + interval '15 minutes'
    where user_id = p_uid returning locked_until into v_locked;
  end if;
  perform app_private.log('payroll.wrong_password', 'profiles:' || p_uid, null,
    jsonb_strip_nulls(jsonb_build_object('failures', v_failures, 'locked_until', v_locked)));
  return v_locked;
end
$$;

-- A teller does not serve the student account their pay goes to, as they do not serve their own.
create or replace function app_private.lock_account(p_student_no text, p_me uuid) returns public.accounts
language plpgsql security definer set search_path = '' as $$
declare
  v_student public.students;
  v_account public.accounts;
begin
  select * into v_student from public.students where student_no = p_student_no;
  if not found then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  if v_student.status <> 'normal' then
    perform app_private.fail('STUDENT_INACTIVE', jsonb_build_object('status', v_student.status));
  end if;
  if v_student.user_id = p_me or exists (select 1 from public.staff_payroll where user_id = p_me and account = p_student_no) then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  select * into v_account from public.accounts where student_no = p_student_no for update;
  return v_account;
end
$$;

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
  if v_student.user_id = v_me or exists (select 1 from public.staff_payroll where user_id = v_me and account = p_student_no) then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  return jsonb_build_object('student_no', v_student.student_no, 'name', v_student.name, 'division', v_student.division,
    'cohort', v_student.cohort, 'class_no', v_student.class_no, 'grade', public.grade(v_student),
    'class_label', public.class_label(v_student), 'status', v_student.status,
    'balance', (select balance from public.accounts where student_no = p_student_no),
    'withdrawn_today', app_private.withdrawn_today(p_student_no));
end
$$;

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
    if not app_private.json_int_between(p_value, 1, 10000) then
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

-- 参与考勤 (bank admin), for a teller.
create function public.set_attendance(p_user_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
begin
  perform app_private.require_teller(p_user_id);
  if p_on is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"attendance"}');
  end if;
  insert into public.staff_payroll as s (user_id, attendance) values (p_user_id, p_on)
  on conflict (user_id) do update set attendance = excluded.attendance where s.attendance <> excluded.attendance;
  return jsonb_build_object('user_id', p_user_id, 'attendance', p_on);
end
$$;

-- Binds the student account a teller's pay goes to, with that account's password: by the teller themself, or by the
-- bank admin or the sysadmin. A wrong password counts toward the student login's lockout, so it answers
-- {"error": "WRONG_PASSWORD" | "LOGIN_LOCKED"} instead of raising (which would undo the count).
create function public.bind_salary_account(p_user_id uuid, p_student_no text, p_password text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'teacher', 'sysadmin');
  v_student public.students;
  v_hash text;
begin
  if p_user_id is distinct from v_me and not (app_private.has_role('teacher') or app_private.has_role('sysadmin')) then
    perform app_private.fail('FORBIDDEN', '{"roles":["teacher","sysadmin"]}', '42501');
  end if;
  perform app_private.require_teller(p_user_id);
  select * into v_student from public.students where student_no = p_student_no;
  if not found or v_student.user_id is null then
    perform app_private.fail('STUDENT_NOT_FOUND');
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

create function public.unbind_salary_account(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'teacher', 'sysadmin');
begin
  if p_user_id is distinct from v_me and not (app_private.has_role('teacher') or app_private.has_role('sysadmin')) then
    perform app_private.fail('FORBIDDEN', '{"roles":["teacher","sysadmin"]}', '42501');
  end if;
  update public.staff_payroll set account = null where user_id = p_user_id and account is not null;
  return jsonb_build_object('user_id', p_user_id, 'account', null);
end
$$;

-- 签到: the teller's shift of now; signing in again answers the shift already signed.
create function public.sign_attendance() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_day date := app_private.cn_date(now());
  v_shift text := app_private.shift_of(now());
  v_row public.attendance;
begin
  if not coalesce((select attendance from public.staff_payroll where user_id = v_me), false) then
    perform app_private.fail('ATTENDANCE_OFF');
  end if;
  insert into public.attendance (user_id, day, shift, signed_by) values (v_me, v_day, v_shift, v_me)
  on conflict (user_id, day, shift) do nothing returning * into v_row;
  if v_row.id is null then
    select * into v_row from public.attendance where user_id = v_me and day = v_day and shift = v_shift;
  end if;
  return to_jsonb(v_row);
end
$$;

-- 补签 (bank admin): a shift the teller did not sign in for, today's already begun or an earlier one; confirmed at once.
create function public.makeup_attendance(p_user_id uuid, p_day date, p_shift text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row public.attendance;
begin
  perform app_private.require_teller(p_user_id);
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

-- 审核 (bank admin): confirm or reject shifts, also to change an earlier decision, until the shift is paid.
create function public.review_attendance(p_ids uuid[], p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_count integer;
begin
  if p_status is null or p_status not in ('confirmed', 'rejected') then
    perform app_private.fail('INVALID_INPUT', '{"field":"status"}');
  end if;
  if coalesce(cardinality(p_ids), 0) = 0 then
    perform app_private.fail('INVALID_INPUT', '{"field":"attendance"}');
  end if;
  perform 1 from public.attendance where id = any(p_ids) order by id for update;
  if exists (select 1 from public.attendance where id = any(p_ids) and salary_txn is not null) then
    perform app_private.fail('ATTENDANCE_PAID');
  end if;
  update public.attendance
  set status = p_status, reviewed_by = v_me, reviewed_at = now(), note = coalesce(nullif(trim(p_note), ''), note)
  where id = any(p_ids) and status <> p_status;
  get diagnostics v_count = row_count;
  return jsonb_build_object('count', v_count);
end
$$;

-- 发放工资 (bank admin) for the week (Monday to Sunday) holding p_week: every confirmed shift not yet paid up to its
-- Sunday, earlier ones included, one salary transaction per teller. A teller with no bound account, or whose account
-- is frozen or graduated, is skipped and paid in a later payout. Paying again pays only shifts confirmed since.
create function public.pay_salaries(p_week date) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_from date := p_week - (extract(isodow from p_week)::integer - 1);
  v_to date := v_from + 6;
  v_rate integer := app_private.setting('salary_per_shift')::integer;
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
    select a.user_id, p.display_name, s.account, array_agg(a.id) as ids, count(*)::integer as n, min(a.day) as first, max(a.day) as last
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
    update public.accounts set balance = balance + r.n * v_rate, updated_at = now()
    where student_no = r.account returning * into v_account;
    insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, reason, operator_id, device_id)
    values (gen_random_uuid(), 'salary', r.account, r.n * v_rate, r.n * v_rate, v_account.balance,
      case when r.first = r.last then to_char(r.first, 'FMMM月FMDD日') else to_char(r.first, 'FMMM月FMDD日') || '至' || to_char(r.last, 'FMMM月FMDD日') end
        || '，' || r.n || ' 个班次', v_me, app_private.request_header('x-device-id'))
    returning * into v_txn;
    update public.attendance set salary_txn = v_txn.id, pay = v_rate where id = any(r.ids);
    v_paid := v_paid || jsonb_build_object('user_id', r.user_id, 'name', r.display_name, 'account', r.account,
      'shifts', r.n, 'amount', v_txn.amount, 'txn_no', v_txn.txn_no);
  end loop;
  if jsonb_array_length(v_paid) > 0 then
    perform app_private.log('salary.pay', null, null, jsonb_build_object('from', v_from, 'to', v_to, 'rate', v_rate, 'paid', v_paid));
  end if;
  return jsonb_build_object('from', v_from, 'to', v_to, 'rate', v_rate, 'paid', v_paid, 'skipped', v_skipped);
end
$$;

grant execute on function public.set_attendance(uuid, boolean), public.bind_salary_account(uuid, text, text),
  public.unbind_salary_account(uuid), public.sign_attendance(), public.makeup_attendance(uuid, date, text, text),
  public.review_attendance(uuid[], text, text), public.pay_salaries(date) to authenticated;
