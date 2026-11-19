-- Roster import, staff logins, passwords, products, issues, settings, ranking (PHASE-1.md §6.4, §6.5).
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('t1', 'teller') as t1 \gset

-- Roster import
select is(tests.err(:'ops', $$select import_roster('[]')$$), 'FORBIDDEN', 'only a teacher imports the roster');
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
select ok((select bool_and(a ->> 'password' ~ '^[0-9]{8}$') and count(distinct a ->> 'password') = 3
  from jsonb_array_elements(:'roster'::jsonb -> 'accounts') a), 'each new student gets their own random 8-digit password');
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
select tests.call(:'ops', $$select create_staff('Teller02', '柜员二', 'teller')$$) as staff \gset
select matches(:'staff'::jsonb ->> 'password', '^[0-9]{8}$', 'staff logins get 8 random digits, as students do');
select ok((select encrypted_password = crypt(:'staff'::jsonb ->> 'password', encrypted_password) and p.must_change_password
  from auth.users u join profiles p using (id) where p.login_id = 'teller02'), 'which the login uses until it sets its own');
select is(:'staff'::jsonb ->> 'login_id', 'teller02', 'login ids are lower case');
select is(:'staff'::jsonb ->> 'role', 'teller', 'a staff login has one role');
select is(tests.err(:'ops', $$select create_staff('teller02', '重复', 'teller')$$), 'ALREADY_EXISTS', 'duplicate login');
select is(tests.err(:'ops', $$select create_staff('a b', '空格', 'teller')$$), 'INVALID_INPUT', 'invalid login id');
select is(tests.err(:'ops', $$select create_staff('x2', '无角色', null)$$), 'INVALID_INPUT', 'a staff login needs a role');
select is(tests.err(:'ops', $$select create_staff('teacher2', '老师二', 'teacher')$$), 'FORBIDDEN', 'a sysadmin cannot create a teacher');
select is(tests.err(:'keeper', $$select create_staff('x1', 'x', 'teller')$$), 'FORBIDDEN', 'a storekeeper cannot create logins');
select is(tests.err(:'teacher', $$select create_staff('teacher2', '老师二', 'teacher')$$), 'ONE_BANK_ADMIN', 'nor can the teacher: there is one');

select is(tests.err(:'ops', format($$select set_role(%L, 'teacher')$$, :'t1')), 'FORBIDDEN', 'a sysadmin cannot make a teacher');
select is(tests.err(:'ops', format($$select set_role(%L, 'teller')$$, :'teacher')), 'FORBIDDEN', 'nor change one');
select is(tests.err(:'teacher', format($$select set_role(%L, 'teacher')$$, :'t1')), 'ONE_BANK_ADMIN', 'nor does the teacher make a second one');
select is(tests.err(:'teacher', format($$select set_role(%L, 'teller')$$, :'teacher')), 'ONE_BANK_ADMIN', 'or give up the role');
select throws_ok(format($$update user_roles set role = 'teacher' where user_id = %L$$, :'t1'), '23505', null,
  'one teacher, also for direct writes');
select is(tests.call(:'ops', format($$select set_role(%L, 'accountant')$$, :'t1')) ->> 'role', 'accountant', 'the role is replaced');
select is((select array_agg(role)::text from user_roles where user_id = :'t1'), '{accountant}', 'and stays the only one');
select is(tests.err(:'ops', $$select set_role(id, 'teller') from profiles where login_id = '20260002'$$), 'INVALID_INPUT',
  'a student login cannot take a staff role');
select is(tests.err(:'ops', format($$select set_role(%L, 'teller')$$, gen_random_uuid())), 'USER_NOT_FOUND', 'unknown user');
select throws_ok(format($$insert into user_roles values (%L, 'teller')$$, :'t1'), '23505', null, 'one role per login, also for direct writes');
select throws_ok($$insert into user_roles select id, 'teller' from profiles where login_id = '20260002'$$, 'P0001', 'INVALID_INPUT',
  'student logins hold no role, also for direct writes');

-- Passwords
select id as stu from profiles where login_id = '20260002' \gset
insert into auth.sessions (id, user_id) values (gen_random_uuid(), :'stu');
select tests.call(:'ops', format($$select reset_password(%L)$$, :'stu')) as reset \gset
select is(:'reset'::jsonb - 'password', jsonb_build_object('user_id', :'stu', 'login_id', '20260002'), 'reset returns the login');
select matches(:'reset'::jsonb ->> 'password', '^[0-9]{8}$', 'and a new random 8-digit password');
select ok((select encrypted_password = crypt(:'reset'::jsonb ->> 'password', encrypted_password) from auth.users where id = :'stu'),
  'the login now uses it');
select ok((select must_change_password from profiles where id = :'stu'), 'and must change it at the next sign-in');
select is((select count(*)::int from auth.sessions where user_id = :'stu'), 0, 'existing sessions are ended');
select is((select count(*)::int from audit_log where action = 'user.reset_password' and target = 'profiles:' || :'stu'), 1, 'resets are audited');
select is(tests.err(:'ops', format($$select reset_password(%L)$$, :'teacher')), 'FORBIDDEN', 'a sysadmin cannot reset a teacher''s password');
update auth.users set encrypted_password = crypt('my-own-pass', gen_salt('bf', 4)) where id = :'stu';
select ok(not (select must_change_password from profiles where id = :'stu'), 'setting their own password clears must_change_password');
select throws_ok(format($$update auth.users set encrypted_password = crypt('another-pass', gen_salt('bf', 4)) where id = %L$$, :'stu'),
  '42501', 'PASSWORD_CHANGE_FORBIDDEN', 'after that the user cannot change it again');
select tests.call(:'ops', format($$select reset_password(%L)$$, :'stu'));
select ok((select must_change_password from profiles where id = :'stu'), 'after an admin reset the user sets a password once more');
update auth.users set encrypted_password = crypt('my-new-pass', gen_salt('bf', 4)) where id = :'stu';
select ok(not (select must_change_password from profiles where id = :'stu'), 'which the user replaces once more');

-- Reprinting notices: new passwords only for students still on their initial one
select id as s3 from profiles where login_id = '20260003' \gset
select id as s4 from profiles where login_id = '20260004' \gset
update profiles set must_change_password = false where id = :'s4';
insert into auth.sessions (id, user_id) values (gen_random_uuid(), :'s3');
insert into app_private.login_attempts (user_id, locked_until) values (:'s3', now() + interval '10 minutes');
select is(tests.err(:'keeper', $$select reissue_passwords('{20260003}')$$), 'FORBIDDEN', 'only a teacher or sysadmin reissues passwords');
select encrypted_password as s4hash from auth.users where id = :'s4' \gset
select tests.call(:'ops', $$select reissue_passwords('{20260004,20260003,nobody}')$$) as reissue \gset
select is((:'reissue'::jsonb -> 'accounts' -> 0) - 'password', jsonb_build_object('student_no', '20260003', 'name', '王五', 'division', 'junior',
  'cohort', :j7, 'class_no', 1, 'class_label', '七年级(1)班'), 'the notice fields of import_roster');
select is(jsonb_array_length(:'reissue'::jsonb -> 'accounts'), 1, 'students who set their own password, and unknown ones, are skipped');
select ok((select encrypted_password = crypt(:'reissue'::jsonb -> 'accounts' -> 0 ->> 'password', encrypted_password) from auth.users where id = :'s3'),
  'the reissued password is the login''s password');
select is((select encrypted_password from auth.users where id = :'s4'), :'s4hash', 'a skipped student keeps their password');
select is((select count(*)::int from auth.sessions where user_id = :'s3'), 0, 'sessions are ended');
select is((select count(*)::int from app_private.login_attempts where user_id = :'s3'), 0, 'and a sign-in lock is cleared');
select is((select after from audit_log where action = 'user.reissue_passwords' and actor_id = :'ops'), '{"student_nos":["20260003"]}',
  'one audit entry names the students');

-- Until the default is replaced the login holds no role and sees no account data
select tests.staff('fresh', 'teller') as fresh \gset
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
select is(tests.call(:'keeper', $$select upsert_product(null, '书签', 5)$$) ->> 'detail', '{"field": "listed"}', 'listed must be given');
select tests.call(:'keeper', $$select upsert_product(null, '书签', 5, p_listed => false)$$) ->> 'id' as prod \gset
select is(tests.call(:'keeper', format($$select upsert_product(%L, '海豚书签', 6, 3, '文具', 'p/1.jpg', true)$$, :'prod')) - 'id' - 'updated_at',
  '{"cost":3,"name":"海豚书签","price":6,"stock":0,"listed":true,"category":"文具","image_path":"p/1.jpg","safety_stock":5,"low":true}', 'edit product; a new product has a safety stock of 5');
select is(tests.call(:'keeper', format($$select upsert_product(%L, '海豚书签', 6, 3, '文具', 'p/1.jpg', true, 3)$$, :'prod')) ->> 'safety_stock', '3', 'set the safety stock');
select is(tests.call(:'keeper', format($$select upsert_product(%L, '海豚书签', 6, 3, '文具', 'p/1.jpg', true)$$, :'prod')) ->> 'safety_stock', '3',
  'an edit without it keeps the safety stock');
select is(tests.err(:'keeper', format($$select upsert_product(%L, '海豚书签', 6, p_listed => true, p_safety_stock => -1)$$, :'prod')), 'INVALID_INPUT',
  'the safety stock is 0 or more');
select is(tests.err(:'t1', $$select upsert_product(null, 'x', 5)$$), 'FORBIDDEN', 'only storekeepers and teachers edit products');
select is(tests.err(:'keeper', $$select upsert_product(null, 'x', 0)$$), 'INVALID_INPUT', 'price must be positive');
select is(tests.err(:'keeper', $$select upsert_product(gen_random_uuid(), 'x', 5, p_listed => true)$$), 'PRODUCT_NOT_FOUND', 'unknown product');
select is(tests.err(:'keeper', format($$select stock_in(%L, 0)$$, :'prod')), 'INVALID_INPUT', 'stock in must be positive');
select is(tests.call(:'keeper', format($$select stock_in(%L, 7, '首批')$$, :'prod')) ->> 'stock', '7', 'stock in');
select is((select low from products where id = :'prod'), false, 'above the safety stock the product is no longer low');
select is((select count(*)::int from audit_log where target = 'products:' || :'prod'), 3, 'product edits are audited, stock changes are not');

-- 出入库 in one call: several products, all or nothing; 出库 needs a reason and never goes below 0.
select tests.call(:'keeper', $$select upsert_product(null, '贴纸', 2, p_listed => false)$$) ->> 'id' as prod2 \gset
select is(tests.call(:'keeper', format($$select stock_move('stock_in', '[{"product_id":"%s","qty":3},{"product_id":"%s","qty":2},{"product_id":"%s","qty":10}]')$$,
  :'prod', :'prod', :'prod2')), '{"qty": 15, "count": 2}', 'stock in several products, one product in two lines merged');
select is((select stock from products where id = :'prod'), 12, 'stock after stock in');
select is(tests.err(:'keeper', format($$select stock_move('stock_out', '[{"product_id":"%s","qty":1}]')$$, :'prod')), 'INVALID_INPUT', 'stock out needs a reason');
select is(tests.err(:'keeper', format($$select stock_move('stock_out', '[{"product_id":"%s","qty":1},{"product_id":"%s","qty":11}]', '损坏')$$, :'prod', :'prod2')),
  'OUT_OF_STOCK', 'stock out beyond stock is refused');
select is((select stock from products where id = :'prod'), 12, 'a refused stock out changes nothing');
select is(tests.call(:'keeper', format($$select stock_move('stock_out', '[{"product_id":"%s","qty":2}]', '损坏')$$, :'prod')) ->> 'qty', '2', 'stock out');
select is((select row(kind, qty_delta, note)::text from stock_movements where product_id = :'prod' order by id desc limit 1), '(stock_out,-2,损坏)', 'stock out recorded');
select is(tests.err(:'t1', format($$select stock_move('stock_in', '[{"product_id":"%s","qty":1}]')$$, :'prod')), 'FORBIDDEN', 'only storekeepers and teachers move stock');
select is(tests.err(:'keeper', format($$select stock_move('sale', '[{"product_id":"%s","qty":1}]')$$, :'prod')), 'INVALID_INPUT', 'only stock in and stock out');
select is(tests.err(:'keeper', $$select stock_move('stock_in', '[]')$$), 'INVALID_INPUT', 'at least one product');

select is(tests.call(:'teacher', $$select record_currency(gen_random_uuid(), 'issue', '{"1":500,"10":100}', '2026-09-01', '开学发行', '2026-01', '王老师')$$) ->> 'total', '1500',
  'issue total is computed from the denominations');
select is(tests.err(:'teacher', $$select record_currency(gen_random_uuid(), 'issue', '{"1":1}', '2026-09-01', '重复', '2026-01', '王老师')$$), 'ALREADY_EXISTS', 'duplicate batch');
select is(tests.err(:'teacher', $$select record_currency(gen_random_uuid(), 'issue', '{"3":1}', '2026-09-01', '面额错误', '2026-02', '王老师')$$), 'INVALID_AMOUNT', 'unknown denomination');
select is(tests.err(:'keeper', $$select record_currency(gen_random_uuid(), 'issue', '{"1":1}', '2026-09-01', 'x', '2026-03', 'x')$$), 'FORBIDDEN', 'only a teacher registers issues');

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
select is(tests.err(:'teacher', $$select set_settings('{"ranking_size": 20, "promotion_date": "13-01"}')$$), 'INVALID_INPUT',
  'set_settings refuses a set with one bad value');
select isnt((select value from settings where key = 'ranking_size'), '20', 'and saves none of it');
select is(tests.call(:'teacher', $$select set_settings('{"ranking_size": 20, "promotion_date": "09-01"}')$$),
  '{"ranking_size": 20, "promotion_date": "09-01"}', 'set_settings saves them together');
select is(tests.err(:'t1', $$select set_settings('{"ranking_size": 3}')$$), 'FORBIDDEN', 'only a teacher');

-- Ranking
select tests.student('r1', 900, p_name => '欧阳小明') as r1 \gset
select tests.student('r2', 800, p_name => '陈晨');
select tests.student('r3', 1000, p_name => '初中生', p_division => 'junior');
select tests.call(:'teacher', $$select set_setting('ranking_size', '2')$$);
select is(tests.call(:'r1', $$select deposit_ranking()$$) #- '{me,near}',
  ('{"division":"primary","total":5,"anonymous":true,"me":{"rank":1,"balance":900,"above":null,"behind":4},"top":[{"me":true,"name":"欧**明","rank":1,"cohort":' || :p4 || ',"balance":900,"class_label":"四年级(4)班"},
    {"me":false,"name":"陈*","rank":2,"cohort":' || :p4 || ',"balance":800,"class_label":"四年级(4)班"}]}')::jsonb, 'top N of the caller''s division, masked names, own place');
select is(tests.call(:'r1', $$select deposit_ranking('junior')$$) -> 'top' -> 0 ->> 'balance', '1000', 'junior students rank separately');
select tests.student('r4', 800, p_name => '同分') as r4 \gset
select is((tests.call(:'r4', $$select deposit_ranking()$$) -> 'me') - 'near', '{"rank":2,"balance":800,"above":{"rank":1,"balance":900},"behind":3}'::jsonb,
  'the place just above: a tie shares the place, so above is the nearest higher balance, and three have less');
select is(tests.call(:'r4', $$select deposit_ranking()$$) ->> 'total', '6', 'and how many rank in the division');
select is(jsonb_path_query_array(tests.call(:'r4', $$select deposit_ranking()$$), '$.me.near[*].name'), '["陈*", "同*", "张*明"]',
  'the caller with the students right before and after');
select tests.call(:'teacher', $$select set_setting('ranking_anonymous', 'false')$$);
select is(tests.call(:'r1', $$select deposit_ranking()$$) -> 'top' -> 1 ->> 'name', '陈晨', 'full names when not anonymous');
select is(tests.err(:'t1', $$select deposit_ranking()$$), 'FORBIDDEN', 'the ranking is the students''');

-- create-admin and reset-admin
select throws_ok($$select app_private.create_admin('head')$$, 'P0001', 'ONE_BANK_ADMIN', 'create_admin refuses a second teacher');
select set_config('dolphin.password_reset', 'on', false);
update auth.users set encrypted_password = crypt('Forgot-it-1', gen_salt('bf', 4)), banned_until = now() + interval '1 day'
where id = :'teacher';
select set_config('dolphin.password_reset', '', false);
update profiles set must_change_password = false where id = :'teacher';
select app_private.reset_admin() as radmin \gset
select is(:'radmin'::jsonb ->> 'login_id', 'teacher', 'reset_admin resets the teacher');
select ok((select encrypted_password = crypt(:'radmin'::jsonb ->> 'password', encrypted_password) and banned_until is null
  from auth.users where id = :'teacher'), 'on the returned random password and able to sign in');
select ok((select must_change_password from profiles where id = :'teacher'), 'and must change it at the next sign-in');
delete from user_roles where role = 'teacher';
select app_private.create_admin('Head') as cadmin \gset
select is(:'cadmin'::jsonb - 'user_id' - 'password', '{"login_id":"head"}', 'create_admin');
select ok((select encrypted_password = crypt(:'cadmin'::jsonb ->> 'password', encrypted_password) and p.must_change_password
  from auth.users u join profiles p using (id) where p.id = (:'cadmin'::jsonb ->> 'user_id')::uuid),
  'the admin starts on the returned random password and must replace it');
select ok(not has_function_privilege('authenticated', 'app_private.create_admin(text)', 'execute')
  and not has_function_privilege('authenticated', 'app_private.reset_admin()', 'execute'), 'only the CLI creates and resets the admin');
select is((select array_agg(role order by role)::text from user_roles r join profiles p on p.id = r.user_id where p.login_id = 'head'),
  '{teacher}', 'as a teacher');
select throws_ok($$select app_private.create_admin('head')$$, 'P0001', 'ALREADY_EXISTS', 'create_admin refuses an existing login');
select throws_ok($$select app_private.create_admin('a b')$$, 'P0001', 'INVALID_INPUT', 'create_admin checks the login id');

select is((select count(*)::int from app_private.check_balances()), 0, 'balances and stock match the ledger');

select * from finish();
rollback;
