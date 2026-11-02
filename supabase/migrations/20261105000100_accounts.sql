-- Logins (PHASE-1.md §6.4, §6.5): every initial password is 8 digits; a stopped login drops out of 考勤; 注销 closes a
-- login for good (the bank admin or the sysadmin), clearing a student's balance with one 注销清零 transaction. A closed
-- login stays in the records (transactions, 考勤, 日志) and nowhere else.

create or replace function app_private.new_password(p_login_kind text) returns text
language sql volatile set search_path = '' as $$
  select app_private.random_code(8, '0123456789')
$$;

alter table public.profiles add column closed_at timestamptz;
alter table public.students drop constraint students_status_check;
alter table public.students add constraint students_status_check check (status in ('normal', 'frozen', 'graduated', 'closed'));

-- 停用 / 启用. A stopped teller is no longer counted for 考勤; a closed login cannot be started again.
create or replace function public.set_user_disabled(p_user_id uuid, p_disabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
begin
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

-- 注销 one or more logins. A student's balance is cleared by a 注销清零 transaction (cash stays as it is) and the
-- account closed; a teller whose 工资账户 it was is no longer counted until they bind another.
create function public.close_accounts(p_user_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_uid uuid;
  v_student public.students;
  v_account public.accounts;
  v_cleared integer := 0;
  v_closed jsonb := '[]';
begin
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
grant execute on function public.close_accounts(uuid[]) to authenticated;

-- A closed student keeps its status; the other changes are refused.
create or replace function public.set_student_status(p_student_no text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
begin
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

-- The counter does not find a closed account.
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
  if v_student.status = 'closed' then
    perform app_private.fail('STUDENT_INACTIVE', '{"status":"closed"}');
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
