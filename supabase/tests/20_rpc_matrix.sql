-- Role × function matrix (PHASE-1.md §4.2, §6; PHASE-2.md §3): every function PostgREST exposes, called by every identity;
-- and no identity writes a table directly. The calls are built to fail business checks where they would change data,
-- so "passed" means the role check let the caller through.
\ir helpers/setup.psql

select tests.student('s1', 50) as student \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('keeper', 'storekeeper') as storekeeper \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('ops', 'sysadmin') as sysadmin \gset
-- Disabled and closed logins, through the functions the bank admin uses.
select tests.student('s2', 0) as student_disabled \gset
select tests.student('s3', 0) as student_closed \gset
select tests.staff('p2', 'president') as president_disabled \gset
select tests.staff('t2', 'teller') as teller_closed \gset
select is(count(*), 0::bigint, 'two logins disabled') from unnest(array[:'student_disabled', :'president_disabled']::uuid[]) id
  where tests.err(:'teacher', format('select set_user_disabled(%L, true)', id)) is not null;
select is(tests.call(:'teacher', format('select close_accounts(array[%L, %L]::uuid[])', :'student_closed', :'teller_closed')) ->> 'closed', '2',
  'two logins closed');

create table tests.who (name text primary key, id uuid);
insert into tests.who values ('anon', null), ('student', :'student'), ('teller', :'teller'), ('accountant', :'accountant'),
  ('storekeeper', :'storekeeper'), ('president', :'president'), ('teacher', :'teacher'), ('sysadmin', :'sysadmin'),
  ('student_disabled', :'student_disabled'), ('president_disabled', :'president_disabled'),
  ('student_closed', :'student_closed'), ('teller_closed', :'teller_closed');

-- Runs sql as the identity (anon when id is null): 'denied' when the role check or a missing grant stopped it, otherwise
-- 'passed' (it succeeded or failed a business check).
create function tests.verdict(p_id uuid, p_sql text) returns text language plpgsql as $$
declare v_err text;
begin
  if p_id is null then
    begin
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform set_config('role', 'anon', true);
      execute p_sql;
      perform set_config('role', 'none', true);
    exception when others then v_err := sqlerrm;
    end;
  else
    v_err := tests.err(p_id, p_sql);
  end if;
  return case when v_err = 'FORBIDDEN' or v_err like 'permission denied%' or v_err like '%row-level security%' then 'denied' else 'passed' end;
end $$;

-- fn: the exposed signature; allowed: the identities that get through ('*' is any signed-in login, disabled ones too).
create table tests.matrix (fn text primary key, call text not null, allowed text[] not null);
insert into tests.matrix values
  -- Anyone signed in: no data of their own beyond what RLS shows them.
  ('whoami()', 'select whoami()', '{*}'),
  ('closed_logins(uuid[])', 'select closed_logins(''{}'')', '{*}'),
  ('note_login()', 'select note_login()', '{*}'),
  ('grade(students)', 'select count(grade(s)) from students s', '{*}'),
  ('class_label(students)', 'select count(class_label(s)) from students s', '{*}'),
  ('cn_time(txns)', 'select count(cn_time(t)) from txns t', '{*}'),
  -- 学生
  ('deposit_ranking(text)', 'select deposit_ranking()', '{student}'),
  -- 柜员 (§6.2, §6.8, §6.9)
  ('lookup_student(text)', 'select lookup_student(''nobody'')', '{teller}'),
  ('deposit(uuid,text,jsonb,boolean,timestamp with time zone)', 'select deposit(gen_random_uuid(), ''nobody'', ''{"10":1}'')', '{teller}'),
  ('withdraw(uuid,text,integer)', 'select withdraw(gen_random_uuid(), ''nobody'', 1)', '{teller}'),
  ('purchase(uuid,text,jsonb,text,jsonb)', 'select purchase(gen_random_uuid(), ''nobody'', ''[]'', ''account'', null)', '{teller}'),
  ('student_txns(text,bigint,integer,date,date,time without time zone,time without time zone,txn_type[],text)',
    'select student_txns(''nobody'')', '{teller}'),
  ('start_duty(jsonb)', 'select start_duty()', '{teller}'),
  ('duty_txns()', 'select duty_txns()', '{teller}'),
  ('end_duty(integer)', 'select end_duty(-1)', '{teller}'),
  -- 下班总结的现金表: the teller their own duty, the accountant, president and bank admin any (PHASE-2.md §4)
  ('duty_cash(uuid)', 'select duty_cash()', '{teller,accountant,president,teacher}'),
  -- 冲正: the teller their own of today, the president and bank admin any (§6.3)
  ('reverse_txn(uuid,uuid,text)', 'select reverse_txn(gen_random_uuid(), gen_random_uuid(), ''金额录错'')', '{teller,president,teacher}'),
  -- 工资账户: the teller their own, the bank admin and sysadmin anyone's (§6.9, PHASE-2.md §5.2)
  ('bind_salary_account(uuid,text,text)', 'select bind_salary_account(auth.uid(), ''nobody'', ''x'')', '{teller,teacher,sysadmin}'),
  ('unbind_salary_account(uuid)', 'select unbind_salary_account(auth.uid())', '{teller,teacher,sysadmin}'),
  -- 报表
  ('bank_report(date,date,text,integer,integer,text,time without time zone,time without time zone)',
    'select bank_report(current_date, current_date)', '{accountant,president,teacher}'),
  -- 商品管理、出入库
  ('upsert_product(uuid,text,integer,integer,text,text,boolean,integer)',
    'select upsert_product(gen_random_uuid(), ''x'', 1, p_listed => true)', '{storekeeper,president,teacher}'),
  ('stock_in(uuid,integer,text)', 'select stock_in(gen_random_uuid(), 1, null)', '{storekeeper,president,teacher}'),
  ('stock_move(text,jsonb,text)', 'select stock_move(''stock_in'', ''[]'', null)', '{storekeeper,president,teacher}'),
  -- 考勤、工资、参数
  ('set_attendance(uuid,boolean)', 'select set_attendance(gen_random_uuid(), false)', '{president,teacher}'),
  ('makeup_attendance(uuid,date,text,text)', 'select makeup_attendance(gen_random_uuid(), current_date, ''am'', '''')', '{president,teacher}'),
  ('review_attendance(uuid[],text,text)', 'select review_attendance(''{}'', ''nonsense'', null)', '{president,teacher}'),
  ('pay_salaries(date)', 'select pay_salaries(null)', '{president,teacher}'),
  ('set_setting(text,jsonb)', 'select set_setting(''nonsense'', ''1'')', '{president,teacher}'),
  ('set_settings(jsonb)', 'select set_settings(''{"nonsense":1}'')', '{president,teacher}'),
  -- 登记发行: the bank admin alone (PHASE-2.md §3)
  ('register_issue(text,date,jsonb,text,text)', 'select register_issue('''', current_date, ''{}'', '''', '''')', '{teacher}'),
  -- 信用分: the student their own, the accountant, president and bank admin anyone's; 手动调整 the bank admin alone (PHASE-2.md §3)
  ('credit_profile(text)', 'select credit_profile(coalesce(app_private.my_student_no(), ''nobody''))', '{student,accountant,president,teacher}'),
  ('adjust_credit(text,integer,text)', 'select adjust_credit(''nobody'', 1, ''x'')', '{teacher}'),
  -- 利率与利息: the student their own, the accountant, president and bank admin anyone's and the 利率 page (PHASE-2.md §3)
  ('interest_profile(text)', 'select interest_profile(coalesce(app_private.my_student_no(), ''nobody''))', '{student,accountant,president,teacher}'),
  ('rate_overview()', 'select rate_overview()', '{accountant,president,teacher}'),
  -- 学期: the bank admin alone (PHASE-2.md §3)
  ('upsert_term(uuid,text,date,date)', 'select upsert_term(null, '''', current_date, current_date)', '{teacher}'),
  ('close_term(uuid)', 'select close_term(gen_random_uuid())', '{teacher}'),
  -- 账号管理: the bank admin, the sysadmin where §4.2 says so, never the president
  ('import_roster(jsonb)', 'select import_roster(''[{}]'')', '{teacher}'),
  ('set_student_status(text,text)', 'select set_student_status(''nobody'', ''frozen'')', '{teacher}'),
  ('create_staff(text,text,app_role)', 'select create_staff(''-'', '''', ''teller'')', '{teacher,sysadmin}'),
  ('import_staff(jsonb)', 'select import_staff(''[{}]'')', '{teacher,sysadmin}'),
  ('set_role(uuid,app_role)', 'select set_role(gen_random_uuid(), ''teller'')', '{teacher,sysadmin}'),
  ('reset_password(uuid)', 'select reset_password(gen_random_uuid())', '{teacher,sysadmin}'),
  ('reissue_passwords(text[])', 'select reissue_passwords(array[''nobody''])', '{teacher,sysadmin}'),
  ('set_user_disabled(uuid,boolean)', 'select set_user_disabled(gen_random_uuid(), true)', '{teacher,sysadmin}'),
  ('close_accounts(uuid[])', 'select close_accounts(array[gen_random_uuid()])', '{teacher,sysadmin}');

-- Every function PostgREST could call (public, executable by anon or authenticated) is in the matrix, and only those.
create view tests.exposed as
  select p.oid::regprocedure::text as fn from pg_proc p
  where p.pronamespace = 'public'::regnamespace
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'));
select is(array(select fn from tests.exposed except select fn from tests.matrix order by 1), '{}',
  'every exposed function is in the matrix');
select is(array(select fn from tests.matrix except select fn from tests.exposed order by 1), '{}',
  'every function in the matrix is exposed');
select is(array(select fn from tests.exposed where has_function_privilege('anon', fn::regprocedure, 'execute')), '{}',
  'anon executes no function');

-- The matrix itself: one assertion per identity and function.
select is(tests.verdict(w.id, m.call),
  case when w.name = 'anon' then 'denied'
       when '*' = any(m.allowed) or w.name = any(m.allowed) then 'passed' else 'denied' end,
  format('%s: %s', w.name, m.fn))
from tests.matrix m cross join tests.who w order by m.fn, w.name;

-- Business rules that narrow a role to its own records (§6.3, §6.8, §6.9).
select is(tests.err(:'teller', format('select bind_salary_account(%L, ''s1'', ''123456'')', :'teller_closed')), 'FORBIDDEN',
  'a teller binds only their own salary account');
select is(tests.err(:'teller', format('select unbind_salary_account(%L)', :'teacher')), 'FORBIDDEN',
  'and unbinds only their own');
select is(tests.err(:'president', format('select bind_salary_account(%L, ''s1'', ''123456'')', :'teller')), 'FORBIDDEN',
  'the president binds no salary account');
select is(tests.err(:'president', format('select unbind_salary_account(%L)', :'teller')), 'FORBIDDEN', 'nor unbinds one');

-- A disabled or closed student loses their own records at once, as a disabled staff login loses its role.
select is(tests.call(:'student', 'select count(*) from accounts'), '1', 'a student reads their own account');
select is(tests.call(:'student_disabled', 'select count(*) from accounts'), '0', 'a disabled student does not');
select is(tests.call(:'student_closed', 'select count(*) from students'), '0', 'nor does a closed one');

-- No identity writes a table directly: balances, stock and the ledger change only through the functions above (§4.2).
select is(array(select c.relname || ':' || pr from pg_class c, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) pr,
    unnest(array['anon','authenticated']) r
  where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
    and (has_table_privilege(r, c.oid, pr) or pr in ('INSERT', 'UPDATE') and has_any_column_privilege(r, c.oid, pr))
  order by 1), '{}', 'anon and authenticated hold no write grant on any table');
create table tests.writes (tbl text primary key, stmt text not null);
insert into tests.writes values
  ('accounts', 'update accounts set balance = balance + 1000'),
  ('txns', 'delete from txns'),
  ('txn_items', 'update txn_items set qty = qty + 1'),
  ('products', 'update products set stock = 999'),
  ('stock_movements', 'delete from stock_movements'),
  ('students', 'update students set status = ''normal'''),
  ('profiles', 'update profiles set disabled = false'),
  ('user_roles', 'insert into user_roles (user_id, role) values (auth.uid(), ''teacher'')'),
  ('settings', 'update settings set value = ''0'''),
  ('duty', 'update duty set ended_at = now()'),
  ('cash_counts', 'update cash_counts set status = ''done'''),
  ('attendance', 'update attendance set status = ''confirmed'''),
  ('staff_payroll', 'update staff_payroll set attendance = true'),
  ('currency_issues', 'delete from currency_issues'),
  ('terms', 'update terms set closed_at = now()'),
  ('credit_scores', 'update credit_scores set score = 1000'),
  ('credit_events', 'insert into credit_events (student_no, delta, score, rule, reason) values (''s1'', 400, 1000, ''manual'', ''x'')'),
  ('job_runs', 'update job_runs set last_err = null'),
  ('audit_log', 'delete from audit_log');
select is(tests.verdict(w.id, x.stmt), 'denied', format('%s: write %s', w.name, x.tbl))
from tests.writes x cross join tests.who w where w.name in ('anon', 'student', 'teller', 'accountant', 'storekeeper', 'president', 'teacher', 'sysadmin')
order by x.tbl, w.name;

-- Product images: the storekeeper, president and bank admin upload (§6.7).
select is(tests.verdict(w.id, format('insert into storage.objects (bucket_id, name) values (''product-images'', %L)', w.name || '.jpg')),
  case when w.name in ('storekeeper', 'president', 'teacher') then 'passed' else 'denied' end, format('%s: upload a product image', w.name))
from tests.who w order by w.name;

select * from finish();
rollback;
