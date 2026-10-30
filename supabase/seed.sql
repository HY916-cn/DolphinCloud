-- Development data: psql -f supabase/seed.sql against a fresh local container (never production).
-- Every login uses the default password a12345678 and has one identity: admin (teacher), ops01 (sysadmin),
-- teller01 (teller), three students. All but 20260003 are past their first sign-in; 20260003 still has to set a new password.
begin;
do $$
declare
  v_teacher uuid; v_admin uuid; v_teller uuid; v_uid uuid; v_book uuid; v_pen uuid;
  v_row record;
begin
  v_teacher := app_private.create_admin('admin');
  v_teller := app_private.create_login('teller01@staff.dolphin.internal', app_private.default_password());
  insert into profiles (id, login_kind, login_id, display_name) values (v_teller, 'staff', 'teller01', '柜员小林');
  insert into user_roles values (v_teller, 'teller');
  v_admin := app_private.create_login('ops01@staff.dolphin.internal', app_private.default_password());
  insert into profiles (id, login_kind, login_id, display_name) values (v_admin, 'staff', 'ops01', '运维小周');
  insert into user_roles values (v_admin, 'sysadmin');

  for v_row in select * from (values
      ('20260001', '张小明', 'primary', app_private.grade_of('primary', 0) - 4, 1, 120),
      ('20260002', '李思远', 'junior', app_private.grade_of('junior', 0) - 8, 3, 60),
      ('20260003', '王小雨', 'primary', app_private.grade_of('primary', 0) - 3, 2, 0)) s(no, name, division, cohort, class_no, opening)
  loop
    v_uid := app_private.create_login(v_row.no || '@student.dolphin.internal', app_private.default_password());
    insert into profiles (id, login_kind, login_id, display_name) values (v_uid, 'student', v_row.no, v_row.name);
    insert into students (student_no, user_id, name, division, cohort, class_no)
    values (v_row.no, v_uid, v_row.name, v_row.division, v_row.cohort, v_row.class_no);
    insert into accounts (student_no, balance, total_in) values (v_row.no, v_row.opening, v_row.opening);
    if v_row.opening > 0 then
      insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
      values (gen_random_uuid(), 'opening', v_row.no, v_row.opening, v_row.opening, v_row.opening, v_teacher, now() - interval '20 days');
    end if;
  end loop;
  update profiles set must_change_password = false where login_id <> '20260003';

  perform set_config('request.jwt.claims', json_build_object('sub', v_teacher)::text, true);
  v_book := (upsert_product(null, '海豚书签', 10, 4, '文具', null, true) ->> 'id')::uuid;
  v_pen := (upsert_product(null, '海浪中性笔', 6, 3, '文具', null, true) ->> 'id')::uuid;
  perform stock_in(v_book, 30, '首批');
  perform stock_in(v_pen, 50, '首批');

  perform set_config('request.jwt.claims', json_build_object('sub', v_teller)::text, true);
  perform deposit(gen_random_uuid(), '20260001', '{"10":2,"5":1}');
  perform withdraw(gen_random_uuid(), '20260001', 15);
  perform purchase(gen_random_uuid(), '20260001', jsonb_build_array(jsonb_build_object('product_id', v_book, 'qty', 1),
    jsonb_build_object('product_id', v_pen, 'qty', 2)), 'account');
  perform purchase(gen_random_uuid(), '20260002', jsonb_build_array(jsonb_build_object('product_id', v_pen, 'qty', 1)), 'cash', '{"10":1}');
  perform deposit(gen_random_uuid(), '20260002', '{"5":2}');
end
$$;
commit;
