-- Students are grouped by division, cohort and class number (PHASE-1.md §5.2).
-- 小学部 (primary) and 初中部 (junior) share one bank; the division sets the withdrawal limits and the ranking group.
-- Only the cohort (year of entry) is stored. The grade follows from it: primary grades 1–6, junior grades 7–9, moving up
-- each year on promotion_date (MM-DD). Classes are numbers and show as 四年级(1)班.

alter table public.students add column division text not null check (division in ('primary', 'junior'));
alter table public.students drop column grade;
alter table public.students alter column cohort type integer using cohort::integer;
alter table public.students alter column cohort set not null;
alter table public.students add check (cohort between 2000 and 2100);
alter table public.students rename column class_name to class_no;
alter table public.students alter column class_no type integer using class_no::integer;
alter table public.students add check (class_no between 1 and 99);

insert into public.settings (key, value) values ('promotion_date', '"09-01"');

update public.settings set value = jsonb_build_object('primary', value, 'junior', value)
where key in ('withdraw_single_limit', 'withdraw_daily_limit');

-- The student's division's value of a withdrawal limit setting ({"primary": n, "junior": n}).
create function app_private.division_limit(p_key text, p_student_no text) returns integer
language sql stable security definer set search_path = '' as $$
  select (app_private.setting(p_key) ->> s.division)::integer from public.students s where s.student_no = p_student_no
$$;

-- Grade number in the school year that contains p_on (each school year starts on promotion_date).
create function app_private.grade_of(p_division text, p_cohort integer, p_on date default app_private.cn_date(now()))
returns integer language sql stable security definer set search_path = '' as $$
  select extract(year from p_on)::integer
         - case when to_char(p_on, 'MM-DD') < app_private.setting('promotion_date') #>> '{}' then 1 else 0 end
         - p_cohort + case when p_division = 'junior' then 7 else 1 end
$$;

-- 四年级(1)班; null when the cohort is outside the division's grades (not yet started or already left).
create function app_private.class_label(p_division text, p_cohort integer, p_class_no integer,
  p_on date default app_private.cn_date(now()))
returns text language sql stable security definer set search_path = '' as $$
  select case when g between 1 and 9 and (g >= 7) = (p_division = 'junior')
              then (array['一','二','三','四','五','六','七','八','九'])[g] || '年级(' || p_class_no || ')班' end
  from (select app_private.grade_of(p_division, p_cohort, p_on) as g) x
$$;

-- Computed fields for table reads: /rest/v1/students?select=*,grade,class_label
create function public.grade(p_student public.students) returns integer
language sql stable as $$ select app_private.grade_of(p_student.division, p_student.cohort) $$;
create function public.class_label(p_student public.students) returns text
language sql stable as $$ select app_private.class_label(p_student.division, p_student.cohort, p_student.class_no) $$;
grant execute on function app_private.grade_of(text, integer, date), app_private.class_label(text, integer, integer, date),
  public.grade(public.students), public.class_label(public.students) to authenticated;

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
  return jsonb_build_object('student_no', v_student.student_no, 'name', v_student.name, 'division', v_student.division,
    'cohort', v_student.cohort, 'class_no', v_student.class_no, 'grade', public.grade(v_student),
    'class_label', public.class_label(v_student), 'status', v_student.status,
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

-- p_rows: [{student_no, name, division (primary | junior), cohort (year of entry), class_no, opening_balance}].
-- The cohort must put the student in a grade of their division today.
create or replace function public.import_roster(p_rows jsonb) returns jsonb
language plpgsql security definer set search_path = '' set statement_timeout = '60s' as $$
declare
  v_me uuid := app_private.require_role('teacher');
  v_row jsonb;
  v_index integer := 0;
  v_no text;
  v_name text;
  v_division text;
  v_cohort integer;
  v_class integer;
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
    if coalesce(v_no, '') !~ '^[A-Za-z0-9_-]{1,32}$' or v_name is null or coalesce(v_division, '') not in ('primary', 'junior')
       or not app_private.json_int_between(v_row -> 'class_no', 1, 99) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index));
    end if;
    if not app_private.json_int_between(v_row -> 'cohort', 2000, 2100)
       or app_private.class_label(v_division, (v_row ->> 'cohort')::integer, 1) is null then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index, 'field', 'cohort'));
    end if;
    v_cohort := (v_row ->> 'cohort')::integer;
    v_class := (v_row ->> 'class_no')::integer;
    if jsonb_typeof(v_row -> 'opening_balance') is distinct from 'null' and v_row ? 'opening_balance'
       and not app_private.json_int_between(v_row -> 'opening_balance', 0, 1000000) then
      perform app_private.fail('INVALID_INPUT', jsonb_build_object('row', v_index, 'field', 'opening_balance'));
    end if;
    v_opening := case when jsonb_typeof(v_row -> 'opening_balance') = 'number' then (v_row ->> 'opening_balance')::integer else 0 end;

    if exists (select 1 from public.students where student_no = v_no) then
      update public.students set name = v_name, division = v_division, cohort = v_cohort, class_no = v_class
      where student_no = v_no and (name, division, cohort, class_no) is distinct from (v_name, v_division, v_cohort, v_class);
      update public.profiles set display_name = v_name
      where id = (select user_id from public.students where student_no = v_no) and display_name <> v_name;
      v_updated := v_updated + 1;
      continue;
    end if;

    v_password := app_private.new_password('student');
    v_uid := app_private.create_login(v_no || '@student.dolphin.internal', v_password);
    insert into public.profiles (id, login_kind, login_id, display_name) values (v_uid, 'student', v_no, v_name);
    insert into public.students (student_no, user_id, name, division, cohort, class_no)
    values (v_no, v_uid, v_name, v_division, v_cohort, v_class);
    insert into public.accounts (student_no, balance, total_in) values (v_no, v_opening, v_opening);
    if v_opening > 0 then
      insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, device_id)
      values (gen_random_uuid(), 'opening', v_no, v_opening, v_opening, v_opening, v_me, app_private.request_header('x-device-id'));
    end if;
    v_created := v_created || jsonb_build_object('student_no', v_no, 'name', v_name, 'division', v_division, 'cohort', v_cohort,
      'class_no', v_class, 'class_label', app_private.class_label(v_division, v_cohort, v_class), 'password', v_password);
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
  elsif p_key = 'promotion_date' then
    if jsonb_typeof(p_value) is distinct from 'string' or p_value #>> '{}' !~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
       or to_char(to_date('2000-' || (p_value #>> '{}'), 'YYYY-MM-DD'), 'MM-DD') <> p_value #>> '{}' then
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
    select s.student_no, s.name, s.cohort, public.class_label(s) as class_label, a.balance,
           rank() over (order by a.balance desc) as place,
           row_number() over (order by a.balance desc, s.student_no) as n
    from public.students s join public.accounts a on a.student_no = s.student_no
    where s.status = 'normal' and s.division = (select d from division)
  )
  select jsonb_build_object('division', (select d from division),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('rank', place,
              'name', case when app_private.setting('ranking_anonymous') = 'true' then app_private.mask_name(name) else name end,
              'class_label', class_label, 'cohort', cohort, 'balance', balance,
              'me', student_no is not distinct from app_private.my_student_no()) order by n), '[]')
            from ranked where n <= app_private.setting('ranking_size')::integer),
    'me', (select jsonb_build_object('rank', place, 'balance', balance) from ranked where student_no = app_private.my_student_no()))
$$;
grant execute on function public.deposit_ranking(text) to authenticated;
