-- Random initial passwords (PHASE-1.md §6.5): every new, reset or reissued login gets its own password, shown once.
-- Students get 8 digits, staff 8 characters without look-alikes. must_change_password is set explicitly by whoever
-- creates or resets the login; the one self-service change through Auth clears it.

create or replace function app_private.new_password(p_login_kind text) returns text
language sql volatile set search_path = '' as $$
  select case when p_login_kind = 'student' then app_private.random_code(8, '0123456789')
              else app_private.random_code(8, 'abcdefghjkmnpqrstuvwxyz23456789') end
$$;

-- A change by the user (through Auth) is allowed only while must_change_password is set. Auth itself refuses the
-- current password (same_password); the trigger only sees hashes. Changes marked dolphin.password_reset are admin resets.
create or replace function app_private.password_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('dolphin.password_reset', true) = 'on'
     or not exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;
  if not (select must_change_password from public.profiles where id = new.id) then
    raise exception 'PASSWORD_CHANGE_FORBIDDEN' using errcode = '42501';
  end if;
  return new;
end
$$;

-- The user's own change clears must_change_password; resets set it themselves.
create or replace function app_private.password_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('dolphin.password_reset', true) is distinct from 'on' then
    update public.profiles set must_change_password = false where id = new.id and must_change_password;
  end if;
  return null;
end
$$;

-- Gives a login a new random password that it must replace at the next sign-in, ends its sessions and clears a
-- sign-in lock. Returns the password. Callers check roles.
create function app_private.set_new_password(p_user_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_password text := app_private.new_password((select login_kind from public.profiles where id = p_user_id));
begin
  perform set_config('dolphin.password_reset', 'on', true);
  update auth.users set encrypted_password = public.crypt(v_password, public.gen_salt('bf', 10)), updated_at = now()
  where id = p_user_id;
  perform set_config('dolphin.password_reset', '', true);
  update public.profiles set must_change_password = true where id = p_user_id;
  perform app_private.end_sessions(p_user_id);
  delete from app_private.login_attempts where user_id = p_user_id;
  return v_password;
end
$$;

create or replace function public.reset_password(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_profile public.profiles;
  v_password text;
begin
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

-- Reprints 开户通知单: new passwords for the listed students who have not yet replaced their initial one (others are
-- skipped). Returns {accounts: [...]} in the shape of import_roster's accounts.
create function public.reissue_passwords(p_student_nos text[]) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '60s' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_student record;
  v_accounts jsonb := '[]';
begin
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
grant execute on function public.reissue_passwords(text[]) to authenticated;

-- `dolphin create-admin <login>`: the one 银行管理员, on a random password printed once by the CLI.
drop function app_private.create_admin(text);
create function app_private.create_admin(p_login_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_login text := lower(trim(p_login_id));
  v_password text := app_private.new_password('staff');
  v_uid uuid;
begin
  if not app_private.valid_staff_login(v_login) then
    perform app_private.fail('INVALID_INPUT', '{"field":"login_id"}');
  end if;
  if exists (select 1 from public.profiles where login_kind = 'staff' and login_id = v_login) then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"login_id"}');
  end if;
  if exists (select 1 from public.user_roles where role = 'teacher') then
    perform app_private.fail('ONE_BANK_ADMIN');
  end if;
  v_uid := app_private.create_login(v_login || '@staff.dolphin.internal', v_password);
  insert into public.profiles (id, login_kind, login_id, display_name, must_change_password)
  values (v_uid, 'staff', v_login, '银行管理员', true);
  insert into public.user_roles (user_id, role) values (v_uid, 'teacher');
  return jsonb_build_object('user_id', v_uid, 'login_id', v_login, 'password', v_password);
end
$$;
revoke all on function app_private.create_admin(text) from public;

-- `dolphin reset-admin`: the 银行管理员 on a new random password and enabled, its sessions ended.
drop function app_private.reset_admin();
create function app_private.reset_admin() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select user_id from public.user_roles where role = 'teacher');
  v_password text;
begin
  if v_uid is null then
    perform app_private.fail('USER_NOT_FOUND');
  end if;
  v_password := app_private.set_new_password(v_uid);
  update auth.users set banned_until = null where id = v_uid;
  update public.profiles set disabled = false where id = v_uid;
  perform app_private.log('user.reset_password', 'profiles:' || v_uid);
  return jsonb_build_object('login_id', (select login_id from public.profiles where id = v_uid), 'password', v_password);
end
$$;
revoke all on function app_private.reset_admin() from public;

drop function app_private.default_password();
