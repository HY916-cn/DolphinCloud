-- Sign-in lockout and sign-in audit through the Auth password verification hook (H-1, M-6).
\ir helpers/setup.psql

select tests.staff('ops', 'sysadmin') as ops \gset
select tests.student('s1') as s1 \gset
select tests.student('s2') as s2 \gset

create function tests.attempt(p_user uuid, p_valid boolean) returns text language sql as $$
  select public.hook_password_verification_attempt(jsonb_build_object('user_id', p_user, 'valid', p_valid)) ->> 'decision'
$$;

select ok(has_function_privilege('supabase_auth_admin', 'public.hook_password_verification_attempt(jsonb)', 'execute'),
  'Auth can call the hook');
select ok(not has_function_privilege('authenticated', 'public.hook_password_verification_attempt(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.hook_password_verification_attempt(jsonb)', 'execute'), 'the API cannot');

select is(tests.attempt(:'s1', true), 'continue', 'a right password signs in');
select is((select row(actor_id, action, target)::text from audit_log order by id desc limit 1), row(:'s1'::uuid, 'login.ok', 'profiles:' || :'s1')::text,
  'and is audited as the user');

select is(array(select tests.attempt(:'s1', false) from generate_series(1, 4)), '{continue,continue,continue,continue}',
  'four wrong passwords go on to Auth''s own invalid_credentials');
select is(tests.attempt(:'s1', true), 'continue', 'a right one still signs in');
select is((select count(*)::int from app_private.login_attempts where user_id = :'s1'), 0, 'and clears the count');

select is(array(select tests.attempt(:'s1', false) from generate_series(1, 4)), '{continue,continue,continue,continue}', 'four again');
select is(public.hook_password_verification_attempt(jsonb_build_object('user_id', :'s1', 'valid', false)),
  '{"decision":"reject","message":"LOGIN_LOCKED"}', 'the fifth wrong password within 15 minutes locks the login');
select is(tests.attempt(:'s1', true), 'reject', 'then even the right password is refused');
select is(tests.attempt(:'s2', true), 'continue', 'other logins are not affected');
select is((select array_agg(action order by id)::text from audit_log where actor_id = :'s1' and action <> 'login.ok'),
  '{login.failed,login.failed,login.failed,login.failed,login.failed,login.failed,login.failed,login.failed,login.failed,login.locked}',
  'every failure and refused attempt is audited');
select is((select after - 'locked_until' from audit_log where actor_id = :'s1' order by id desc limit 1), '{"valid": true}',
  'a refused attempt records whether the password was right');

update app_private.login_attempts set locked_until = now() - interval '1 second' where user_id = :'s1';
select is(tests.attempt(:'s1', true), 'continue', 'after 15 minutes the login works again');

-- Only failures within the last 15 minutes count
insert into app_private.login_attempts (user_id, failures)
values (:'s2', array[now() - interval '16 minutes', now() - interval '16 minutes', now() - interval '16 minutes', now() - interval '1 minute']);
select is(tests.attempt(:'s2', false), 'continue', 'old failures have expired');
select is((select cardinality(failures) from app_private.login_attempts where user_id = :'s2'), 2, 'two recent failures remain');

-- An admin reset unlocks
select is(array(select tests.attempt(:'s2', false) from generate_series(1, 3)), '{continue,continue,reject}', 'locked again');
select tests.call(:'ops', format($$select reset_password(%L)$$, :'s2'));
select is(tests.attempt(:'s2', true), 'continue', 'reset_password clears the lock');

-- Container commands write their own audit entries
select app_private.log_system('backup.create', '{"file":"dolphin-1.tar.gz"}');
select is((select row(actor_id, action, after)::text from audit_log order by id desc limit 1),
  row(null::uuid, 'backup.create', '{"file":"dolphin-1.tar.gz"}'::jsonb)::text, 'log_system writes an entry without an actor');
select ok(not has_function_privilege('authenticated', 'app_private.log_system(text, jsonb)', 'execute'), 'only the superuser calls it');

select * from finish();
rollback;
