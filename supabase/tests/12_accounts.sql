-- Initial passwords and 注销 (PHASE-1.md §6.4, §6.5).
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('acct', 'accountant') as acct \gset
select tests.student('s1', 30, '张小明') as s1 \gset
select tests.student('s2', 0, '李四') as s2 \gset

-- Initial passwords
select is(app_private.new_password('staff') ~ '^\d{8}$', true, 'a staff login starts with 8 digits');
select is(app_private.new_password('student') ~ '^\d{8}$', true, 'and so does a student');
select is(tests.call(:'teacher', format($$select create_staff('t9', '柜员九', 'teller')$$)) ->> 'password' ~ '^\d{8}$', true,
  'create_staff answers an 8-digit password');

-- 注销
select tests.call(:'t1', $$select bind_salary_account(auth.uid(), 's1', '123456')$$);
select tests.call(:'teacher', format($$select set_attendance(%L, true)$$, :'t1'));
select is(tests.err(:'acct', format($$select close_accounts(array[%L]::uuid[])$$, :'s2')), 'FORBIDDEN', 'only the bank admin or the sysadmin closes a login');
select is(tests.err(:'teacher', format($$select close_accounts(array[%L]::uuid[])$$, :'teacher')), 'INVALID_INPUT', 'not their own');
select is(tests.err(:'ops', format($$select close_accounts(array[%L]::uuid[])$$, :'teacher')), 'FORBIDDEN', 'nor the bank admin''s');
select is(tests.call(:'teacher', format($$select close_accounts(array[%L, %L]::uuid[])$$, :'s1', :'s2')),
  '{"closed": 2, "cleared": 30}', 'the bank admin closes two students, clearing 30 HTB');
select is((select row(type, amount, balance_delta, balance_after, cash_delta)::text from txns where student_no = 's1' and type = 'closing'),
  row('closing', 30, -30, 0, 0)::text, 'one 注销清零 transaction takes the balance to 0 and brings no cash');
select is((select count(*)::int from txns where student_no = 's2' and type = 'closing'), 0, 'an empty account needs none');
select is((select array_agg(status order by student_no) from students), '{closed,closed}', 'both accounts are closed');
select is((select count(*)::int from profiles where closed_at is not null and disabled and login_kind = 'student'), 2, 'and their logins stopped for good');
select is((select count(*)::int from auth.users where id in (:'s1', :'s2') and banned_until > now()), 2, 'Auth refuses them');
select is((select row(attendance, account)::text from staff_payroll where user_id = :'t1'), row(false, null)::text,
  'a teller whose 工资账户 was closed is no longer counted');
select is(tests.err(:'t1', $$select lookup_student('s1')$$), 'STUDENT_INACTIVE', 'the counter does not serve a closed account');
select is(tests.err(:'teacher', format($$select set_user_disabled(%L, false)$$, :'s1')), 'ACCOUNT_CLOSED', 'a closed login is not started again');
select is(tests.err(:'teacher', $$select set_student_status('s1', 'normal')$$), 'ACCOUNT_CLOSED', 'nor its account reopened');
select is(tests.err(:'teacher', format($$select close_accounts(array[%L]::uuid[])$$, :'s1')), 'USER_NOT_FOUND', 'a login is closed once');
select is(tests.err(:'teacher', format($$select reverse_txn(gen_random_uuid(), (select id from txns where type = 'closing'), '业务选错')$$)),
  'REVERSAL_NOT_ALLOWED', '注销清零 is not reversed');
select is(tests.call(:'ops', format($$select close_accounts(array[%L]::uuid[])$$, :'acct')) -> 'closed', '1', 'the sysadmin closes a staff login');
select is((select count(*)::int from app_private.check_balances()), 0, 'the ledger self-check still holds');
select is((select count(*)::int from audit_log where action = 'user.close'), 2, 'each 注销 is logged');

-- 切换账号, signed in, learns which of the device's accounts were closed.
select is(tests.call(:'t1', format($$select to_jsonb(array(select x from unnest(closed_logins(array[%L, %L, %L]::uuid[])) x order by x))$$,
  :'s1', :'s2', :'t1')), to_jsonb(array(select x from unnest(array[:'s1', :'s2']::uuid[]) x order by x)), 'closed_logins names the closed ones only');

select * from finish();
rollback;
