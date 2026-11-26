-- 冲正 of 开户, 定期转回, 理财转回 and 调账 (PHASE-2.md §3, §10.9): the bank admin alone; a president is refused and enters
-- nothing, and still reverses a 存款 or 取款. The teller and 财务 as before, and 终止 of a 提前支取 alert by the bank admin.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.student('s1', 500) as s1 \gset
select tests.student('s2', 50) as s2 \gset

-- One of each: the 开户 of s2, and for s1 a 定期 and a 理财 closed at the counter today by the teller, a 调账, a 存款 and a 取款.
select id as opening from txns where student_no = 's2' and type = 'opening' \gset
select app_private.start_term_deposit('00000000-0000-4000-8000-0000000004b1', 's1', 100, 4, :'teller', now() - interval '5 days') is not null;
select app_private.start_term_deposit('00000000-0000-4000-8000-0000000004b2', 's1', 50, 4, :'teller', now() - interval '5 days') is not null;
select tests.call(:'teller', $$select withdraw_term_early('00000000-0000-4000-8000-0000000004b1')$$) ->> 'id' as term_close \gset
select tests.call(:'teller', $$select withdraw_term_early('00000000-0000-4000-8000-0000000004b2')$$) ->> 'id' as term_close2 \gset
select app_private.start_wealth('00000000-0000-4000-8000-0000000004d1', 's1', 100, 'csi300', :'teller', now()) is not null;
update wealth_holdings set value_centi = 10350, opened_on = opened_on - 1, valued_to = (select max(day) + 1 from wealth_navs where product = 'csi300') where id = '00000000-0000-4000-8000-0000000004d1';
select tests.call(:'teller', $$select sell_wealth('00000000-0000-4000-8000-0000000004d1')$$) ->> 'id' as wealth_close \gset
update accounts set balance = balance + 7 where student_no = 's1';
insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id)
select gen_random_uuid(), 'adjust', 's1', 7, 7, balance, :'teacher' from accounts where student_no = 's1' returning id as adjust \gset
select tests.call(:'teller', $$select deposit('00000000-0000-4000-8000-0000000004a1', 's1', '{"10":1}')$$) is not null;
select tests.call(:'teller', $$select withdraw('00000000-0000-4000-8000-0000000004a2', 's1', 5)$$) is not null;
select is(count(*)::int, 6, 'each type is there, normal') from txns where status = 'normal'
  and id in (:'opening', :'term_close', :'wealth_close', :'adjust', '00000000-0000-4000-8000-0000000004a1', '00000000-0000-4000-8000-0000000004a2');

-- The president: refused the four types, and nothing entered.
select is(tests.err(:'president', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', id)), 'FORBIDDEN', 'a president does not reverse ' || n)
from (values (:'opening'::uuid, '开户'), (:'term_close', '定期转回'), (:'wealth_close', '理财转回'), (:'adjust', '调账')) t(id, n);
select is(count(*)::int, 0, 'no reversal entered') from txns where type = 'reversal';
select is(count(*)::int, 4, 'the four still normal') from txns where status = 'normal' and id in (:'opening', :'term_close', :'wealth_close', :'adjust');
select is((select status from term_deposits where id = '00000000-0000-4000-8000-0000000004b1'), 'early', 'the 定期 still closed');
select is((select status from wealth_holdings where id = '00000000-0000-4000-8000-0000000004d1'), 'redeemed', 'the 理财 still redeemed');

-- ... and reverses a 存款 and a 取款 as before.
select is(tests.call(:'president', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-0000000004a1', '金额录错')$$) ->> 'type', 'reversal',
  'the president reverses a 存款');
select is(tests.call(:'president', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-0000000004a2', '金额录错')$$) ->> 'type', 'reversal',
  'and a 取款');

-- The teller, even on their own of today, and 财务: as before.
select is(tests.err(:'teller', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', id)), 'REVERSAL_NOT_ALLOWED', 'nor the teller ' || n)
from (values (:'opening'::uuid, '开户'), (:'term_close', '定期转回'), (:'wealth_close', '理财转回'), (:'adjust', '调账')) t(id, n);
select is(tests.err(:'accountant', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', id)), 'FORBIDDEN', 'nor 财务 ' || n)
from (values (:'opening'::uuid, '开户'), (:'term_close', '定期转回'), (:'wealth_close', '理财转回'), (:'adjust', '调账')) t(id, n);
select is(count(*)::int, 2, 'still only the president''s two reversals') from txns where type = 'reversal';

-- The bank admin reverses the four.
select is(tests.call(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')', id)) ->> 'type', 'reversal', 'the bank admin reverses ' || n)
from (values (:'opening'::uuid, '开户'), (:'term_close', '定期转回'), (:'wealth_close', '理财转回'), (:'adjust', '调账')) t(id, n);
select is(count(*)::int, 4, 'the four reversed') from txns where status = 'reversed' and id in (:'opening', :'term_close', :'wealth_close', :'adjust');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- 终止 of a 提前支取 alert reverses its 定期转回 as the bank admin; the president does not 终止.
select id as alert from risk_alerts where kind = 'term_early' and target = 'txns:' || :'term_close2' \gset
select is(tests.err(:'president', format($$select handle_alert(%s, 'terminate', '误操作')$$, :alert)), 'FORBIDDEN', 'a president does not 终止');
select is(tests.call(:'teacher', format($$select handle_alert(%s, 'terminate', '误操作')$$, :alert)) #>> '{alert,status}', 'terminated',
  'the bank admin does');
select is((select status from txns where id = :'term_close2'), 'reversed', 'its 定期转回 reversed');
select is((select status from term_deposits where id = '00000000-0000-4000-8000-0000000004b2'), 'open', 'the 定期 open again');

select * from finish();
rollback;
