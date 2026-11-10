-- 登录的设备与 IP (PHASE-1.md §5.5): Auth's sign-in hook has no request headers, so the signed-in client calls note_login
-- right after signing in. It fills in the caller's latest login.ok of the last 5 minutes, once, with the device, IP
-- and User-Agent of the request, stored as app_private.log stores them. `noted` says whether a sign-in was filled in.
create function public.note_login() returns jsonb
language sql security definer set search_path = '' as $$
  with noted as (
    update public.audit_log
    set ip = trim(split_part(app_private.request_header('x-forwarded-for'), ',', 1)),
        device_id = app_private.request_header('x-device-id'),
        user_agent = app_private.request_header('user-agent')
    where id = (select id from public.audit_log where actor_id = auth.uid() and action = 'login.ok' and at > now() - interval '5 minutes'
                order by id desc limit 1)
      and ip is null and device_id is null and user_agent is null
    returning id
  )
  select jsonb_build_object('noted', exists (select 1 from noted))
$$;
revoke all on function public.note_login() from public, anon;
grant execute on function public.note_login() to authenticated;
