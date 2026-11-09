-- 工作人员导入与免密码绑定 (PHASE-2.md §5.1, §5.2). The bank admin or the sysadmin binds a teller's 工资账户 without the
-- student's password, one at a time or from a spreadsheet, and each binding is logged; a teller binding their own
-- account still gives the password.

-- Binds without asking for a password; true when the binding changed. p_row is the spreadsheet row for its errors.
create function app_private.bind_salary(p_user_id uuid, p_student_no text, p_row integer default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_student public.students;
  v_changed integer;
begin
  select * into v_student from public.students where student_no = p_student_no;
  if not found or v_student.user_id is null then
    perform app_private.fail('STUDENT_NOT_FOUND', jsonb_strip_nulls(jsonb_build_object('row', p_row)));
  end if;
  if v_student.status <> 'normal' then
    perform app_private.fail('STUDENT_INACTIVE', jsonb_strip_nulls(jsonb_build_object('status', v_student.status, 'row', p_row)));
  end if;
  if exists (select 1 from public.staff_payroll where account = p_student_no and user_id <> p_user_id) then
    perform app_private.fail('ALREADY_EXISTS', jsonb_strip_nulls(jsonb_build_object('field', 'account', 'row', p_row)));
  end if;
  insert into public.staff_payroll as s (user_id, account) values (p_user_id, p_student_no)
  on conflict (user_id) do update set account = excluded.account where s.account is distinct from excluded.account;
  get diagnostics v_changed = row_count;
  if v_changed > 0 then
    perform app_private.log('salary.bind', 'profiles:' || p_user_id, null,
      jsonb_build_object('student_no', p_student_no, 'name', v_student.name));
  end if;
  return v_changed > 0;
end
$$;
revoke all on function app_private.bind_salary(uuid, text, integer) from public;

create or replace function public.bind_salary_account(p_user_id uuid, p_student_no text, p_password text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller', 'teacher', 'sysadmin');
  v_admin boolean := app_private.has_role('teacher') or app_private.has_role('sysadmin');
  v_student public.students;
  v_hash text;
begin
  perform app_private.forbid_president();
  if p_user_id is distinct from v_me and not v_admin then
    perform app_private.fail('FORBIDDEN', '{"roles":["teacher","sysadmin"]}', '42501');
  end if;
  perform app_private.require_teller(p_user_id);
  if v_admin then
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

-- One batch of the staff spreadsheet, in one transaction: [{login_id, name, role, account}]. A new login gets a random
-- initial password, returned once in `accounts`. An existing login only has its name and 工资账户 updated; a blank
-- account leaves the binding as it is.
create function public.import_staff(p_rows jsonb) returns jsonb
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
    if v_account is not null and v_role <> 'teller' then
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
revoke execute on function public.import_staff(jsonb) from public, anon;
grant execute on function public.import_staff(jsonb) to authenticated;
