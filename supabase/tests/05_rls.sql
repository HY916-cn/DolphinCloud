-- Who reads what (PHASE-1.md §6.6, §6.7).
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('t2', 'teller') as t2 \gset
select tests.staff('acc', 'accountant') as acc \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.student('s1', 50) as s1 \gset
select tests.student('s2', 30) as s2 \gset

select tests.call(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":1}')$$);
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000041', 's2', '{"10":1}')$$);
select tests.call(:'t2', $$select deposit(gen_random_uuid(), 's2', '{"5":1}')$$);
select tests.call(:'keeper', $$select upsert_product(null, '上架', 10, p_listed => true)$$);
select tests.call(:'keeper', $$select upsert_product(null, '未上架', 10, 4, p_listed => false)$$);
select tests.call(:'teacher', $$select record_currency(gen_random_uuid(), 'issue', '{"10":10}', current_date, '开学发行', 'B1', '王老师')$$);
set local session_replication_role = replica;
update txns set created_at = created_at - interval '1 day' where id = '00000000-0000-4000-8000-000000000041';
set local session_replication_role = origin;

create function tests.counts(p_user uuid) returns text language sql as $$
  select tests.call(p_user, format($q$select jsonb_build_array(
    (select count(*) from profiles), (select count(*) from students), (select count(*) from accounts),
    (select count(*) from txns), (select count(*) from products), (select count(*) from currency_moves),
    (select count(*) from audit_log) > 0, (select count(*) from settings) = %s)$q$, (select count(*) from settings)))::text
$$;
-- [profiles, students, accounts, txns, products, issues, audit visible, every setting visible]
select is(tests.counts(:'s1'), '[1, 1, 1, 2, 1, 0, false, true]', 'student: own profile, account and transactions; listed products');
select is(tests.call(:'s1', $$select jsonb_agg(distinct student_no) from txns$$), '["s1"]', 'student sees only their own transactions');
select is(tests.counts(:'t1'), '[1, 2, 2, 1, 1, 0, false, true]', 'teller: all students, only their own transactions of today');
select is(tests.counts(:'acc'), '[7, 2, 2, 5, 2, 1, false, true]', 'accountant: all transactions, products, issues and the staff logins (the system login too)');
select is(tests.counts(:'keeper'), '[1, 0, 0, 0, 2, 0, false, true]', 'storekeeper: products only');
select is(tests.counts(:'teacher'), '[9, 2, 2, 5, 2, 1, true, true]', 'teacher: everything');
select is(tests.counts(:'ops'), '[9, 2, 0, 0, 1, 0, true, true]', 'sysadmin: logins, students (no balances) and the audit log');
select is(tests.call(:'s1', $$select count(*) from user_roles$$), '0', 'a student without roles sees no role rows');

-- 横向读取: a student reads no one else's records, even asking for them by name; anon reads no table at all.
insert into attendance (user_id, day, shift, status, signed_by) values (:'t1', current_date, 'am', 'confirmed', :'t1');
select is(tests.call(:'s1', $$select jsonb_build_array((select count(*) from txns where student_no = 's2'),
    (select count(*) from accounts where student_no = 's2'), (select count(*) from students where student_no = 's2'),
    (select count(*) from attendance), (select count(*) from credit_scores where student_no = 's2'),
    (select count(*) from txns where student_no <> 's1'), (select count(*) from accounts where student_no <> 's1'))$$),
  '[0, 0, 0, 0, 0, 0, 0]', 'a student reads none of another student''s transactions, account, profile, attendance or score');
select is(array(select c.relname::text from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p')
    and (has_table_privilege('anon', c.oid, 'SELECT') or has_any_column_privilege('anon', c.oid, 'SELECT')) order by 1), '{}',
  'anon holds no read grant on any table');
create function tests.anon(p_sql text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('role', 'anon', true);
  execute p_sql;
  perform set_config('role', 'none', true);
  return 'read';
exception when others then
  return sqlerrm;
end $$;
select matches(tests.anon(format('select count(*) from public.%I', c.relname)), '^permission denied for (table|view) ', format('anon: read %s', c.relname))
from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'v', 'm', 'p') order by c.relname;
select is(tests.call(:'ops', $$select count(*) from user_roles$$), '6', 'sysadmin sees all roles');
select is(tests.call(:'acc', $$select count(*) from user_roles$$), '6', 'accountant sees the staff roles (who is a teller)');

update profiles set disabled = true where id = :'t1';
select is(tests.counts(:'t1'), '[1, 0, 0, 0, 1, 0, false, true]', 'a disabled teller loses access at once');

select is(tests.err(:'t2', $$insert into students (student_no, name, division, cohort, class_no) values ('x', 'x', 'primary', 2024, 1)$$),
  'permission denied for table students', 'no direct inserts');
select is(tests.err(:'teacher', $$update accounts set balance = 1000$$), 'permission denied for table accounts', 'no direct balance edits');

-- Purchase cost: only the storekeeper, accountant and teacher read it, through product_costs
select is(tests.err(:'s1', $$select to_jsonb(array_agg(cost)) from products$$), 'permission denied for table products',
  'a student cannot read products.cost');
select is(tests.err(:'t1', $$select to_jsonb(array_agg(cost)) from products$$), 'permission denied for table products', 'nor can a teller');
select is(tests.call(:'s1', $$select jsonb_agg(name) from products$$), '["上架"]', 'the other columns stay readable');
select is(tests.call(:'s1', $$select count(*) from product_costs$$), '0', 'product_costs shows a student nothing');
select is(tests.call(:'ops', $$select count(*) from product_costs$$), '0', 'nor a sysadmin');
select is(tests.call(:'keeper', $$select jsonb_agg(c.cost order by c.cost nulls first) from product_costs c$$), '[null, 4]',
  'the storekeeper reads every product''s cost');
select is(tests.call(:'acc', $$select count(*) from product_costs$$), '2', 'so does the accountant');
select is(tests.call(:'teacher', $$select count(*) from product_costs$$), '2', 'and the teacher');

-- Product images
select is((select row(allowed_mime_types, file_size_limit)::text from storage.buckets where id = 'product-images'),
  '("{image/jpeg,image/png,image/webp}",5242880)', 'the image bucket takes JPEG, PNG and WebP up to 5 MB');
select is(tests.err(:'keeper', $$insert into storage.objects (bucket_id, name) values ('product-images', 'a.jpg') returning to_jsonb(name)$$), null,
  'a storekeeper can upload product images');
select is(tests.err(:'teacher', $$insert into storage.objects (bucket_id, name) values ('product-images', 'b.jpg') returning to_jsonb(name)$$), null, 'so can a teacher');
select matches(tests.err(:'t2', $$insert into storage.objects (bucket_id, name) values ('product-images', 'c.jpg') returning to_jsonb(name)$$),
  'row-level security', 'a teller cannot');

select * from finish();
rollback;
