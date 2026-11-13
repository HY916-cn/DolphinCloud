-- 工作人员导入与免密码绑定 (PHASE-2.md §5.1, §5.2).
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('t2', 'teller') as t2 \gset
select tests.staff('acct', 'accountant') as acct \gset
select tests.staff('p1', 'president') as p1 \gset
select tests.staff('gone', 'teller') as gone \gset
select tests.staff('off', 'teller') as off \gset
select tests.student('s1', 0, '张小明') as s1 \gset
select tests.student('s2', 0, '李四') as s2 \gset
select tests.student('s3', 0, '王五') as s3 \gset
select tests.student('s4', 0, '赵六') as s4 \gset
update students set status = 'frozen' where student_no = 's4';
update profiles set disabled = true where id = :'off';
update profiles set disabled = true, closed_at = now() where id = :'gone';

create function tests.import_staff(p_user uuid, p_rows text) returns jsonb language sql as $$
  select tests.call(p_user, format('select import_staff(%L::jsonb)', p_rows))
$$;
create function tests.import_err(p_user uuid, p_rows text) returns text language sql as $$
  select tests.err(p_user, format('select import_staff(%L::jsonb)', p_rows))
$$;

-- 免密码绑定
select is(tests.call(:'teacher', format($$select bind_salary_account(%L, 's1', null)$$, :'t1')) ->> 'name', '张小明', 'the bank admin binds without the password');
select is((select account from staff_payroll where user_id = :'t1'), 's1', 'the binding is stored');
select is((select count(*)::int from audit_log where action = 'salary.bind' and target = 'profiles:' || :'t1' and actor_id = :'teacher' and after ->> 'student_no' = 's1'), 1,
  'and logged with who did it, the teller and the student number');
select is(tests.call(:'teacher', format($$select bind_salary_account(%L, 's1', null)$$, :'t1')) ->> 'account', 's1', 'binding the same account again answers the same');
select is((select count(*)::int from audit_log where action = 'salary.bind'), 1, 'and logs nothing new');
select is(tests.call(:'ops', format($$select bind_salary_account(%L, 's2', null)$$, :'t2')) ->> 'account', 's2', 'the sysadmin too');
select is(tests.err(:'teacher', format($$select bind_salary_account(%L, 's2', null)$$, :'t1')), 'ALREADY_EXISTS', 'one staff login per account');
select is(tests.err(:'teacher', format($$select bind_salary_account(%L, 's4', null)$$, :'t1')), 'STUDENT_INACTIVE', 'only an account in use');
select is(tests.err(:'teacher', format($$select bind_salary_account(%L, 'nobody', null)$$, :'t1')), 'STUDENT_NOT_FOUND', 'that exists');
select is(tests.err(:'p1', format($$select bind_salary_account(%L, 's3', null)$$, :'t1')), 'FORBIDDEN', 'a president does not bind');
select is(tests.err(:'acct', format($$select bind_salary_account(%L, 's3', null)$$, :'t1')), 'FORBIDDEN', 'nor an accountant');
select is(tests.call(:'t1', $$select bind_salary_account(auth.uid(), 's3', null)$$) ->> 'error', 'WRONG_PASSWORD', 'a teller binding their own still needs the password');
select is(tests.call(:'t1', $$select bind_salary_account(auth.uid(), 's3', '123456')$$) ->> 'account', 's3', 'and binds with it');
select tests.call(:'t1', $$select unbind_salary_account(auth.uid())$$);
select tests.call(:'ops', format($$select unbind_salary_account(%L)$$, :'t2'));

-- import_staff
select is(tests.import_err(:'acct', '[]'), 'FORBIDDEN', 'an accountant does not import staff');
select is(tests.import_err(:'p1', '[]'), 'FORBIDDEN', 'nor a president');
select is(tests.import_err(:'t1', '[]'), 'FORBIDDEN', 'nor a teller');

select tests.import_staff(:'teacher', '[
  {"login_id": " Teller7 ", "name": "柜员七", "role": "teller", "account": "s1"},
  {"login_id": "store7", "name": "库管七", "role": "storekeeper", "account": null},
  {"login_id": "t1", "name": "柜员一", "role": "teller", "account": "s2"}
]') as result \gset
select is((:'result'::jsonb) -> 'created', '2', 'two new logins');
select is((:'result'::jsonb) -> 'updated', '1', 'one updated');
select is((:'result'::jsonb) -> 'bound', '2', 'two 工资账户 bound');
select is(jsonb_array_length((:'result'::jsonb) -> 'accounts'), 2, 'only the new logins come back');
select is((:'result'::jsonb) -> 'accounts' -> 0 ->> 'password' ~ '^\d{8}$', true, 'with an 8-digit initial password');
select is((:'result'::jsonb) -> 'accounts' -> 0 ->> 'account_name', '张小明', 'and whose account the pay goes to');
select is((:'result'::jsonb) -> 'accounts' -> 0 ->> 'login_id', 'teller7', 'logins are lower case, trimmed');
select is((select r.role::text from user_roles r join profiles p on p.id = r.user_id where p.login_id = 'store7'), 'storekeeper', 'the role is set');
select is((select must_change_password from profiles where login_id = 'teller7'), true, 'a new password is needed at first sign-in');
select is((select account from staff_payroll s join profiles p on p.id = s.user_id where p.login_id = 'teller7'), 's1', 'the new teller is bound');
select is((select coalesce(attendance, false) from staff_payroll s join profiles p on p.id = s.user_id where p.login_id = 'teller7'), false, '考勤 stays off');
select is((select display_name from profiles where id = :'t1'), '柜员一', 'an existing login gets its new name');
select is((select account from staff_payroll where user_id = :'t1'), 's2', 'and its binding');
select is((select count(*)::int from auth.users where id = :'t1' and encrypted_password = public.crypt('test-password', encrypted_password)), 1, 'but keeps its password');
select is((select count(*)::int from audit_log where action = 'staff.import'), 1, 'the import is logged');

select is(tests.import_staff(:'ops', '[{"login_id": "t1", "name": "柜员一", "role": "teller", "account": null}]') -> 'bound', '0', 'a blank account binds nothing');
select is((select account from staff_payroll where user_id = :'t1'), 's2', 'and leaves the binding');

select is(tests.import_err(:'teacher', '[{"login_id": "x1", "name": "甲", "role": "teacher", "account": null}]'), 'ONE_BANK_ADMIN', 'no bank admin by import');
select is(tests.import_err(:'teacher', '[{"login_id": "x1", "name": "甲", "role": "boss", "account": null}]'), 'INVALID_INPUT', 'no unknown role');
select is(tests.import_err(:'teacher', '[{"login_id": "!", "name": "甲", "role": "teller", "account": null}]'), 'INVALID_INPUT', 'no bad login');
select is(tests.import_err(:'teacher', '[{"login_id": "x1", "name": "", "role": "teller", "account": null}]'), 'INVALID_INPUT', 'no blank name');
select is(tests.import_err(:'teacher', '[{"login_id": "x1", "name": "甲", "role": "sysadmin", "account": "s3"}]'), 'INVALID_INPUT', 'the sysadmin has no 工资账户');
select is(tests.import_err(:'teacher', '[{"login_id": "x1", "name": "甲", "role": "teller", "account": "s4"}]'), 'STUDENT_INACTIVE', 'an account in use');
select is(tests.import_err(:'teacher', '[{"login_id": "x1", "name": "甲", "role": "teller", "account": "s1"}]'), 'ALREADY_EXISTS', 'not bound to someone else');
select is(tests.import_err(:'teacher', '[{"login_id": "x1", "name": "甲", "role": "teller", "account": null}, {"login_id": "X1", "name": "乙", "role": "teller", "account": null}]'), 'ALREADY_EXISTS', 'no login twice');
select is(tests.import_err(:'teacher', '[{"login_id": "acct", "name": "甲", "role": "teller", "account": null}]'), 'INVALID_INPUT', 'an import never changes a role');
select is(tests.import_err(:'teacher', '[{"login_id": "off", "name": "甲", "role": "teller", "account": null}]'), 'ALREADY_EXISTS', 'a stopped login is taken');
select is(tests.import_err(:'teacher', '[{"login_id": "gone", "name": "甲", "role": "teller", "account": null}]'), 'ACCOUNT_CLOSED', 'and a closed one');
select is((tests.import_staff(:'teacher', '[{"login_id": "x1", "name": "甲", "role": "teller", "account": null}, {"login_id": "x2", "name": "乙", "role": "sysadmin", "account": "s3"}]') ->> 'detail')::jsonb -> 'row', '2', 'an error names its row');
select is((select count(*)::int from profiles where login_id = 'x1'), 0, 'and the batch is undone');

select * from finish();
rollback;
