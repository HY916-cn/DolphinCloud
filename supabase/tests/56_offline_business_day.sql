-- 离线存款的业务日 (PHASE-2.md §7.4): an offline 存款 counts in 报表, 经营看板 and 货币监控 on the day the counter took it,
-- when that is no later than its upload and at most 7 days before; otherwise on the day of its upload.
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('teacher', 'teacher') as teacher \gset
select tests.student('s1', 0) as s1 \gset
select app_private.cn_date(now()) as today \gset
select app_private.cn_date(now()) - 1 as y \gset
-- Noon of a day before today, Shanghai time.
create function tests.noon(p_days integer) returns timestamptz language sql as $$
  select (app_private.cn_date(now()) - p_days + time '12:00') at time zone 'Asia/Shanghai'
$$;

-- Uploaded now: 10 taken yesterday, 5 taken 8 days ago, 2 dated after the upload, 1 taken online today.
select tests.call(:'t1', format($$select deposit(gen_random_uuid(), 's1', '{"10":1}', true, %L)$$, tests.noon(1)));
select tests.call(:'t1', format($$select deposit(gen_random_uuid(), 's1', '{"5":1}', true, %L)$$, tests.noon(8)));
select tests.call(:'t1', format($$select deposit(gen_random_uuid(), 's1', '{"2":1}', true, %L)$$, now() + interval '1 hour'));
select tests.call(:'t1', $$select deposit(gen_random_uuid(), 's1', '{"1":1}')$$);
select is(array(select concat_ws(' ', amount, app_private.txn_at(t) = coalesce(client_created_at, created_at)) from txns t order by amount),
  array['1 t', '2 f', '5 f', '10 t'], 'counted when taken: within 7 days before the upload; else at the upload');

create function tests.report(p_from date, p_to date) returns jsonb language sql as $$
  select tests.call((select id from profiles where login_id = 'teacher'), format('select bank_report(%L, %L)', p_from, p_to))
$$;
select is(tests.report(:'y', :'y') #> '{business,deposit}', '{"count": 1, "amount": 10}', 'the report of yesterday: the 10 taken offline');
select is(tests.report(:'y', :'y') -> 'balance', '{"changes": {"deposit": 10}, "closing": 10, "opening": 0}',
  'with 活期 at its end');
select is(tests.report(:'y', :'y') -> 'cash', '{"in": 10, "out": 0}', 'and the cash taken in');
select is(tests.report(:'y', :'y') #> '{days,0}' ->> 'deposit', '10', 'on its day');
select is(tests.report(:'y', :'y') #> '{hours,0}', '{"hour": 12, "count": 1}', 'at its hour');
select is(tests.report(:'today', :'today') #> '{business,deposit}', '{"count": 3, "amount": 8}', 'today: the other three');
select is(tests.report(:'today', :'today') -> 'balance', '{"changes": {"deposit": 8}, "closing": 18, "opening": 10}',
  'from 10 to 18');
select is(tests.report(:'y', :'today') #> '{business,deposit}', '{"count": 4, "amount": 18}', 'each once over both days');
select is((select (tests.call((select id from profiles where login_id = 'teacher'), format('select bank_report(%L, %L, p_time_from => %L, p_time_to => %L)',
    :'y', :'y', '11:00', '13:00')) #> '{business,deposit,count}')::int), 1, 'and in the 时段 it was taken');

-- 货币监控 by the end of yesterday: the 10 HTB note is in the bank; 经营看板 counts the 存款 in its week.
select is(app_private.currency_state(:'y') #>> '{paper,flow}', '10', '货币监控 of yesterday: the note taken in');
select is(app_private.currency_state(:'today') #>> '{paper,flow}', '18', 'and of today, all four');
select is(jsonb_path_query_array(tests.call(:'teacher', 'select dashboard()') -> 'weeks', '$[*].count'),
  (select jsonb_agg(c order by w) from (select v.w, (select count(*) from txns t
     where date_trunc('week', app_private.cn_date(app_private.txn_at(t)))::date = v.w) as c
   from (select date_trunc('week', :'today'::date)::date - 7 * i as w from generate_series(0, 11) i) v) x),
  '经营看板 counts each 存款 in the week it was taken');

select * from finish();
rollback;
