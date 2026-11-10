-- 登录的设备与 IP (PHASE-1.md §5.5): note_login fills in the caller's own latest sign-in, once.
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.student('s1') as s1 \gset

create function tests.login_row(p_user uuid) returns text language sql as $$
  select row(ip, device_id, user_agent)::text from audit_log where actor_id = p_user and action = 'login.ok' order by id desc limit 1
$$;

select ok(has_function_privilege('authenticated', 'public.note_login()', 'execute'), 'a signed-in user calls it');
select ok(not has_function_privilege('anon', 'public.note_login()', 'execute'), 'a visitor does not');

select is(public.hook_password_verification_attempt(jsonb_build_object('user_id', :'s1', 'valid', true)) ->> 'decision', 'continue', 's1 signs in');
select public.hook_password_verification_attempt(jsonb_build_object('user_id', :'t1', 'valid', true));
select public.hook_password_verification_attempt(jsonb_build_object('user_id', :'s1', 'valid', false));
select is(tests.login_row(:'s1'), '(,,)', 'the hook knows no device');

select set_config('request.headers', '{"x-device-id":"pad-1","x-forwarded-for":"10.0.0.8, 172.18.0.1","user-agent":"Safari"}', false);
select is(tests.call(:'s1', $$select note_login()$$), '{"noted": true}', 's1 notes the sign-in');
select is(tests.login_row(:'s1'), '(10.0.0.8,pad-1,Safari)', 'the caller''s sign-in gets the device, the client IP and the User-Agent');
select is(tests.login_row(:'t1'), '(,,)', 'nobody else''s');
select is((select row(ip, device_id)::text from audit_log where actor_id = :'s1' and action = 'login.failed'), '(,)',
  'a failed sign-in stays as it is');

select set_config('request.headers', '{"x-device-id":"pad-2","x-forwarded-for":"10.0.0.9"}', false);
select is(tests.call(:'s1', $$select note_login()$$), '{"noted": false}', 'calling again does no harm');
select is(tests.login_row(:'s1'), '(10.0.0.8,pad-1,Safari)', 'and changes nothing');

-- A sign-in older than 5 minutes is left alone.
insert into audit_log (actor_id, action, target, at) values (:'t1', 'login.ok', 'profiles:' || :'t1', now() - interval '6 minutes');
delete from audit_log where actor_id = :'t1' and action = 'login.ok' and at = now();
select is(tests.call(:'t1', $$select note_login()$$), '{"noted": false}', 'an old sign-in is not filled in');
select is(tests.login_row(:'t1'), '(,,)', 'and stays without a device');

select * from finish();
rollback;
