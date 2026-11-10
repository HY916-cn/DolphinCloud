-- 报表 counts 已注销 accounts among the students (PHASE-1.md §6.8).
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('acct', 'accountant') as acct \gset
select tests.staff('t1', 'teller') as t1 \gset
select tests.student('s1', 10) as s1 \gset
select tests.student('s2', 20) as s2 \gset
select tests.student('s3', 0) as s3 \gset
select tests.student('s4', 0) as s4 \gset
select app_private.cn_date(now()) as d \gset

select tests.call(:'teacher', $$select set_student_status('s2', 'frozen')$$);
select tests.call(:'teacher', $$select set_student_status('s3', 'graduated')$$);
select tests.call(:'teacher', format($$select close_accounts(array[%L]::uuid[])$$, :'s4'));

select tests.call(:'acct', format($$select bank_report(%L, %L)$$, :'d', :'d')) -> 'students' as st \gset
select is((select jsonb_object_agg(k, :'st'::jsonb -> k) from unnest(array['total', 'normal', 'frozen', 'graduated', 'closed']) k),
  '{"total": 4, "normal": 1, "frozen": 1, "graduated": 1, "closed": 1}', 'the students by status, 已注销 included');
select is((select array_agg(k order by k) from jsonb_object_keys(:'st'::jsonb) k),
  '{active,balance,closed,frozen,graduated,max,median,normal,total}', 'alongside the fields the client already reads');
select is(tests.call(:'teacher', format($$select bank_report(%L, %L)$$, :'d', :'d')) -> 'students' -> 'closed', '1', 'the bank admin reads it too');
select is(tests.err(:'t1', format($$select bank_report(%L, %L)$$, :'d', :'d')), 'FORBIDDEN', 'a teller does not');
select is(tests.err(:'s1', format($$select bank_report(%L, %L)$$, :'d', :'d')), 'FORBIDDEN', 'nor a student');

select * from finish();
rollback;
