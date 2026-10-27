-- 小学部 (primary) and 初中部 (junior) share one bank; the division sets the withdrawal limits and the ranking group.

alter table public.students add column division text not null check (division in ('primary', 'junior'));

update public.settings set value = jsonb_build_object('primary', value, 'junior', value)
where key in ('withdraw_single_limit', 'withdraw_daily_limit');

-- The student's division's value of a withdrawal limit setting ({"primary": n, "junior": n}).
create function app_private.division_limit(p_key text, p_student_no text) returns integer
language sql stable security definer set search_path = '' as $$
  select (app_private.setting(p_key) ->> s.division)::integer from public.students s where s.student_no = p_student_no
$$;

create or replace function public.lookup_student(p_student_no text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_student public.students;
begin
  select * into v_student from public.students where student_no = p_student_no;
  if not found then
    perform app_private.fail('STUDENT_NOT_FOUND');
  end if;
  if v_student.user_id = v_me then
    perform app_private.fail('SELF_SERVICE_FORBIDDEN');
  end if;
  return jsonb_build_object('student_no', v_student.student_no, 'name', v_student.name, 'grade', v_student.grade,
    'class_name', v_student.class_name, 'division', v_student.division, 'status', v_student.status,
    'balance', (select balance from public.accounts where student_no = p_student_no),
    'withdrawn_today', app_private.withdrawn_today(p_student_no));
end
$$;

create or replace function public.withdraw(p_id uuid, p_student_no text, p_amount integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := app_private.require_role('teller');
  v_account public.accounts := app_private.lock_account(p_student_no, v_me);
  v_single integer := app_private.division_limit('withdraw_single_limit', p_student_no);
  v_daily integer := app_private.division_limit('withdraw_daily_limit', p_student_no);
  v_today integer;
  v_txn public.txns;
begin
  select * into v_txn from public.txns where id = p_id;
  if found then
    return app_private.txn_result(v_txn);
  end if;
  if p_amount is null or p_amount <= 0 then
    perform app_private.fail('INVALID_AMOUNT');
  end if;
  if p_amount > v_single then
    perform app_private.fail('WITHDRAW_SINGLE_LIMIT', jsonb_build_object('limit', v_single));
  end if;
  v_today := app_private.withdrawn_today(p_student_no);
  if v_today + p_amount > v_daily then
    perform app_private.fail('WITHDRAW_DAILY_LIMIT',
      jsonb_build_object('limit', v_daily, 'remaining', greatest(v_daily - v_today, 0)));
  end if;
  if p_amount > v_account.balance then
    perform app_private.fail('INSUFFICIENT_BALANCE',
      jsonb_build_object('balance', v_account.balance, 'short', p_amount - v_account.balance));
  end if;
  update public.accounts set balance = balance - p_amount, total_out = total_out + p_amount, updated_at = now()
  where student_no = p_student_no returning * into v_account;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, operator_id, device_id)
  values (p_id, 'withdraw', p_student_no, p_amount, -p_amount, v_account.balance, -p_amount,
    v_me, app_private.request_header('x-device-id'))
  returning * into v_txn;
  return app_private.txn_result(v_txn);
end
$$;

-- p_rows: [{student_no, name, division (primary | junior), grade, class_name, cohort, opening_balance}].
create or replace function public.import_roster(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '60s' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row jsonb;
  v_index integer := 0;
  v_no text;
  v_name text;
  v_division text;
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
    v_division := v_row ->> 'division';
    v_grade := nullif(trim(v_row ->> 'grade'), '');
    v_class := nullif(trim(v_row ->> 'class_name'), '');
    if coalesce(v_no, '') !~ '^[A-Za-z0-9_-]{1,32}$' or v_name is null or coalesce(v_division, '') not in ('primary', 'junior') or v_grade is null or v_class is null then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index));
    end if;
    if jsonb_typeof(v_row -> 'opening_balance') is distinct from 'null' and v_row ? 'opening_balance'
       and not app_private.json_int_between(v_row -> 'opening_balance', 0, 1000000) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index, 'field', 'opening_balance'));
    end if;
    v_opening := case when jsonb_typeof(v_row -> 'opening_balance') = 'number' then (v_row ->> 'opening_balance')::integer else 0 end;

    if exists (select 1 from public.students where student_no = v_no) then
      update public.students set name = v_name, division = v_division, grade = v_grade, class_name = v_class,
        cohort = nullif(trim(v_row ->> 'cohort'), '')
      where student_no = v_no
        and (name, division, grade, class_name, cohort) is distinct from (v_name, v_division, v_grade, v_class, nullif(trim(v_row ->> 'cohort'), ''));
      update public.profiles set display_name = v_name
      where id = (select user_id from public.students where student_no = v_no) and display_name <> v_name;
      v_updated := v_updated + 1;
      continue;
    end if;

    v_password := app_private.new_password('student');
    v_uid := app_private.create_login(v_no || '@student.dolphin.internal', v_password);
    insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'student', v_no, v_name);
    insert into public.students (student_no, user_id, name, division, grade, class_name, cohort)
    values (v_no, v_uid, v_name, v_division, v_grade, v_class, nullif(trim(v_row ->> 'cohort'), ''));
    insert into public.accounts (student_no, balance, total_in) values (v_no, v_opening, v_opening);
    if v_opening > 0 then
      insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, device_id)
      values (gen_random_uuid(), 'opening', v_no, v_opening, v_opening, v_opening, v_me, app_private.request_header('x-device-id'));
    end if;
    v_created := v_created || jsonb_build_object('student_no', v_no, 'name', v_name, 'division', v_division, 'grade', v_grade,
      'class_name', v_class, 'password', v_password);
  end loop;
  perform app_private.log('roster.import', null, null,
    jsonb_build_object('created', jsonb_array_length(v_created), 'updated', v_updated));
  return jsonb_build_object('created', jsonb_array_length(v_created), 'updated', v_updated, 'accounts', v_created);
end
$$;

create or replace function public.set_setting(p_key text, p_value jsonb) returns jsonb
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
    if jsonb_typeof(p_value) is distinct from 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(p_value) k) <> array['junior', 'primary']
       or not app_private.json_int_between(p_value -> 'primary', 1, 1000000)
       or not app_private.json_int_between(p_value -> 'junior', 1, 1000000) then
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

-- Top N of a division by balance; p_division null means the caller's own division.
drop function public.deposit_ranking();
create function public.deposit_ranking(p_division text default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  with division as (
    select coalesce(p_division, (select division from public.students where student_no = app_private.my_student_no())) as d
  ), ranked as (
    select s.student_no, s.name, s.grade, s.class_name, a.balance,
           rank() over (order by a.balance desc) as place,
           row_number() over (order by a.balance desc, s.student_no) as n
    from public.students s join public.accounts a on a.student_no = s.student_no
    where s.status = 'normal' and s.division = (select d from division)
  )
  select jsonb_build_object('division', (select d from division),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('rank', place,
              'name', case when app_private.setting('ranking_anonymous') = 'true' then app_private.mask_name(name) else name end,
              'grade', grade, 'class_name', class_name, 'balance', balance,
              'me', student_no is not distinct from app_private.my_student_no()) order by n), '[]')
            from ranked where n <= app_private.setting('ranking_size')::integer),
    'me', (select jsonb_build_object('rank', place, 'balance', balance) from ranked where student_no = app_private.my_student_no()))
$$;
grant execute on function public.deposit_ranking(text) to authenticated;
