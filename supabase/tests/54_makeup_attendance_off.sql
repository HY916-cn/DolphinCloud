-- 补签 (PHASE-1.md §6.9, PHASE-2.md §3): only for someone counted (参与考勤); ATTENDANCE_OFF otherwise, for a teller and for
-- the president alike, so nothing is registered or paid.
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('acct', 'accountant') as acct \gset
select tests.staff('p1', 'president') as p1 \gset
select tests.staff('teacher', 'teacher') as teacher \gset
select tests.student('s1', 0) as s1 \gset
select tests.student('s2', 0) as s2 \gset
select app_private.cn_date(now()) - 1 as y \gset

select is(tests.err(:'teacher', format($$select makeup_attendance(%L, %L, 'am', '忘了上班')$$, :'t1', :'y')), 'ATTENDANCE_OFF',
  'a teller never bound');
select tests.call(:'teacher', format($$select bind_salary_account(%L, 's1', null)$$, :'acct'));
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'acct', :'y')), 'ATTENDANCE_OFF',
  'bound but not counted');
select is(tests.err(:'teacher', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'p1', :'y')), 'ATTENDANCE_OFF',
  'a president not counted, by the bank admin');
select is((select count(*)::int from attendance), 0, 'nothing registered');

select tests.call(:'teacher', format($$select set_attendance(%L, true)$$, :'acct'));
select is(tests.call(:'p1', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'acct', :'y')) ->> 'status', 'confirmed',
  'once counted, registered');
select tests.call(:'teacher', format($$select set_attendance(%L, false)$$, :'acct'));
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'pm', '值班')$$, :'acct', :'y')), 'ATTENDANCE_OFF',
  'and no more once taken off');
select is(tests.err(:'p1', format($$select makeup_attendance(%L, %L, 'am', '值班')$$, :'p1', :'y')), 'SELF_SERVICE_FORBIDDEN',
  'not their own comes first');

select * from finish();
rollback;
