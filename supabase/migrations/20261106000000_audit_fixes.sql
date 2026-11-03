-- 下班总结 read by the server, the last 运维员 kept, a 工资账户 bound only to an account in use, 已注销 in the report and
-- a currency issue dated today at the latest.

-- 下班总结: the caller's transactions since 上班. A teller reads only today's 流水, so a duty across midnight is counted
-- here as end_duty counts it.
create function public.duty_txns() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_started timestamptz := (select started_at from public.duty where user_id = v_me and ended_at is null);
begin
  if v_started is null then
    perform app_private.fail('OFF_DUTY');
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object('txn_no', t.txn_no, 'type', t.type, 'amount', t.amount,
      'balance_delta', t.balance_delta, 'payment', t.payment, 'status', t.status, 'created_at', t.created_at,
      'student_no', t.student_no, 'name', s.name) order by t.seq)
    from public.txns t left join public.students s on s.student_no = t.student_no
    where t.operator_id = v_me and t.created_at >= v_started), '[]');
end
$$;
grant execute on function public.duty_txns() to authenticated;

-- At least one 运维员 stays in use: the last one cannot be stopped, closed or given another role.
create function app_private.keep_sysadmin() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
begin
  if tg_table_name = 'profiles' then
    if old.disabled or not new.disabled then
      return null;
    end if;
    v_user := old.id;
    if not exists (select 1 from public.user_roles where user_id = v_user and role = 'sysadmin') then
      return null;
    end if;
  else
    if old.role <> 'sysadmin' then
      return null;
    end if;
    if tg_op = 'UPDATE' then
      if new.role = 'sysadmin' then
        return null;
      end if;
    end if;
    v_user := old.user_id;
    if (select disabled from public.profiles where id = v_user) then
      return null;
    end if;
  end if;
  if not exists (select 1 from public.user_roles r join public.profiles p on p.id = r.user_id
      where r.role = 'sysadmin' and r.user_id <> v_user and not p.disabled) then
    perform app_private.fail('LAST_SYSADMIN');
  end if;
  return null;
end
$$;
create trigger keep_sysadmin after update of disabled on public.profiles
  for each row execute function app_private.keep_sysadmin();
create trigger keep_sysadmin after update of role or delete on public.user_roles
  for each row execute function app_private.keep_sysadmin();

-- A 工资账户 is a student account in use (在读).
create or replace function public.bind_salary_account(p_user_id uuid, p_student_no text, p_password text) returns jsonb
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
