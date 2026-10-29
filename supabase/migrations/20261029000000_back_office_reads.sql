-- Back-office reads (PHASE-1.md §6.6): the sysadmin finds students to reset their passwords (names and classes, no
-- balances); the accountant sees which staff login handled each transaction and which logins are tellers.

alter policy read on public.students using (
  student_no = (select app_private.my_student_no()) or (select app_private.has_role('teller'))
  or (select app_private.has_role('accountant')) or (select app_private.has_role('teacher'))
  or (select app_private.has_role('sysadmin')));

alter policy read on public.profiles using (
  id = auth.uid() or (select app_private.has_role('teacher')) or (select app_private.has_role('sysadmin'))
  or (login_kind = 'staff' and (select app_private.has_role('accountant'))));

alter policy read on public.user_roles using (
  user_id = auth.uid() or (select app_private.has_role('teacher')) or (select app_private.has_role('sysadmin'))
  or (select app_private.has_role('accountant')));
