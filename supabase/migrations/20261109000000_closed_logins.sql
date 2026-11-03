-- 切换账号: which of this device's accounts were closed (注销), so the device forgets them. It is asked while signed in
-- and answers only whether each id given is closed.
create function public.closed_logins(p_ids uuid[]) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from public.profiles where id = any(p_ids) and closed_at is not null
$$;
revoke execute on function public.closed_logins(uuid[]) from public, anon;
grant execute on function public.closed_logins(uuid[]) to authenticated;
