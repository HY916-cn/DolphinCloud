-- The sign-in hook passes an attempt without a user_id on to Auth instead of failing on it.

create or replace function public.hook_password_verification_attempt(event jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (event ->> 'user_id')::uuid;
  v_valid boolean := (event ->> 'valid')::boolean;
  v_locked timestamptz := (select locked_until from app_private.login_attempts where user_id = v_uid);
  v_failures integer;
begin
  -- Auth only asks about a login it found; without one there is nothing to count, and Auth answers by itself.
  if v_uid is null then
    return '{"decision":"continue"}';
  end if;
  if v_locked > now() then
    insert into public.audit_log (actor_id, action, target, after)
    values (v_uid, 'login.locked', 'profiles:' || v_uid, jsonb_build_object('valid', v_valid, 'locked_until', v_locked));
    return '{"decision":"reject","message":"LOGIN_LOCKED"}';
  end if;
  if v_valid then
    delete from app_private.login_attempts where user_id = v_uid;
    insert into public.audit_log (actor_id, action, target) values (v_uid, 'login.ok', 'profiles:' || v_uid);
    return '{"decision":"continue"}';
  end if;

  insert into app_private.login_attempts as a (user_id, failures) values (v_uid, array[now()])
  on conflict (user_id) do update
    set failures = array(select f from unnest(a.failures) f where f > now() - interval '15 minutes') || now()
  returning cardinality(failures) into v_failures;
  if v_failures >= 5 then
    update app_private.login_attempts set failures = '{}', locked_until = now() + interval '15 minutes'
    where user_id = v_uid returning locked_until into v_locked;
  else
    v_locked := null;
  end if;
  insert into public.audit_log (actor_id, action, target, after)
  values (v_uid, 'login.failed', 'profiles:' || v_uid, jsonb_strip_nulls(jsonb_build_object('failures', v_failures, 'locked_until', v_locked)));
  -- The 5th wrong password already answers LOGIN_LOCKED, so the user learns about the lock at once.
  if v_locked is not null then
    return '{"decision":"reject","message":"LOGIN_LOCKED"}';
  end if;
  return '{"decision":"continue"}';
end
$$;
