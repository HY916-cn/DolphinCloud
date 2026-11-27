-- 补签 (PHASE-1.md §6.9, PHASE-2.md §3): only for someone counted (参与考勤), as 签到 and 上班 are; ATTENDANCE_OFF
-- otherwise, so no shift is registered, or paid, for someone not counted.

-- makeup_attendance as in 20261122000000_staff_attendance.sql, with the 参与考勤 check.
create or replace function public.makeup_attendance(p_user_id uuid, p_day date, p_shift text, p_note text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row public.attendance;
begin
  if app_private.payroll_role(p_user_id) = (select role from public.user_roles where user_id = v_me) then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  if not coalesce((select attendance from public.staff_payroll where user_id = p_user_id), false) then
    perform app_private.fail('ATTENDANCE_OFF');
  end if;
  if p_shift is null or p_shift not in ('am', 'pm') then
    perform app_private.fail('INVALID_INPUT', '{"field":"shift"}');
  end if;
  if p_day is null or p_day > app_private.cn_date(now())
     or (p_day = app_private.cn_date(now()) and p_shift = 'pm' and app_private.shift_of(now()) = 'am') then
    perform app_private.fail('INVALID_INPUT', '{"field":"day"}');
  end if;
  if nullif(trim(p_note), '') is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"note"}');
  end if;
  insert into public.attendance (user_id, day, shift, status, signed_by, note, reviewed_by, reviewed_at)
  values (p_user_id, p_day, p_shift, 'confirmed', v_me, trim(p_note), v_me, now())
  on conflict (user_id, day, shift) do nothing returning * into v_row;
  if v_row.id is null then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"attendance"}');
  end if;
  return to_jsonb(v_row);
end
$$;
