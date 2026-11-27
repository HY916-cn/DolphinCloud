-- 注销 against business at the same moment (PHASE-1.md §6.8, PHASE-2.md §10.10): close_accounts locks the student's
-- account before it looks at their loans, 理财 and 定期, and reads the student again once it holds the lock; a 买入 or
-- 开定期 that got the lock first is redeemed or ended with the rest, and one waiting for it then finds the student
-- closed. Every counter business reads the student's status again once it holds the account, too.

-- lock_account as in 20261104000100_attendance.sql, the status read again under the lock.
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
  select * into v_student from public.students where student_no = p_student_no;
  if v_student.status <> 'normal' then
    perform app_private.fail('STUDENT_INACTIVE', jsonb_build_object('status', v_student.status));
  end if;
  return v_account;
end
$$;

-- close_accounts as in 20261120000200_wealth.sql, the account locked first.
create or replace function public.close_accounts(p_user_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_uid uuid;
  v_student public.students;
  v_account public.accounts;
  v_loan_no text;
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
      select * into v_student from public.students where user_id = v_uid;
      if v_student.status = 'closed' then
        perform app_private.fail('USER_NOT_FOUND');
      end if;
      v_loan_no := (select loan_no from public.loans where student_no = v_student.student_no and status in ('active', 'overdue'));
      if v_loan_no is not null then
        perform app_private.fail('LOAN_OUTSTANDING', jsonb_build_object('student_no', v_student.student_no, 'loan_no', v_loan_no));
      end if;
      perform app_private.end_wealth(h.id, 'redeemed', v_me, now())
      from public.wealth_holdings h where h.student_no = v_student.student_no and h.status = 'open';
      perform app_private.end_term_deposit(d.id, 'early', 0, v_me, now())
      from public.term_deposits d where d.student_no = v_student.student_no and d.status = 'open';
      select * into v_account from public.accounts where student_no = v_student.student_no;
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
