-- One 银行管理员 (role teacher) for the whole bank (PHASE-1.md §4.1); every other role may have many logins.
-- `dolphin create-admin` creates it once. Nobody can create a second one, turn a login into one, or change its role;
-- when it forgets its password, `dolphin reset-admin` puts it back on the default password.

create unique index user_roles_one_teacher on public.user_roles (role) where role = 'teacher';

create or replace function public.create_staff(p_login_id text, p_name text, p_role public.app_role) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_login text := lower(trim(p_login_id));
  v_password text := app_private.new_password('staff');
  v_uid uuid;
begin
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

create or replace function public.set_role(p_user_id uuid, p_role public.app_role) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_kind text := (select login_kind from public.profiles where id = p_user_id);
begin
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

create or replace function app_private.create_admin(p_login_id text) returns uuid
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
  if exists (select 1 from public.user_roles where role = 'teacher') then
    perform app_private.fail('ONE_BANK_ADMIN');
  end if;
  v_uid := app_private.create_login(v_login || '@staff.dolphin.internal', app_private.default_password());
  insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'staff', v_login, v_login);
  insert into public.user_roles (user_id, role) values (v_uid, 'teacher');
  return v_uid;
end
$$;

-- `dolphin reset-admin`: the 银行管理员 back on the default password and enabled, its sessions ended. Returns its login id.
create function app_private.reset_admin() returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select user_id from public.user_roles where role = 'teacher');
begin
  if v_uid is null then
    perform app_private.fail('USER_NOT_FOUND');
  end if;
  perform set_config('dolphin.password_reset', 'on', true);
  update auth.users set encrypted_password = public.crypt(app_private.default_password(), public.gen_salt('bf', 10)),
    banned_until = null, updated_at = now()
  where id = v_uid;
  perform set_config('dolphin.password_reset', '', true);
  update public.profiles set disabled = false where id = v_uid;
  perform app_private.end_sessions(v_uid);
  perform app_private.log('user.reset_password', 'profiles:' || v_uid);
  return (select login_id from public.profiles where id = v_uid);
end
$$;
revoke all on function app_private.reset_admin() from public;
