-- Roster import, staff logins, passwords, products, issues, settings, ranking (PHASE-1.md §6.4, §6.5).
\ir helpers/setup.psql

select tests.staff('teacher', '{teacher}') as teacher \gset
select tests.staff('admin', '{sysadmin}') as admin \gset
select tests.staff('keeper', '{storekeeper}') as keeper \gset
select tests.staff('t1', '{teller}') as t1 \gset

-- Roster import
select is(tests.err(:'admin', $$select import_roster('[]')$$), 'FORBIDDEN', 'only a teacher imports the roster');
-- Roster rows write "P4" / "J7" for the cohorts now in 四年级 / 七年级, so the tests hold whatever today's date is.
select app_private.grade_of('primary', 0) - 4 as p4, app_private.grade_of('junior', 0) - 7 as j7 \gset
create function tests.roster(p_user uuid, p_rows text) returns jsonb language sql as $$
  select tests.call(p_user, format('select import_roster(%L)', replace(replace(p_rows,
    '"P4"', (app_private.grade_of('primary', 0) - 4)::text), '"J7"', (app_private.grade_of('junior', 0) - 7)::text)))
$$;
select tests.roster(:'teacher', $$[
  {"student_no":"20260001","name":"张小明","division":"primary","cohort":"P4","class_no":4,"opening_balance":30},
  {"student_no":"20260002","name":"李四","division":"primary","cohort":"P4","class_no":4},
  {"student_no":"20260003","name":"王五","division":"junior","cohort":"J7","class_no":1,"opening_balance":0}]$$) as roster \gset
select is((:'roster'::jsonb -> 'accounts' -> 2) - 'password', jsonb_build_object('name', '王五', 'cohort', :j7, 'class_no', 1,
  'division', 'junior', 'student_no', '20260003', 'class_label', '七年级(1)班'), 'the result shows grade and class from the cohort');
select is((:'roster'::jsonb - 'accounts'), '{"created":3,"updated":0}', 'three new accounts');
select ok((select bool_and(a ->> 'password' = 'a12345678') from jsonb_array_elements(:'roster'::jsonb -> 'accounts') a),
  'new accounts get the default password');
select ok((select bool_and(u.encrypted_password = crypt(a ->> 'password', u.encrypted_password))
  from jsonb_array_elements(:'roster'::jsonb -> 'accounts') a
  join auth.users u on u.email = (a ->> 'student_no') || '@student.dolphin.internal'), 'each password is the login''s password');
select is((select count(*)::int from auth.identities i join profiles p on p.id = i.user_id where p.login_id like '2026000_'), 3,
  'each login has an email identity');
select is((select array_agg(balance order by student_no) from accounts where student_no like '2026000_'), '{30,0,0}', 'opening balances');
select is((select count(*)::int from txns where type = 'opening' and student_no like '2026000_'), 1, 'one opening transaction for the non-zero balance');
select ok((select bool_and(must_change_password) from profiles where login_id like '2026000_'), 'students must change the initial password');

select is(tests.roster(:'teacher', $$[
  {"student_no":"20260001","name":"张晓明","division":"primary","cohort":"P4","class_no":2,"opening_balance":99},
  {"student_no":"20260004","name":"赵六","division":"primary","cohort":"P4","class_no":4},
  {"student_no":"20260004","name":"赵六","division":"primary","cohort":"P4","class_no":4}]$$) - 'accounts', '{"created":1,"updated":2}',
  'existing and repeated student numbers are updated, not opened again');
select is((select row(s.name, s.class_no, p.display_name, a.balance)::text from students s join profiles p on p.id = s.user_id
  join accounts a using (student_no) where student_no = '20260001'), '(张晓明,2,张晓明,30)', 'name and class updated, balance kept');
select is((select count(*)::int from txns where type = 'opening' and student_no = '20260001'), 1, 'no second opening transaction');
select is(tests.roster(:'teacher', $$[{"student_no":"20260009","name":"甲","division":"primary","cohort":"P4","class_no":4},
  {"student_no":"20260010","division":"primary","cohort":"P4","class_no":4}]$$) ->> 'detail', '{"row": 2}', 'a bad row is reported by number');
select is((select count(*)::int from students where student_no = '20260009'), 0, 'and nothing of the batch is imported');
select is(tests.roster(:'teacher', $$[{"student_no":"20260012","name":"丙","division":"高中部","cohort":"P4","class_no":4}]$$) ->> 'error',
  'INVALID_INPUT', 'division is primary or junior');
select is(tests.roster(:'teacher', $$[{"student_no":"20260012","name":"丙","division":"primary","cohort":"P4","class_no":"4班"}]$$) ->> 'error',
  'INVALID_INPUT', 'the class is a number');
select is(tests.roster(:'teacher', $$[{"student_no":"20260012","name":"丙","division":"junior","cohort":"P4","class_no":4}]$$) ->> 'detail',
  '{"row": 1, "field": "cohort"}', 'the cohort must give a grade of the division (a junior cohort past 九年级 is refused)');
select is(tests.roster(:'teacher', $$[{"student_no":"20260011","name":"乙","division":"primary","cohort":"P4","class_no":4,"opening_balance":-1}]$$) ->> 'error',
  'INVALID_INPUT', 'negative opening balance');

-- Grade from the cohort
select is(app_private.grade_of('primary', 2023, '2026-08-31'), 3, 'before promotion_date: still 三年级');
select is(app_private.grade_of('primary', 2023, '2026-09-01'), 4, 'from promotion_date: 四年级');
select is(app_private.class_label('junior', 2026, 3, '2026-10-01'), '七年级(3)班', 'junior grades are 七–九年级');
select is(app_private.class_label('primary', 2020, 1, '2026-10-01'), null, 'a primary cohort past 六年级 has no grade');
select is(tests.call(:'teacher', $$select set_setting('promotion_date', '"02-15"')$$) ->> 'error', null, 'promotion_date can be set');
select is(app_private.grade_of('primary', 2023, '2026-02-15'), 4, 'and moves the change of grade');
select is(tests.err(:'teacher', $$select set_setting('promotion_date', '"13-01"')$$), 'INVALID_INPUT', 'promotion_date is MM-DD');
select tests.call(:'teacher', $$select set_setting('promotion_date', '"09-01"')$$);
select is(tests.call(:'teacher', $$select jsonb_agg(jsonb_build_array(student_no, s.grade, s.class_label) order by student_no)
  from students s where student_no in ('20260001', '20260003')$$),
  '[["20260001", 4, "四年级(2)班"], ["20260003", 7, "七年级(1)班"]]', 'grade and class_label are computed fields of students');

-- Staff logins and roles
select tests.call(:'admin', $$select create_staff('Teller02', '柜员二', '{teller}')$$) as staff \gset
select is(:'staff'::jsonb ->> 'password', 'a12345678', 'staff logins get the default password too');
select is(:'staff'::jsonb ->> 'login_id', 'teller02', 'login ids are lower case');
select is(tests.err(:'admin', $$select create_staff('teller02', '重复', '{teller}')$$), 'ALREADY_EXISTS', 'duplicate login');
select is(tests.err(:'admin', $$select create_staff('a b', '空格', '{}')$$), 'INVALID_INPUT', 'invalid login id');
select is(tests.err(:'admin', $$select create_staff('teacher2', '老师二', '{teacher}')$$), 'FORBIDDEN', 'a sysadmin cannot create a teacher');
select is(tests.err(:'keeper', $$select create_staff('x1', 'x', '{}')$$), 'FORBIDDEN', 'a storekeeper cannot create logins');
select is(tests.call(:'teacher', $$select create_staff('teacher2', '老师二', '{teacher}')$$) ->> 'login_id', 'teacher2', 'a teacher can');

select is(tests.err(:'admin', format($$select set_roles(%L, '{teller,teacher}')$$, :'t1')), 'FORBIDDEN', 'a sysadmin cannot grant teacher');
select is(tests.err(:'admin', format($$select set_roles(%L, '{}')$$, :'teacher')), 'FORBIDDEN', 'nor revoke it');
select is(tests.call(:'admin', $$select set_roles(id, '{teller,teller}') from profiles where login_id = '20260002'$$) -> 'roles',
  '["teller"]', 'a sysadmin makes a student a teller');
select is(tests.call(:'admin', format($$select set_roles(%L, '{accountant}')$$, :'t1')) -> 'roles', '["accountant"]', 'roles are replaced');
select is(tests.err(:'admin', format($$select set_roles(%L, '{}')$$, gen_random_uuid())), 'USER_NOT_FOUND', 'unknown user');

-- Passwords
select id as stu from profiles where login_id = '20260002' \gset
insert into auth.sessions (id, user_id) values (gen_random_uuid(), :'stu');
select tests.call(:'admin', format($$select reset_password(%L)$$, :'stu')) ->> 'password' as pw \gset
select is(:'pw'::text, 'a12345678', 'reset returns the default password');
select ok((select encrypted_password = crypt('a12345678', encrypted_password) from auth.users where id = :'stu'), 'the login now uses it');
select ok((select must_change_password from profiles where id = :'stu'), 'and must change it at the next sign-in');
select is((select count(*)::int from auth.sessions where user_id = :'stu'), 0, 'existing sessions are ended');
select is(tests.err(:'admin', format($$select reset_password(%L)$$, :'teacher')), 'FORBIDDEN', 'a sysadmin cannot reset a teacher''s password');
select throws_ok(format($$update auth.users set encrypted_password = crypt('a12345678', gen_salt('bf', 4)) where id = %L$$, :'stu'),
  'P0001', 'PASSWORD_UNCHANGED', 'the new password cannot be the default');
update auth.users set encrypted_password = crypt('my-own-pass', gen_salt('bf', 4)) where id = :'stu';
select ok(not (select must_change_password from profiles where id = :'stu'), 'replacing the default clears must_change_password');
select throws_ok(format($$update auth.users set encrypted_password = crypt('another-pass', gen_salt('bf', 4)) where id = %L$$, :'stu'),
  '42501', 'PASSWORD_CHANGE_FORBIDDEN', 'after that the user cannot change it again');
select tests.call(:'admin', format($$select reset_password(%L)$$, :'stu'));
select ok((select must_change_password from profiles where id = :'stu'), 'an admin reset brings back the default');
update auth.users set encrypted_password = crypt('my-new-pass', gen_salt('bf', 4)) where id = :'stu';
select ok(not (select must_change_password from profiles where id = :'stu'), 'which the user replaces once more');

-- Until the default is replaced the login holds no role and sees no account data
select tests.staff('fresh', '{teller}') as fresh \gset
update profiles set must_change_password = true where id = :'fresh';
select is(tests.err(:'fresh', $$select lookup_student('20260001')$$), 'FORBIDDEN', 'a teller still on the default password cannot work');
select id as newstu from profiles where login_id = '20260003' \gset
select is(tests.call(:'newstu', $$select jsonb_build_array((select count(*) from students), (select count(*) from accounts), (select count(*) from profiles))$$),
  '[0, 0, 1]', 'a student still on the default password sees only their own profile');

select is(tests.err(:'teacher', format($$select set_user_disabled(%L, true)$$, :'teacher')), 'INVALID_INPUT', 'nobody disables themselves');
select tests.call(:'teacher', format($$select set_user_disabled(%L, true)$$, :'stu'));
select is((select row(p.disabled, extract(year from u.banned_until))::text from profiles p join auth.users u using (id) where id = :'stu'),
  '(t,9999)', 'disabling bans the login');
select tests.call(:'teacher', format($$select set_user_disabled(%L, false)$$, :'stu'));
select is((select row(p.disabled, u.banned_until)::text from profiles p join auth.users u using (id) where id = :'stu'), '(f,)', 'enable again');

-- Products and issues
select tests.call(:'keeper', $$select upsert_product(null, '书签', 5)$$) ->> 'id' as prod \gset
select is(tests.call(:'keeper', format($$select upsert_product(%L, '海豚书签', 6, 3, '文具', 'p/1.jpg', true)$$, :'prod')) - 'id' - 'updated_at',
  '{"cost":3,"name":"海豚书签","price":6,"stock":0,"listed":true,"category":"文具","image_path":"p/1.jpg","safety_stock":null}', 'edit product');
select is(tests.err(:'t1', $$select upsert_product(null, 'x', 5)$$), 'FORBIDDEN', 'only storekeepers and teachers edit products');
select is(tests.err(:'keeper', $$select upsert_product(null, 'x', 0)$$), 'INVALID_INPUT', 'price must be positive');
select is(tests.err(:'keeper', $$select upsert_product(gen_random_uuid(), 'x', 5)$$), 'PRODUCT_NOT_FOUND', 'unknown product');
select is(tests.err(:'keeper', format($$select stock_in(%L, 0)$$, :'prod')), 'INVALID_INPUT', 'stock in must be positive');
select is(tests.call(:'keeper', format($$select stock_in(%L, 7, '首批')$$, :'prod')) ->> 'stock', '7', 'stock in');
select is((select count(*)::int from audit_log where target = 'products:' || :'prod'), 2, 'product edits are audited, stock changes are not');

select is(tests.call(:'teacher', $$select register_issue('2026-01', '2026-09-01', '{"1":500,"10":100}', '开学发行', '王老师')$$) ->> 'total', '1500',
  'issue total is computed from the denominations');
select is(tests.err(:'teacher', $$select register_issue('2026-01', '2026-09-01', '{"1":1}', '重复', '王老师')$$), 'ALREADY_EXISTS', 'duplicate batch');
select is(tests.err(:'teacher', $$select register_issue('2026-02', '2026-09-01', '{"3":1}', '面额错误', '王老师')$$), 'INVALID_AMOUNT', 'unknown denomination');
select is(tests.err(:'keeper', $$select register_issue('2026-03', '2026-09-01', '{"1":1}', 'x', 'x')$$), 'FORBIDDEN', 'only a teacher registers issues');

-- Settings
select is(tests.call(:'teacher', $$select set_setting('denominations', '[10,5,1,2]')$$) -> 'value', '[1,2,5,10]', 'denominations are sorted');
select is(tests.err(:'teacher', $$select set_setting('denominations', '[2,5]')$$), 'INVALID_INPUT', 'denominations include 1');
select is(tests.err(:'teacher', $$select set_setting('denominations', '[1,1]')$$), 'INVALID_INPUT', 'no repeated denominations');
select is(tests.call(:'teacher', $$select set_setting('withdraw_single_limit', '{"primary":200,"junior":300}')$$) -> 'value',
  '{"primary":200,"junior":300}', 'single limit per division');
select is(tests.err(:'teacher', $$select set_setting('withdraw_single_limit', '300')$$), 'INVALID_INPUT', 'limits are set per division');
select is(tests.err(:'teacher', $$select set_setting('withdraw_daily_limit', '{"primary":500}')$$), 'INVALID_INPUT', 'both divisions are required');
select is(tests.err(:'teacher', $$select set_setting('withdraw_daily_limit', '{"primary":500,"junior":-1}')$$), 'INVALID_INPUT', 'limits are positive');
select is(tests.err(:'teacher', $$select set_setting('ranking_anonymous', '"yes"')$$), 'INVALID_INPUT', 'flags are booleans');
select is(tests.err(:'teacher', $$select set_setting('colour', '1')$$), 'INVALID_INPUT', 'unknown key');
select is(tests.err(:'t1', $$select set_setting('ranking_size', '3')$$), 'FORBIDDEN', 'only a teacher changes settings');
select is((select count(*)::int from audit_log where action = 'settings.update' and actor_id = :'teacher'), 4, 'setting changes are audited');

-- Ranking
select tests.student('r1', 900, p_name => '欧阳小明') as r1 \gset
select tests.student('r2', 800, p_name => '陈晨');
select tests.student('r3', 1000, p_name => '初中生', p_division => 'junior');
select tests.call(:'teacher', $$select set_setting('ranking_size', '2')$$);
select is(tests.call(:'r1', $$select deposit_ranking()$$),
  ('{"division":"primary","me":{"rank":1,"balance":900},"top":[{"me":true,"name":"欧**明","rank":1,"cohort":' || :p4 || ',"balance":900,"class_label":"四年级(4)班"},
    {"me":false,"name":"陈*","rank":2,"cohort":' || :p4 || ',"balance":800,"class_label":"四年级(4)班"}]}')::jsonb, 'top N of the caller''s division, masked names, own place');
select is(tests.call(:'teacher', $$select deposit_ranking('junior')$$) -> 'top' -> 0 ->> 'balance', '1000', 'junior students rank separately');
select tests.call(:'teacher', $$select set_setting('ranking_anonymous', 'false')$$);
select is(tests.call(:'r1', $$select deposit_ranking()$$) -> 'top' -> 1 ->> 'name', '陈晨', 'full names when not anonymous');
select is(tests.call(:'t1', $$select deposit_ranking()$$) -> 'me', 'null', 'staff without an account have no place');

-- create-admin
select ok(app_private.create_admin('Head') is not null, 'create_admin');
select ok((select must_change_password from profiles where login_id = 'head'), 'the admin starts on the default password');
select is((select array_agg(role order by role)::text from user_roles r join profiles p on p.id = r.user_id where p.login_id = 'head'),
  '{teacher,sysadmin}', 'with teacher and sysadmin');
select throws_ok($$select app_private.create_admin('head')$$, 'P0001', 'ALREADY_EXISTS', 'create_admin refuses an existing login');
select throws_ok($$select app_private.create_admin('a b')$$, 'P0001', 'INVALID_INPUT', 'create_admin checks the login id');

select is((select count(*)::int from app_private.check_balances()), 0, 'balances and stock match the ledger');

select * from finish();
rollback;
