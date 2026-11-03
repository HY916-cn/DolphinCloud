-- 行长 (president): many logins, the bank admin's rights in everything but managing logins (PHASE-1.md §4.1). Every
-- check for the bank admin (has_role('teacher')) also passes for a president; the functions that manage student and
-- staff logins refuse one. The bank admin and the sysadmin create and manage president logins like any other staff.

create or replace function app_private.has_role(p_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and (r.role = p_role or p_role = 'teacher' and r.role = 'president')
      and not p.disabled and not p.must_change_password
  )
$$;

-- Managing logins (导入名册, 账户状态, passwords, 停用, 注销, 身份, 工资账户) is not the president's.
create function app_private.forbid_president() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.user_roles where user_id = auth.uid() and role = 'president') then
    perform app_private.fail('FORBIDDEN', '{"roles":["teacher","sysadmin"]}', '42501');
  end if;
end
$$;

-- import_roster, as in 20261028000400_divisions_cohorts.sql.
create or replace function public.import_roster(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '60s' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row jsonb;
  v_index integer := 0;
  v_no text;
  v_name text;
  v_division text;
  v_cohort integer;
  v_class integer;
  v_opening integer;
  v_uid uuid;
  v_password text;
  v_created jsonb := '[]';
  v_updated integer := 0;
begin
  perform app_private.forbid_president();
  if jsonb_typeof(p_rows) is distinct from 'array' then
    perform app_private.fail('INVALID_INPUT', '{"field":"rows"}');
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    v_no := nullif(trim(v_row ->> 'student_no'), '');
    v_name := nullif(trim(v_row ->> 'name'), '');
    v_division := v_row ->> 'division';
    if coalesce(v_no, '') !~ '^[A-Za-z0-9_-]{1,32}$' or v_name is null or coalesce(v_division, '') not in ('primary', 'junior')
       or not app_private.json_int_between(v_row -> 'class_no', 1, 99) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index));
    end if;
    if not app_private.json_int_between(v_row -> 'cohort', 2000, 2100)
       or app_private.class_label(v_division, (v_row ->> 'cohort')::integer, 1) is null then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index, 'field', 'cohort'));
    end if;
    v_cohort := (v_row ->> 'cohort')::integer;
    v_class := (v_row ->> 'class_no')::integer;
    if jsonb_typeof(v_row -> 'opening_balance') is distinct from 'null' and v_row ? 'opening_balance'
       and not app_private.json_int_between(v_row -> 'opening_balance', 0, 1000000) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index, 'field', 'opening_balance'));
    end if;
    v_opening := case when jsonb_typeof(v_row -> 'opening_balance') = 'number' then (v_row ->> 'opening_balance')::integer else 0 end;

    if exists (select 1 from public.students where student_no = v_no) then
      update public.students set name = v_name, division = v_division, cohort = v_cohort, class_no = v_class
      where student_no = v_no and (name, division, cohort, class_no) is distinct from (v_name, v_division, v_cohort, v_class);
      update public.profiles set display_name = v_name
      where id = (select user_id from public.students where student_no = v_no) and display_name <> v_name;
      v_updated := v_updated + 1;
      continue;
    end if;

    v_password := app_private.new_password('student');
    v_uid := app_private.create_login(v_no || '@student.dolphin.internal', v_password);
    insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'student', v_no, v_name);
    insert into public.students (student_no, user_id, name, division, cohort, class_no)
    values (v_no, v_uid, v_name, v_division, v_cohort, v_class);
    insert into public.accounts (student_no, balance, total_in) values (v_no, v_opening, v_opening);
    if v_opening > 0 then
      insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, device_id)
      values (gen_random_uuid(), 'opening', v_no, v_opening, v_opening, v_opening, v_me, app_private.request_header('x-device-id'));
    end if;
    v_created := v_created || jsonb_build_object('student_no', v_no, 'name', v_name, 'division', v_division, 'cohort', v_cohort,
      'class_no', v_class, 'class_label', app_private.class_label(v_division, v_cohort, v_class), 'password', v_password);
  end loop;
  perform app_private.log('roster.import', null, null,
    jsonb_build_object('created', jsonb_array_length(v_created), 'updated', v_updated));
  return jsonb_build_object('created', jsonb_array_length(v_created), 'updated', v_updated, 'accounts', v_created);
end
$$;

-- set_student_status, as in 20261105000100_accounts.sql.
create or replace function public.set_student_status(p_student_no text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
begin
  perform app_private.forbid_president();
  if p_status is null or p_status not in ('normal', 'frozen', 'graduated') then
    perform app_private.fail('INVALID_INPUT', '{"field":"status"}');
  end if;
  if (select status from public.students where student_no = p_student_no) = 'closed' then
    perform app_private.fail('ACCOUNT_CLOSED');
  end if;
  update public.students set status = p_status where student_no = p_student_no and status <> p_status;
  if not exists (select 1 from public.students where student_no = p_student_no) then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  return jsonb_build_object('student_no', p_student_no, 'status', p_status);
end
$$;

-- reset_password, as in 20261102000100_random_passwords.sql.
create or replace function public.reset_password(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_profile public.profiles;
  v_password text;
begin
  perform app_private.forbid_president();
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    perform app_private.fail('USER_NOT_FOUND');
  end if;
  perform app_private.guard_teacher(app_private.is_teacher(p_user_id));
  v_password := app_private.set_new_password(p_user_id);
  perform app_private.log('user.reset_password', 'profiles:' || p_user_id);
  return jsonb_build_object('user_id', p_user_id, 'login_id', v_profile.login_id, 'password', v_password);
end
$$;

-- reissue_passwords, as in 20261102000100_random_passwords.sql.
create or replace function public.reissue_passwords(p_student_nos text[]) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '60s' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_student record;
  v_accounts jsonb := '[]';
begin
  perform app_private.forbid_president();
  for v_student in
    select s.* from public.students s join public.profiles p on p.id = s.user_id
    where s.student_no = any(p_student_nos) and p.must_change_password
    order by s.student_no
  loop
    v_accounts := v_accounts || jsonb_build_object('student_no', v_student.student_no, 'name', v_student.name,
      'division', v_student.division, 'cohort', v_student.cohort, 'class_no', v_student.class_no,
      'class_label', app_private.class_label(v_student.division, v_student.cohort, v_student.class_no),
      'password', app_private.set_new_password(v_student.user_id));
  end loop;
  perform app_private.log('user.reissue_passwords', null, null,
    jsonb_build_object('student_nos', (select coalesce(jsonb_agg(a -> 'student_no'), '[]') from jsonb_array_elements(v_accounts) a)));
  return jsonb_build_object('accounts', v_accounts);
end
$$;

-- close_accounts, as in 20261105000100_accounts.sql.
create or replace function public.close_accounts(p_user_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_uid uuid;
  v_student public.students;
  v_account public.accounts;
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

-- create_staff, as in 20261031000000_one_bank_admin.sql.
create or replace function public.create_staff(p_login_id text, p_name text, p_role public.app_role) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_login text := lower(trim(p_login_id));
  v_password text := app_private.new_password('staff');
  v_uid uuid;
begin
  perform app_private.forbid_president();
  if not app_private.valid_staff_login(v_login) or nullif(trim(p_name), '') is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"login_id"}');
  end if;
  if p_role is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"role"}');
  end if;
  if exists (select 1 from public.profiles where login_kind = 'staff' and login_id = v_login) then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"login_id"}');
  end if;
  perform app_private.guard_teacher(p_role = 'teacher');
  if p_role = 'teacher' then
    perform app_private.fail('ONE_BANK_ADMIN');
  end if;
  v_uid := app_private.create_login(v_login || '@staff.dolphin.internal', v_password);
  insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'staff', v_login, trim(p_name));
  insert into public.user_roles (user_id, role) values (v_uid, p_role);
  return jsonb_build_object('user_id', v_uid, 'login_id', v_login, 'role', p_role, 'password', v_password);
end
$$;

-- set_role, as in 20261031000000_one_bank_admin.sql.
create or replace function public.set_role(p_user_id uuid, p_role public.app_role) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_kind text := (select login_kind from public.profiles where id = p_user_id);
begin
  perform app_private.forbid_president();
  if v_kind is null then
    perform app_private.fail('USER_NOT_FOUND');
  end if;
  if v_kind <> 'staff' or p_role is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"role"}');
  end if;
  perform app_private.guard_teacher(app_private.is_teacher(p_user_id) or p_role = 'teacher');
  if app_private.is_teacher(p_user_id) or p_role = 'teacher' then
    perform app_private.fail('ONE_BANK_ADMIN');
  end if;
  insert into public.user_roles (user_id, role) values (p_user_id, p_role)
  on conflict (user_id) do update set role = excluded.role where public.user_roles.role <> excluded.role;
  return jsonb_build_object('user_id', p_user_id, 'role', p_role);
end
$$;

-- set_user_disabled, as in 20261105000100_accounts.sql.
create or replace function public.set_user_disabled(p_user_id uuid, p_disabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
begin
  perform app_private.forbid_president();
  if not exists (select 1 from public.profiles where id = p_user_id) then
    perform app_private.fail('USER_NOT_FOUND');
  end if;
  if p_user_id = v_me or p_disabled is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"user_id"}');
  end if;
  if (select closed_at from public.profiles where id = p_user_id) is not null then
    perform app_private.fail('ACCOUNT_CLOSED');
  end if;
  perform app_private.guard_teacher(app_private.is_teacher(p_user_id));
  update public.profiles set disabled = p_disabled where id = p_user_id;
  update auth.users set banned_until = case when p_disabled then '9999-12-31'::timestamptz end where id = p_user_id;
  if p_disabled then
    update public.staff_payroll set attendance = false where user_id = p_user_id and attendance;
    perform app_private.end_sessions(p_user_id);
  end if;
  return jsonb_build_object('user_id', p_user_id, 'disabled', p_disabled);
end
$$;

-- bind_salary_account, as in 20261106000000_audit_fixes.sql.
create or replace function public.bind_salary_account(p_user_id uuid, p_student_no text, p_password text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'teacher', 'sysadmin');
  v_student public.students;
  v_hash text;
begin
  perform app_private.forbid_president();
  if p_user_id is distinct from v_me and not (app_private.has_role('teacher') or app_private.has_role('sysadmin')) then
    perform app_private.fail('FORBIDDEN', '{"roles":["teacher","sysadmin"]}', '42501');
  end if;
  perform app_private.require_teller(p_user_id);
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

-- unbind_salary_account, as in 20261105000200_duty.sql.
create or replace function public.unbind_salary_account(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'teacher', 'sysadmin');
begin
  perform app_private.forbid_president();
  if p_user_id is distinct from v_me and not (app_private.has_role('teacher') or app_private.has_role('sysadmin')) then
    perform app_private.fail('FORBIDDEN', '{"roles":["teacher","sysadmin"]}', '42501');
  end if;
  if (select attendance from public.staff_payroll where user_id = p_user_id) then
    perform app_private.fail('ATTENDANCE_ON');
  end if;
  update public.staff_payroll set account = null where user_id = p_user_id and account is not null;
  return jsonb_build_object('user_id', p_user_id, 'account', null);
end
$$;
