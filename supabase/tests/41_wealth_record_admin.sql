-- 手动登记指数涨跌 (PHASE-2.md §3, §10.10, §15): the bank admin alone enters a day's change; a president, 财务, 柜员, 库管,
-- the sysadmin and a student are refused, and a refused call enters nothing.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('keeper', 'storekeeper') as storekeeper \gset
select tests.staff('ops', 'sysadmin') as sysadmin \gset
select tests.student('s1', 0) as student \gset

select is(tests.err(:'president', $$select record_wealth_day('csi300', '2025-03-03', 1, '中证指数官网收盘行情')$$), 'FORBIDDEN',
  'a president does not enter the index');
select is(tests.err(w, $$select record_wealth_day('csi300', '2025-03-03', 1, '中证指数官网收盘行情')$$), 'FORBIDDEN', format('nor %s', n))
from (values (:'accountant'::uuid, '财务'), (:'teller', '柜员'), (:'storekeeper', '库管'), (:'sysadmin', 'the sysadmin'),
  (:'student', 'a student')) t(w, n);
select is((select count(*)::int from wealth_days where product = 'csi300' and day = '2025-03-03'), 0, 'and none of them entered it');
select is(tests.call(:'teacher', $$select record_wealth_day('csi300', '2025-03-03', 1, '中证指数官网收盘行情')$$) - 'created_at',
  jsonb_build_object('product', 'csi300', 'day', '2025-03-03', 'close', null, 'prev_close', null, 'change', 1, 'source', 'manual',
    'note', '中证指数官网收盘行情', 'created_by', :'teacher'), 'the bank admin enters it');
select is((select count(*)::int from audit_log where action = 'wealth.record' and target = 'wealth_days:csi300:2025-03-03' and actor_id = :'teacher'), 1,
  'with its log');

select * from finish();
rollback;
