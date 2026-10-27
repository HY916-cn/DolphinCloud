-- Default password (PHASE-1.md §6.5): every new or reset login gets a12345678 and must replace it at the next sign-in.
-- That one change is the only self-service change; afterwards only a teacher or sysadmin resets the password.
-- Until the default is replaced the login holds no role and sees no account data.

create function app_private.default_password() returns text language sql immutable as $$ select 'a12345678' $$;

create or replace function app_private.new_password(p_login_kind text) returns text
language sql volatile set search_path = '' as $$ select app_private.default_password() $$;

create or replace function app_private.has_role(p_role public.app_role) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
    where r.user_id = auth.uid() and r.role = p_role and not p.disabled and not p.must_change_password
  )
$$;

create or replace function app_private.my_student_no() returns text
language sql stable security definer set search_path = '' as $$
  select s.student_no from public.students s join public.profiles p on p.id = s.user_id
  where s.user_id = auth.uid() and not p.must_change_password
$$;

alter policy read on public.students using (
  student_no = (select app_private.my_student_no()) or (select app_private.has_role('teller'))
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher')));

-- Password changes by the user (through Auth) are allowed only while must_change_password is set, and not back to the
-- default. reset_password marks its own update with dolphin.password_reset. Logins without a profile are not checked.
create function app_private.password_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if current_setting('dolphin.password_reset', true) = 'on'
     or not exists (select 1 from public.profiles where id = new.id) then
    return new;
  end if;
  if not (select must_change_password from public.profiles where id = new.id) then
    raise exception 'PASSWORD_CHANGE_FORBIDDEN' using errcode = '42501';
  end if;
  if new.encrypted_password = public.crypt(app_private.default_password(), new.encrypted_password) then
    raise exception 'PASSWORD_UNCHANGED' using errcode = 'P0001';
  end if;
  return new;
end
$$;
create trigger dolphin_password_guard before update of encrypted_password on auth.users for each row
  when (old.encrypted_password is distinct from new.encrypted_password) execute function app_private.password_guard();

-- must_change_password follows the password: set when it is the default, cleared once replaced.
create or replace function app_private.password_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles
  set must_change_password = (new.encrypted_password = public.crypt(app_private.default_password(), new.encrypted_password))
  where id = new.id;
  return null;
end
$$;

create or replace function public.reset_password(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_profile public.profiles;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    perform app_private.fail('USER_NOT_FOUND');
  end if;
  perform app_private.guard_teacher(app_private.is_teacher(p_user_id));
  perform set_config('dolphin.password_reset', 'on', true);
  update auth.users set encrypted_password = public.crypt(app_private.default_password(), public.gen_salt('bf', 10)),
    updated_at = now()
  where id = p_user_id;
  perform set_config('dolphin.password_reset', '', true);
  perform app_private.end_sessions(p_user_id);
  perform app_private.log('user.reset_password', 'profiles:' || p_user_id);
  return jsonb_build_object('user_id', p_user_id, 'login_id', v_profile.login_id, 'password', app_private.default_password());
end
$$;

-- `dolphin create-admin <login>`: teacher + sysadmin with the default password.
drop function app_private.create_admin(text, text);
create function app_private.create_admin(p_login_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_login text := lower(trim(p_login_id));
  v_uid uuid;
begin
  if not app_private.valid_staff_login(v_login) then
    perform app_private.fail('INVALID_INPUT', '{"field":"login_id"}');
  end if;
  if exists (select 1 from public.profiles where login_kind = 'staff' and login_id = v_login) then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"login_id"}');
  end if;
  v_uid := app_private.create_login(v_login || '@staff.dolphin.internal', app_private.default_password());
  insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'staff', v_login, v_login);
  insert into public.user_roles (user_id, role) values (v_uid, 'teacher'), (v_uid, 'sysadmin');
  return v_uid;
end
$$;
