-- 冻结 / 毕业 (PHASE-1.md §5.2): the 银行管理员 sets a student's status; counter business serves only normal students
-- (lock_account raises STUDENT_INACTIVE). The students audit trigger logs the change.
create function public.set_student_status(p_student_no text, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
begin
  if p_status is null or p_status not in ('normal', 'frozen', 'graduated') then
    perform app_private.fail('INVALID_INPUT', '{"field":"status"}');
  end if;
  update public.students set status = p_status where student_no = p_student_no and status <> p_status;
  if not exists (select 1 from public.students where student_no = p_student_no) then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  return jsonb_build_object('student_no', p_student_no, 'status', p_status);
end
$$;
grant execute on function public.set_student_status(text, text) to authenticated;
