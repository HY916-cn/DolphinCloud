-- Logins are created by SQL functions (sign-up is disabled in Auth). app_private is not exposed through PostgREST.
create schema app_private;
revoke all on schema app_private from public;

-- Writes a confirmed email/password login in the shape the pinned Auth version expects; returns the user id.
create function app_private.create_login(p_email text, p_password text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(p_email);
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change_token_current,
    email_change, phone_change_token, reauthentication_token
  ) values (
    '00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    public.crypt(p_password, public.gen_salt('bf', 10)), now(),
    '{"provider":"email","providers":["email"]}', '{}', now(), now(),
    '', '', '', '', '', '', ''
  );
  insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (v_id::text, v_id, jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', now(), now(), now());
  return v_id;
end
$$;

create function public.whoami()
returns json
language sql
stable
as $$
  select json_build_object('user_id', auth.uid(), 'role', auth.role())
$$;
revoke execute on function public.whoami() from public, anon;
grant execute on function public.whoami() to authenticated;

insert into storage.buckets (id, name, public) values ('product-images', 'product-images', true);
