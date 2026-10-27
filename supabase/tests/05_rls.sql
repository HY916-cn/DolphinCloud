-- Who reads what (PHASE-1.md §6.6, §6.7).
\ir helpers/setup.psql

select tests.staff('t1', '{teller}') as t1 \gset
select tests.staff('t2', '{teller}') as t2 \gset
select tests.staff('acc', '{accountant}') as acc \gset
select tests.staff('keeper', '{storekeeper}') as keeper \gset
select tests.staff('teacher', '{teacher}') as teacher \gset
select tests.staff('admin', '{sysadmin}') as admin \gset
select tests.student('s1', 50) as s1 \gset
select tests.student('s2', 30) as s2 \gset

select tests.call(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"10":1}')$$);
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000041', 's2', '{"10":1}')$$);
select tests.call(:'t2', $$select deposit(gen_random_uuid(), 's2', '{"5":1}')$$);
select tests.call(:'keeper', $$select upsert_product(null, '上架', 10, p_listed => true)$$);
select tests.call(:'keeper', $$select upsert_product(null, '未上架', 10)$$);
select tests.call(:'teacher', $$select register_issue('B1', current_date, '{"10":10}', '开学发行', '王老师')$$);
set local session_replication_role = replica;
update txns set created_at = created_at - interval '1 day' where id = '00000000-0000-4000-8000-000000000041';
set local session_replication_role = origin;

create function tests.counts(p_user uuid) returns text language sql as $$
  select tests.call(p_user, $q$select jsonb_build_array(
    (select count(*) from profiles), (select count(*) from students), (select count(*) from accounts),
    (select count(*) from txns), (select count(*) from products), (select count(*) from currency_issues),
    (select count(*) from audit_log) > 0, (select count(*) from settings))$q$)::text
$$;
-- [profiles, students, accounts, txns, products, issues, audit visible, settings]
select is(tests.counts(:'s1'), '[1, 1, 1, 2, 1, 0, false, 6]', 'student: own profile, account and transactions; listed products');
select is(tests.call(:'s1', $$select jsonb_agg(distinct student_no) from txns$$), '["s1"]', 'student sees only their own transactions');
select is(tests.counts(:'t1'), '[1, 2, 2, 1, 1, 0, false, 6]', 'teller: all students, only their own transactions of today');
select is(tests.counts(:'acc'), '[1, 2, 2, 5, 2, 1, false, 6]', 'accountant: all transactions, products and issues');
select is(tests.counts(:'keeper'), '[1, 0, 0, 0, 2, 0, false, 6]', 'storekeeper: products only');
select is(tests.counts(:'teacher'), '[8, 2, 2, 5, 2, 1, true, 6]', 'teacher: everything');
select is(tests.counts(:'admin'), '[8, 0, 0, 0, 1, 0, true, 6]', 'sysadmin: accounts and the audit log, no business data');
select is(tests.call(:'s1', $$select count(*) from user_roles$$), '0', 'a student without roles sees no role rows');
select is(tests.call(:'admin', $$select count(*) from user_roles$$), '6', 'sysadmin sees all roles');

update profiles set disabled = true where id = :'t1';
select is(tests.counts(:'t1'), '[1, 0, 0, 0, 1, 0, false, 6]', 'a disabled teller loses access at once');

select is(tests.err(:'t2', $$insert into students (student_no, name, division, cohort, class_no) values ('x', 'x', 'primary', 2024, 1)$$),
  'permission denied for table students', 'no direct inserts');
select is(tests.err(:'teacher', $$update accounts set balance = 1000$$), 'permission denied for table accounts', 'no direct balance edits');

-- Product images
select is(tests.err(:'keeper', $$insert into storage.objects (bucket_id, name) values ('product-images', 'a.jpg') returning to_jsonb(name)$$), null,
  'a storekeeper can upload product images');
select is(tests.err(:'teacher', $$insert into storage.objects (bucket_id, name) values ('product-images', 'b.jpg') returning to_jsonb(name)$$), null, 'so can a teacher');
select matches(tests.err(:'t2', $$insert into storage.objects (bucket_id, name) values ('product-images', 'c.jpg') returning to_jsonb(name)$$),
  'row-level security', 'a teller cannot');

select * from finish();
rollback;
