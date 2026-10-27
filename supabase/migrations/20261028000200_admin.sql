-- Management functions, password-change tracking, ranking and product image policies (PHASE-1.md §6.4–§6.7).

create function app_private.random_code(p_length integer, p_alphabet text) returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr(p_alphabet, 1 + get_byte(b, i) % length(p_alphabet), 1), '' order by i)
  from (select public.gen_random_bytes(p_length) as b) x, generate_series(0, p_length - 1) i
$$;

-- Students get 6 digits, staff 8 characters without look-alikes (§6.4, §6.5).
create function app_private.new_password(p_login_kind text) returns text
language sql volatile set search_path = '' as $$
  select case when p_login_kind = 'student' then app_private.random_code(6, '0123456789')
              else app_private.random_code(8, 'abcdefghjkmnpqrstuvwxyz23456789') end
$$;

create function app_private.valid_staff_login(p_login_id text) returns boolean
language sql immutable as $$ select coalesce(p_login_id ~ '^[a-z0-9][a-z0-9_.-]{1,31}$', false) $$;

create function app_private.json_int_between(p_value jsonb, p_min numeric, p_max numeric) returns boolean
language sql immutable as $$
  select case when jsonb_typeof(p_value) = 'number'
              then p_value::numeric = trunc(p_value::numeric) and p_value::numeric between p_min and p_max
              else false end
$$;

-- Sign-outs everywhere: refresh tokens stop working; access tokens expire within an hour.
create function app_private.end_sessions(p_user_id uuid) returns void
language sql security definer set search_path = '' as $$
  delete from auth.refresh_tokens where user_id = p_user_id::text;
  delete from auth.sessions where user_id = p_user_id;
$$;

-- Only a teacher may grant or revoke the teacher role, or manage a teacher's login.
create function app_private.guard_teacher(p_touches_teacher boolean) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_touches_teacher and not app_private.has_role('teacher') then
    perform app_private.fail('FORBIDDEN', '{"roles":["teacher"]}', '42501');
  end if;
end
$$;

create function app_private.is_teacher(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles where user_id = p_user_id and role = 'teacher')
$$;

-- Logins -------------------------------------------------------------------------------------------------

-- A changed password clears must_change_password; reset_password sets it again afterwards.
create function app_private.password_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.profiles set must_change_password = false where id = new.id and must_change_password;
  return null;
end
$$;
create trigger dolphin_password_changed after update of encrypted_password on auth.users for each row
  when (old.encrypted_password is distinct from new.encrypted_password) execute function app_private.password_changed();

-- p_rows: [{student_no, name, grade, class_name, cohort, opening_balance}], at most a batch of about 100 (§6.5).
create function public.import_roster(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '60s' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row jsonb;
  v_index integer := 0;
  v_no text;
  v_name text;
  v_grade text;
  v_class text;
  v_opening integer;
  v_uid uuid;
  v_password text;
  v_created jsonb := '[]';
  v_updated integer := 0;
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    perform app_private.fail('INVALID_INPUT', '{"field":"rows"}');
  end if;
  for v_row in select * from jsonb_array_elements(p_rows) loop
    v_index := v_index + 1;
    v_no := nullif(trim(v_row ->> 'student_no'), '');
    v_name := nullif(trim(v_row ->> 'name'), '');
    v_grade := nullif(trim(v_row ->> 'grade'), '');
    v_class := nullif(trim(v_row ->> 'class_name'), '');
    if coalesce(v_no, '') !~ '^[A-Za-z0-9_-]{1,32}$' or v_name is null or v_grade is null or v_class is null then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index));
    end if;
    if jsonb_typeof(v_row -> 'opening_balance') is distinct from 'null' and v_row ? 'opening_balance'
       and not app_private.json_int_between(v_row -> 'opening_balance', 0, 1000000) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index, 'field', 'opening_balance'));
    end if;
    v_opening := case when jsonb_typeof(v_row -> 'opening_balance') = 'number' then (v_row ->> 'opening_balance')::integer else 0 end;

    if exists (select 1 from public.students where student_no = v_no) then
      update public.students set name = v_name, grade = v_grade, class_name = v_class,
        cohort = nullif(trim(v_row ->> 'cohort'), '')
      where student_no = v_no
        and (name, grade, class_name, cohort) is distinct from (v_name, v_grade, v_class, nullif(trim(v_row ->> 'cohort'), ''));
      update public.profiles set display_name = v_name
      where id = (select user_id from public.students where student_no = v_no) and display_name <> v_name;
      v_updated := v_updated + 1;
      continue;
    end if;

    v_password := app_private.new_password('student');
    v_uid := app_private.create_login(v_no || '@student.dolphin.internal', v_password);
    insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'student', v_no, v_name);
    insert into public.students (student_no, user_id, name, grade, class_name, cohort)
    values (v_no, v_uid, v_name, v_grade, v_class, nullif(trim(v_row ->> 'cohort'), ''));
    insert into public.accounts (student_no, balance, total_in) values (v_no, v_opening, v_opening);
    if v_opening > 0 then
      insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, device_id)
      values (gen_random_uuid(), 'opening', v_no, v_opening, v_opening, v_opening, v_me, app_private.request_header('x-device-id'));
    end if;
    v_created := v_created || jsonb_build_object('student_no', v_no, 'name', v_name, 'grade', v_grade,
      'class_name', v_class, 'password', v_password);
  end loop;
  perform app_private.log('roster.import', null, null,
    jsonb_build_object('created', jsonb_array_length(v_created), 'updated', v_updated));
  return jsonb_build_object('created', jsonb_array_length(v_created), 'updated', v_updated, 'accounts', v_created);
end
$$;

create function public.create_staff(p_login_id text, p_name text, p_roles public.app_role[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_login text := lower(trim(p_login_id));
  v_password text := app_private.new_password('staff');
  v_uid uuid;
begin
  if not app_private.valid_staff_login(v_login) or nullif(trim(p_name), '') is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"login_id"}');
  end if;
  if exists (select 1 from public.profiles where login_kind = 'staff' and login_id = v_login) then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"login_id"}');
  end if;
  perform app_private.guard_teacher('teacher' = any(coalesce(p_roles, '{}')));
  v_uid := app_private.create_login(v_login || '@staff.dolphin.internal', v_password);
  insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'staff', v_login, trim(p_name));
  insert into public.user_roles (user_id, role) select distinct v_uid, r from unnest(p_roles) r;
  return jsonb_build_object('user_id', v_uid, 'login_id', v_login, 'password', v_password);
end
$$;

create function public.set_roles(p_user_id uuid, p_roles public.app_role[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_roles public.app_role[] := coalesce(p_roles, '{}');
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    perform app_private.fail('USER_NOT_FOUND');
  end if;
  perform app_private.guard_teacher(app_private.is_teacher(p_user_id) <> ('teacher' = any(v_roles)));
  delete from public.user_roles where user_id = p_user_id and role <> all(v_roles);
  insert into public.user_roles (user_id, role) select distinct p_user_id, r from unnest(v_roles) r on conflict do nothing;
  return jsonb_build_object('user_id', p_user_id, 'roles', (select coalesce(jsonb_agg(role order by role), '[]')
    from public.user_roles where user_id = p_user_id));
end
$$;

create function public.reset_password(p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
  v_profile public.profiles;
  v_password text;
begin
  select * into v_profile from public.profiles where id = p_user_id;
  if not found then
    perform app_private.fail('USER_NOT_FOUND');
  end if;
  perform app_private.guard_teacher(app_private.is_teacher(p_user_id));
  v_password := app_private.new_password(v_profile.login_kind);
  update auth.users set encrypted_password = public.crypt(v_password, public.gen_salt('bf', 10)), updated_at = now()
  where id = p_user_id;
  update public.profiles set must_change_password = true where id = p_user_id;
  perform app_private.end_sessions(p_user_id);
  perform app_private.log('user.reset_password', 'profiles:' || p_user_id);
  return jsonb_build_object('user_id', p_user_id, 'login_id', v_profile.login_id, 'password', v_password);
end
$$;

create function public.set_user_disabled(p_user_id uuid, p_disabled boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher', 'sysadmin');
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    perform app_private.fail('USER_NOT_FOUND');
  end if;
  if p_user_id = v_me or p_disabled is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"user_id"}');
  end if;
  perform app_private.guard_teacher(app_private.is_teacher(p_user_id));
  update public.profiles set disabled = p_disabled where id = p_user_id;
  update auth.users set banned_until = case when p_disabled then '9999-12-31'::timestamptz end where id = p_user_id;
  if p_disabled then
    perform app_private.end_sessions(p_user_id);
  end if;
  return jsonb_build_object('user_id', p_user_id, 'disabled', p_disabled);
end
$$;

-- Created by `dolphin create-admin` inside the container: a staff login with teacher and sysadmin.
create function app_private.create_admin(p_login_id text, p_password text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_login text := lower(trim(p_login_id));
  v_uid uuid;
begin
  if not app_private.valid_staff_login(v_login) then
    perform app_private.fail('INVALID_INPUT', '{"field":"login_id"}');
  end if;
  if length(p_password) < 8 then
    perform app_private.fail('INVALID_INPUT', '{"field":"password"}');
  end if;
  if exists (select 1 from public.profiles where login_kind = 'staff' and login_id = v_login) then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"login_id"}');
  end if;
  v_uid := app_private.create_login(v_login || '@staff.dolphin.internal', p_password);
  insert into public.profiles (id, login_kind, login_id, display_name, must_change_password)
  values (v_uid, 'staff', v_login, v_login, false);
  insert into public.user_roles (user_id, role) values (v_uid, 'teacher'), (v_uid, 'sysadmin');
  return v_uid;
end
$$;

-- Products, stock and currency ------------------------------------------------------------------------------

-- p_id null creates a product; stock changes only through stock_in and transactions.
create function public.upsert_product(p_id uuid, p_name text, p_price integer, p_cost integer default null,
  p_category text default null, p_image_path text default null, p_listed boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('storekeeper', 'teacher');
  v_product public.products;
begin
  if nullif(trim(p_name), '') is null or p_price is null or p_price <= 0 or p_cost < 0 then
    perform app_private.fail('INVALID_INPUT', '{"field":"product"}');
  end if;
  if p_id is null then
    insert into public.products (name, price, cost, category, image_path, listed)
    values (trim(p_name), p_price, p_cost, p_category, p_image_path, coalesce(p_listed, false))
    returning * into v_product;
  else
    update public.products set name = trim(p_name), price = p_price, cost = p_cost, category = p_category,
      image_path = p_image_path, listed = coalesce(p_listed, false), updated_at = now()
    where id = p_id returning * into v_product;
    if not found then
      perform app_private.fail('PRODUCT_NOT_FOUND');
    end if;
  end if;
  return to_jsonb(v_product);
end
$$;

create function public.stock_in(p_product_id uuid, p_qty integer, p_note text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('storekeeper', 'teacher');
  v_product public.products;
begin
  if p_qty is null or p_qty <= 0 then
    perform app_private.fail('INVALID_INPUT', '{"field":"qty"}');
  end if;
  update public.products set stock = stock + p_qty, updated_at = now() where id = p_product_id returning * into v_product;
  if not found then
    perform app_private.fail('PRODUCT_NOT_FOUND');
  end if;
  insert into public.stock_movements (product_id, kind, qty_delta, operator_id, note)
  values (p_product_id, 'stock_in', p_qty, v_me, p_note);
  return jsonb_build_object('product_id', p_product_id, 'stock', v_product.stock);
end
$$;

create function public.register_issue(p_batch_no text, p_issued_on date, p_denominations jsonb,
  p_purpose text, p_approver_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_total integer := app_private.cash_total(p_denominations);
  v_issue public.currency_issues;
begin
  if v_total <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  if nullif(trim(p_batch_no), '') is null or p_issued_on is null
     or nullif(trim(p_purpose), '') is null or nullif(trim(p_approver_name), '') is null then
    perform app_private.fail('INVALID_INPUT', '{"field":"issue"}');
  end if;
  if exists (select 1 from public.currency_issues where batch_no = trim(p_batch_no)) then
    perform app_private.fail('ALREADY_EXISTS', '{"field":"batch_no"}');
  end if;
  insert into public.currency_issues (batch_no, issued_on, denominations, total, purpose, approver_name, created_by)
  values (trim(p_batch_no), p_issued_on, p_denominations, v_total, trim(p_purpose), trim(p_approver_name), v_me)
  returning * into v_issue;
  return to_jsonb(v_issue);
end
$$;

-- Settings and ranking --------------------------------------------------------------------------------------

create function public.set_setting(p_key text, p_value jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_value jsonb := p_value;
begin
  if p_key = 'denominations' then
    if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value) not between 1 and 10
       or not p_value @> '[1]' or exists (select 1 from jsonb_array_elements(p_value) e where not app_private.json_int_between(e, 1, 1000))
       or (select count(distinct e) <> count(*) from jsonb_array_elements(p_value) e) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
    v_value := (select jsonb_agg(e order by e::numeric) from jsonb_array_elements(p_value) e);
  elsif p_key in ('withdraw_single_limit', 'withdraw_daily_limit') then
    if not app_private.json_int_between(p_value, 1, 1000000) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'ranking_size' then
    if not app_private.json_int_between(p_value, 1, 100) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  elsif p_key = 'ranking_anonymous' then
    if jsonb_typeof(p_value) is distinct from 'boolean' then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('field', p_key));
    end if;
  else
    perform app_private.fail('INVALID_INPUT', '{"field":"key"}');
  end if;
  update public.settings set value = v_value, updated_by = v_me, updated_at = now() where key = p_key;
  return jsonb_build_object('key', p_key, 'value', v_value);
end
$$;

-- 张小明 → 张*明, 李四 → 李*.
create function app_private.mask_name(p_name text) returns text
language sql immutable as $$
  select case when char_length(p_name) <= 1 then p_name
              when char_length(p_name) = 2 then left(p_name, 1) || '*'
              else left(p_name, 1) || repeat('*', char_length(p_name) - 2) || right(p_name, 1) end
$$;

-- Top N students by balance (names masked when ranking_anonymous) and the caller's own place.
create function public.deposit_ranking() returns jsonb
language sql stable security definer set search_path = '' as $$
  with ranked as (
    select s.student_no, s.name, s.grade, s.class_name, a.balance,
           rank() over (order by a.balance desc) as place,
           row_number() over (order by a.balance desc, s.student_no) as n
    from public.students s join public.accounts a on a.student_no = s.student_no
    where s.status = 'normal'
  )
  select jsonb_build_object(
    'top', (select coalesce(jsonb_agg(jsonb_build_object('rank', place,
              'name', case when app_private.setting('ranking_anonymous') = 'true' then app_private.mask_name(name) else name end,
              'grade', grade, 'class_name', class_name, 'balance', balance,
              'me', student_no is not distinct from app_private.my_student_no()) order by n), '[]')
            from ranked where n <= app_private.setting('ranking_size')::integer),
    'me', (select jsonb_build_object('rank', place, 'balance', balance) from ranked where student_no = app_private.my_student_no()))
$$;

-- Product images: anyone reads the public bucket; storekeepers and teachers upload, replace and delete.
create policy "product-images read" on storage.objects for select to authenticated
  using (bucket_id = 'product-images');
create policy "product-images insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'product-images' and ((select app_private.has_role('storekeeper')) or (select app_private.has_role('teacher'))));
create policy "product-images update" on storage.objects for update to authenticated
  using (bucket_id = 'product-images' and ((select app_private.has_role('storekeeper')) or (select app_private.has_role('teacher'))));
create policy "product-images delete" on storage.objects for delete to authenticated
  using (bucket_id = 'product-images' and ((select app_private.has_role('storekeeper')) or (select app_private.has_role('teacher'))));

grant execute on function public.import_roster(jsonb), public.create_staff(text, text, public.app_role[]),
  public.set_roles(uuid, public.app_role[]), public.reset_password(uuid), public.set_user_disabled(uuid, boolean),
  public.upsert_product(uuid, text, integer, integer, text, text, boolean), public.stock_in(uuid, integer, text),
  public.register_issue(text, date, jsonb, text, text), public.set_setting(text, jsonb), public.deposit_ranking()
  to authenticated;
