-- Roster import, staff logins, passwords, products, issues, settings, ranking (PHASE-1.md §6.4, §6.5).
\ir helpers/setup.psql

select tests.staff('teacher', '{teacher}') as teacher \gset
select tests.staff('admin', '{sysadmin}') as admin \gset
select tests.staff('keeper', '{storekeeper}') as keeper \gset
select tests.staff('t1', '{teller}') as t1 \gset

-- Roster import
select is(tests.err(:'admin', $$select import_roster('[]')$$), 'FORBIDDEN', 'only a teacher imports the roster');
select tests.call(:'teacher', $$select import_roster('[
  {"student_no":"20260001","name":"张小明","grade":"四年级","class_name":"4班","cohort":"2023","opening_balance":30},
  {"student_no":"20260002","name":"李四","grade":"四年级","class_name":"4班"},
  {"student_no":"20260003","name":"王五","grade":"五年级","class_name":"1班","opening_balance":0}]')$$) as roster \gset
select is((:'roster'::jsonb - 'accounts'), '{"created":3,"updated":0}', 'three new accounts');
select ok((select bool_and(a ->> 'password' ~ '^[0-9]{6}$') from jsonb_array_elements(:'roster'::jsonb -> 'accounts') a),
  'initial passwords are 6 digits');
select ok((select bool_and(u.encrypted_password = crypt(a ->> 'password', u.encrypted_password))
  from jsonb_array_elements(:'roster'::jsonb -> 'accounts') a
  join auth.users u on u.email = (a ->> 'student_no') || '@student.dolphin.internal'), 'each password is the login''s password');
select is((select count(*)::int from auth.identities i join profiles p on p.id = i.user_id where p.login_id like '2026000_'), 3,
  'each login has an email identity');
select is((select array_agg(balance order by student_no) from accounts where student_no like '2026000_'), '{30,0,0}', 'opening balances');
select is((select count(*)::int from txns where type = 'opening' and student_no like '2026000_'), 1, 'one opening transaction for the non-zero balance');
select ok((select bool_and(must_change_password) from profiles where login_id like '2026000_'), 'students must change the initial password');

select is(tests.call(:'teacher', $$select import_roster('[
  {"student_no":"20260001","name":"张晓明","grade":"五年级","class_name":"4班","opening_balance":99},
  {"student_no":"20260004","name":"赵六","grade":"四年级","class_name":"4班"},
  {"student_no":"20260004","name":"赵六","grade":"四年级","class_name":"4班"}]')$$) - 'accounts', '{"created":1,"updated":2}',
  'existing and repeated student numbers are updated, not opened again');
select is((select row(s.name, s.grade, p.display_name, a.balance)::text from students s join profiles p on p.id = s.user_id
  join accounts a using (student_no) where student_no = '20260001'), '(张晓明,五年级,张晓明,30)', 'name and class updated, balance kept');
select is((select count(*)::int from txns where type = 'opening' and student_no = '20260001'), 1, 'no second opening transaction');
select is(tests.call(:'teacher', $$select import_roster('[{"student_no":"20260009","name":"甲","grade":"四年级","class_name":"4班"},
  {"student_no":"20260010","grade":"四年级","class_name":"4班"}]')$$) ->> 'detail', '{"row": 2}', 'a bad row is reported by number');
select is((select count(*)::int from students where student_no = '20260009'), 0, 'and nothing of the batch is imported');
select is(tests.err(:'teacher', $$select import_roster('[{"student_no":"20260011","name":"乙","grade":"四年级","class_name":"4班","opening_balance":-1}]')$$),
  'INVALID_INPUT', 'negative opening balance');

-- Staff logins and roles
select tests.call(:'admin', $$select create_staff('Teller02', '柜员二', '{teller}')$$) as staff \gset
select matches(:'staff'::jsonb ->> 'password', '^[a-z0-9]{8}$', 'staff password has 8 characters');
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
select matches(:'pw'::text, '^[0-9]{6}$', 'a reset student password has 6 digits');
select ok((select encrypted_password = crypt(:'pw', encrypted_password) from auth.users where id = :'stu'), 'the new password works');
select ok((select must_change_password from profiles where id = :'stu'), 'and must be changed');
select is((select count(*)::int from auth.sessions where user_id = :'stu'), 0, 'existing sessions are ended');
select is(tests.err(:'admin', format($$select reset_password(%L)$$, :'teacher')), 'FORBIDDEN', 'a sysadmin cannot reset a teacher''s password');
update auth.users set encrypted_password = crypt('my-own-pass', gen_salt('bf', 4)) where id = :'stu';
select ok(not (select must_change_password from profiles where id = :'stu'), 'changing the password clears must_change_password');

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
select is(tests.call(:'teacher', $$select set_setting('withdraw_single_limit', '300')$$) -> 'value', '300', 'single limit');
select is(tests.err(:'teacher', $$select set_setting('withdraw_daily_limit', '-1')$$), 'INVALID_INPUT', 'limits are positive');
select is(tests.err(:'teacher', $$select set_setting('ranking_anonymous', '"yes"')$$), 'INVALID_INPUT', 'flags are booleans');
select is(tests.err(:'teacher', $$select set_setting('colour', '1')$$), 'INVALID_INPUT', 'unknown key');
select is(tests.err(:'t1', $$select set_setting('ranking_size', '3')$$), 'FORBIDDEN', 'only a teacher changes settings');
select is((select count(*)::int from audit_log where action = 'settings.update' and actor_id = :'teacher'), 2, 'setting changes are audited');

-- Ranking
select tests.student('r1', 900, p_name => '欧阳小明') as r1 \gset
select tests.student('r2', 800, p_name => '陈晨');
select tests.call(:'teacher', $$select set_setting('ranking_size', '2')$$);
select is(tests.call(:'r1', $$select deposit_ranking()$$),
  '{"me":{"rank":1,"balance":900},"top":[{"me":true,"name":"欧**明","rank":1,"grade":"四年级","balance":900,"class_name":"4班"},
    {"me":false,"name":"陈*","rank":2,"grade":"四年级","balance":800,"class_name":"4班"}]}', 'top N with masked names and own place');
select tests.call(:'teacher', $$select set_setting('ranking_anonymous', 'false')$$);
select is(tests.call(:'r1', $$select deposit_ranking()$$) -> 'top' -> 1 ->> 'name', '陈晨', 'full names when not anonymous');
select is(tests.call(:'t1', $$select deposit_ranking()$$) -> 'me', 'null', 'staff without an account have no place');

-- create-admin
select ok(app_private.create_admin('Head', 'long-enough') is not null, 'create_admin');
select is((select array_agg(role order by role)::text from user_roles r join profiles p on p.id = r.user_id where p.login_id = 'head'),
  '{teacher,sysadmin}', 'with teacher and sysadmin');
select throws_ok($$select app_private.create_admin('head', 'long-enough')$$, 'P0001', 'ALREADY_EXISTS', 'create_admin refuses an existing login');
select throws_ok($$select app_private.create_admin('head2', 'short')$$, 'P0001', 'INVALID_INPUT', 'create_admin needs 8 characters');

select is((select count(*)::int from app_private.check_balances()), 0, 'balances and stock match the ledger');

select * from finish();
rollback;
