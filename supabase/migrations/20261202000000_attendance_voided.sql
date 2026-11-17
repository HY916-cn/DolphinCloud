-- 已作废 apart from 未通过 (PHASE-1.md §5.2, §6.9): both leave a shift rejected and unpaid; a voided one also records
-- when and by whom (voided_at, voided_by), so a shift confirmed and later voided no longer reads as failing review.

alter table public.attendance
  add column voided_at timestamptz,
  add column voided_by uuid references public.profiles(id),
  add constraint attendance_voided check ((voided_at is null) = (voided_by is null) and (voided_at is null or status = 'rejected'));

-- Shifts voided so far: the audit log has each update that turned a confirmed shift rejected, which only
-- void_attendance does (review turns a pending one); it set reviewed_by and reviewed_at to who voided it and when.
-- A rejected shift without such an entry stays as it is. Returns how many it marked; running it again marks none.
create function app_private.mark_voided_from_log() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  update public.attendance a set voided_at = (l.after ->> 'reviewed_at')::timestamptz, voided_by = (l.after ->> 'reviewed_by')::uuid
  from (
    select distinct on (target) target, after from public.audit_log
    where action = 'attendance.update' and before ->> 'status' = 'confirmed' and after ->> 'status' = 'rejected'
    order by target, id desc
  ) l
  where l.target = 'attendance:' || a.id and a.status = 'rejected' and a.voided_at is null
    and l.after ->> 'reviewed_at' is not null and l.after ->> 'reviewed_by' is not null;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function app_private.mark_voided_from_log() from public;
select app_private.mark_voided_from_log();

-- void_attendance, as in 20261201000000_attendance_sign_in.sql, recording voided_at and voided_by.
create or replace function public.void_attendance(p_id uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row public.attendance;
begin
  select * into v_row from public.attendance where id = p_id for update;
  if not found or v_row.status = 'pending' then
    perform app_private.fail('INVALID_INPUT', '{"field":"id"}');
  end if;
  if v_row.user_id = v_me or v_row.role = (select role from public.user_roles where user_id = v_me) then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  if v_row.salary_txn is not null then
    perform app_private.fail('ATTENDANCE_PAID');
  end if;
  if v_row.status = 'rejected' then
    perform app_private.fail('ATTENDANCE_REVIEWED');
  end if;
  if nullif(trim(p_note), '') is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  update public.attendance
  set status = 'rejected', note = trim(p_note), reviewed_by = v_me, reviewed_at = now(), voided_by = v_me, voided_at = now()
  where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end
$$;
