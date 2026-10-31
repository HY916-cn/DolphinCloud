-- Audit entries for actions run inside the container (`dolphin backup`, `dolphin restore`), which have no signed-in
-- actor: select app_private.log_system('backup.create', '{"file":"..."}'). Only the postgres superuser calls it.
create function app_private.log_system(p_action text, p_after jsonb default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.audit_log (actor_id, action, after) values (null, p_action, p_after)
$$;
revoke all on function app_private.log_system(text, jsonb) from public;
