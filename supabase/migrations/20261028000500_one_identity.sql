-- One identity per account (PHASE-1.md §4.1): a student login holds no role; a staff login holds exactly one.
-- Existing data: student logins lose their roles; a staff login with several keeps one, in the order
-- teacher, sysadmin, accountant, storekeeper, teller.

delete from public.user_roles r using public.profiles p where p.id = r.user_id and p.login_kind = 'student';
delete from public.user_roles r
where exists (
  select 1 from public.user_roles o
  where o.user_id = r.user_id
    and array_position('{teacher,sysadmin,accountant,storekeeper,teller}'::public.app_role[], o.role)
      < array_position('{teacher,sysadmin,accountant,storekeeper,teller}'::public.app_role[], r.role));

alter table public.user_roles add constraint user_roles_one_per_login unique (user_id);

create function app_private.staff_role_only() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select login_kind from public.profiles where id = new.user_id) <> 'staff' then
    perform app_private.fail('INVALID_INPUT', '{"field":"role"}');
  end if;
  return new;
end
$$;
create trigger staff_role_only before insert or update on public.user_roles
  for each row execute function app_private.staff_role_only();

drop function public.create_staff(text, text, public.app_role[]);
create function public.create_staff(p_login_id text, p_name text, p_role public.app_role) returns jsonb
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
  v_uid := app_private.create_login(v_login || '@staff.dolphin.internal', v_password);
  insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'staff', v_login, trim(p_name));
  insert into public.user_roles (user_id, role) values (v_uid, p_role);
  return jsonb_build_object('user_id', v_uid, 'login_id', v_login, 'role', p_role, 'password', v_password);
end
$$;

-- Corrects the one role of a staff login.
drop function public.set_roles(uuid, public.app_role[]);
create function public.set_role(p_user_id uuid, p_role public.app_role) returns jsonb
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
  insert into public.user_roles (user_id, role) values (p_user_id, p_role)
  on conflict (user_id) do update set role = excluded.role where public.user_roles.role <> excluded.role;
  return jsonb_build_object('user_id', p_user_id, 'role', p_role);
end
$$;

grant execute on function public.create_staff(text, text, public.app_role), public.set_role(uuid, public.app_role) to authenticated;

-- `dolphin create-admin <login>`: the first teacher, on the default password; the teacher creates every other staff login.
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
  v_uid := app_private.create_login(v_login || '@staff.dolphin.internal', app_private.default_password());
  insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'staff', v_login, v_login);
  insert into public.user_roles (user_id, role) values (v_uid, 'teacher');
  return v_uid;
end
$$;
