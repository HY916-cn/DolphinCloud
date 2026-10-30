-- The 银行管理员 shows by its role, 银行管理员, wherever the app names a login (the page header, 日志, 员工).
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
  insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'staff', v_login, '银行管理员');
  insert into public.user_roles (user_id, role) values (v_uid, 'teacher');
  return v_uid;
end
$$;

update public.profiles set display_name = '银行管理员'
where display_name = login_id and id in (select user_id from public.user_roles where role = 'teacher');
