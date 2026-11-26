-- 货币登记与监控、经营看板 (PHASE-2.md §11, §15, §16.2, §19): each kind of record, its checks, no edits, 更正; who
-- records and who reads; the monitoring formulas over every kind of transaction that moves cash (and those that do not),
-- the transactions before the 期初现金 left out, the notes students hold below 0; 兑付能力 and its line; dashboard() and
-- its 12 weeks, each number equal to bank_report's.
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('t2', 'teller') as t2 \gset
select tests.staff('t3', 'teller') as t3 \gset
select tests.staff('acc', 'accountant') as acc \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('p1', 'president') as p1 \gset
select tests.staff('admin', 'teacher') as admin \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.student('s1', 500) \gset
select tests.student('s2', 200) \gset
select tests.student('s3', 0) \gset
select tests.student('s4', 300) \gset
select tests.student('s5', 300) \gset
select tests.student('s6', 20) as s6 \gset
set local session_replication_role = replica;
update students set opened_at = now() - interval '30 days';
set local session_replication_role = origin;

create function tests.state() returns jsonb language sql as $$
  select tests.call((select id from profiles where login_kind = 'staff' and login_id = 'acc'), 'select currency_overview()')
$$;
create function tests.note(p_note integer) returns jsonb language sql as $$
  select n from jsonb_array_elements(tests.state() -> 'notes') n where (n ->> 'note')::integer = p_note
$$;

-- Before the 期初现金: no baseline, every transaction counts.
select is(tests.state() -> 'baseline', 'null', 'no 期初现金 yet');
select is(app_private.setting('payout_ratio_min'), '30', 'payout_ratio_min is 30% by default');

-- Who records (§3): the bank admin alone.
select is(tests.err(u, $$select record_currency(gen_random_uuid(), 'baseline', '{"10":20,"1":50}', current_date)$$), 'FORBIDDEN',
  format('%s does not record currency', n))
from (values (:'t1'::uuid, 'a teller'), (:'acc', 'the accountant'), (:'keeper', 'the storekeeper'), (:'p1', 'the president'),
  (:'ops', 'the sysadmin')) x(u, n);

-- 银行期初现金: once; the reason may be left out.
select tests.call(:'admin', $$select record_currency('00000000-0000-4000-8000-0000000000b1', 'baseline', '{"10":20,"1":50}', app_private.cn_date(now()))$$) as baseline \gset
select is(:'baseline'::jsonb - 'created_at' - 'created_by',
  jsonb_build_object('id', '00000000-0000-4000-8000-0000000000b1', 'kind', 'baseline', 'batch_no', null, 'on_date', app_private.cn_date(now()),
    'denominations', '{"10":20,"1":50}'::jsonb, 'total', 250, 'reason', null, 'approver_name', null, 'corrects', null,
    'created_by_name', 'admin'), 'the 期初现金: counts, total and who entered it');
select is(tests.call(:'admin', $$select record_currency('00000000-0000-4000-8000-0000000000b1', 'issue', '{"10":1}', current_date)$$) ->> 'kind',
  'baseline', 'the same id again returns the record');
select is(tests.call(:'admin', $$select record_currency(gen_random_uuid(), 'baseline', '{"10":1}', current_date)$$) ->> 'detail',
  '{"field": "kind"}', 'a second 期初现金: ALREADY_EXISTS');
select is(tests.err(:'admin', $$select record_currency(gen_random_uuid(), 'baseline', '{"10":1}', current_date)$$), 'ALREADY_EXISTS', 'error code');

-- The checks.
select is(tests.call(:'admin', $$select record_currency(gen_random_uuid(), 'mint', '{"10":1}', current_date, 'x')$$) ->> 'detail',
  '{"field": "kind"}', 'unknown kind');
select is(tests.call(:'admin', $$select record_currency(null, 'issue', '{"10":1}', current_date, 'x', 'B', 'y')$$) ->> 'detail',
  '{"field": "id"}', 'the id is required');
select is(tests.call(:'admin', $$select record_currency(gen_random_uuid(), 'issue', '{"10":1}', app_private.cn_date(now()) + 1, '开学', 'FX-0', '王老师')$$) ->> 'detail',
  '{"field": "on_date"}', 'no date in the future');
select is(tests.call(:'admin', $$select record_currency(gen_random_uuid(), 'recover', '{"10":1}', null, '旧版')$$) ->> 'detail',
  '{"field": "on_date"}', 'a date is required');
select is(tests.err(:'admin', $$select record_currency(gen_random_uuid(), 'issue', '{"3":1}', current_date, '开学', 'FX-0', '王老师')$$),
  'INVALID_AMOUNT', 'a denomination not configured');
select is(tests.err(:'admin', $$select record_currency(gen_random_uuid(), 'issue', '{"10":0}', current_date, '开学', 'FX-0', '王老师')$$),
  'INVALID_AMOUNT', 'nothing issued');
select is(tests.err(:'admin', $$select record_currency(gen_random_uuid(), 'destroy', '{"10":-1}', current_date, '损毁')$$),
  'INVALID_AMOUNT', 'no negative counts but in a 更正');
select is(tests.call(:'admin', $$select record_currency(gen_random_uuid(), 'issue', '{"10":1}', current_date, '开学', ' ', '王老师')$$) ->> 'detail',
  '{"field": "batch_no"}', 'an issue has a batch number');
select is(tests.call(:'admin', $$select record_currency(gen_random_uuid(), 'issue', '{"10":1}', current_date, '开学', 'FX-0')$$) ->> 'detail',
  '{"field": "approver_name"}', 'and an approver');
select is(tests.call(:'admin', $$select record_currency(gen_random_uuid(), 'issue', '{"10":1}', current_date, null, 'FX-0', '王老师')$$) ->> 'detail',
  '{"field": "reason"}', 'and a purpose');
select is(tests.call(:'admin', format('select record_currency(gen_random_uuid(), ''recover'', ''{"10":1}'', current_date, %L)', repeat('长', 101))) ->> 'detail',
  '{"field": "reason"}', 'a reason is 100 characters at most');

-- 发行、回收、销毁.
select is(tests.call(:'admin', $$select record_currency('00000000-0000-4000-8000-0000000000b2', 'issue', '{"10":30,"5":10}', app_private.cn_date(now()), ' 开学发行 ', ' FX-1 ', ' 王老师 ')$$)
  - 'id' - 'created_at' - 'created_by' - 'on_date',
  '{"kind":"issue","batch_no":"FX-1","denominations":{"10":30,"5":10},"total":350,"reason":"开学发行","approver_name":"王老师","corrects":null,"created_by_name":"admin"}',
  'an issue: batch, counts, total, purpose and approver');
select is(tests.err(:'admin', $$select record_currency(gen_random_uuid(), 'issue', '{"10":1}', current_date, '补发', 'FX-1', '王老师')$$),
  'ALREADY_EXISTS', 'a batch number once');
select is(tests.call(:'admin', $$select record_currency('00000000-0000-4000-8000-0000000000b3', 'recover', '{"1":10}', current_date, '旧版回收', 'X', 'Y')$$)
  ->> 'batch_no', null, 'a 回收 keeps no batch number');
select tests.call(:'admin', $$select record_currency('00000000-0000-4000-8000-0000000000b4', 'destroy', '{"5":2}', current_date, '损毁')$$);

-- 更正: signed counts against a record, dated today; a record's counts with its 更正 stay 0 or more.
select is(tests.call(:'admin', $$select record_currency('00000000-0000-4000-8000-0000000000b5', 'correction', '{"10":-5}', '2020-01-01', '多登了 5 张', p_corrects => '00000000-0000-4000-8000-0000000000b2')$$)
  - 'id' - 'created_at' - 'created_by',
  jsonb_build_object('kind', 'correction', 'batch_no', null, 'on_date', app_private.cn_date(now()), 'denominations', '{"10":-5}'::jsonb,
    'total', -50, 'reason', '多登了 5 张', 'approver_name', null, 'corrects', '00000000-0000-4000-8000-0000000000b2', 'created_by_name', 'admin'),
  'a 更正 of the issue: −5 notes, −50 HTB, dated today');
select is(tests.call(:'admin', $$select record_currency(gen_random_uuid(), 'correction', '{"10":-26}', null, '多登了', p_corrects => '00000000-0000-4000-8000-0000000000b2')$$),
  '{"error":"INVALID_AMOUNT","detail":"{\"denomination\": 10}"}', 'not below 0 notes with the earlier 更正 (30 − 5 − 26)');
select is(tests.err(:'admin', $$select record_currency(gen_random_uuid(), 'correction', '{"10":-25}', null, '多登了', p_corrects => '00000000-0000-4000-8000-0000000000b4')$$),
  'INVALID_AMOUNT', 'nor a denomination the record has none of');
select is(tests.call(:'admin', $$select record_currency(gen_random_uuid(), 'correction', '{"10":1}', null, '再改', p_corrects => '00000000-0000-4000-8000-0000000000b5')$$) ->> 'detail',
  '{"field": "corrects"}', 'a 更正 corrects a record, not another 更正');
select is(tests.call(:'admin', $$select record_currency(gen_random_uuid(), 'correction', '{"10":1}', null, '再改')$$) ->> 'detail',
  '{"field": "corrects"}', 'which record is required');
select is(tests.err(:'admin', $$select record_currency(gen_random_uuid(), 'correction', '{"10":0}', null, '再改', p_corrects => '00000000-0000-4000-8000-0000000000b2')$$),
  'INVALID_AMOUNT', 'a 更正 changes something');
select is(tests.call(:'admin', $$select record_currency('00000000-0000-4000-8000-0000000000b7', 'correction', '{"5":2,"10":-1}', null, '换面额', p_corrects => '00000000-0000-4000-8000-0000000000b2')$$) ->> 'total',
  '0', 'a 更正 may total 0 HTB');
select is(tests.call(:'admin', $$select record_currency('00000000-0000-4000-8000-0000000000b6', 'correction', '{"1":-5}', null, '少数了', p_corrects => '00000000-0000-4000-8000-0000000000b1')$$) ->> 'total',
  '-5', 'the 期初现金 is corrected the same way');

-- Nothing is changed afterwards.
select throws_ok($$update currency_moves set total = 0$$, '42501', null, 'records are never updated');
select throws_ok($$delete from currency_moves$$, '42501', null, 'nor deleted');
select is(tests.err(:'admin', $$update currency_moves set total = 0$$), 'permission denied for table currency_moves', 'not by the bank admin either');
select is(tests.call(u, 'select count(*) from currency_moves')::text, n, format('%s reads %s records', w, n))
from (values (:'acc'::uuid, 'the accountant', '7'), (:'p1', 'the president', '7'), (:'admin', 'the bank admin', '7'),
  (:'t1', 'a teller', '0'), (:'keeper', 'the storekeeper', '0'), (:'ops', 'the sysadmin', '0')) x(u, w, n);
-- What is recorded: 期初 {10:20, 1:45}; 发行 {10:24, 5:12}; 回收 {1:10}; 销毁 {5:2}.

-- The 期初现金 was counted 2 days ago; a deposit 7 days ago (last week) is before it.
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000c00', 's2', '{"1":7}')$$);
set local session_replication_role = replica;
update currency_moves set created_at = now() - interval '2 days' where kind = 'baseline';
update txns set created_at = now() - interval '7 days' where id = '00000000-0000-4000-8000-000000000c00';
set local session_replication_role = origin;

-- Every kind of transaction (§11.2): cash in for 存款、现金兑换 (less 找零)、现金还款, out for 取款、现金放款; a 冲正 the
-- other way; a 补录 like the counter; 定期、理财、利息、工资、调账、放款入账户、从账户还款、开户、注销 move no cash.
select tests.call(:'keeper', $$select upsert_product(null, '笔记本', 3, 2, p_listed => true)$$) ->> 'id' as e1 \gset
select tests.call(:'keeper', $$select upsert_product(null, '贴纸', 1, p_listed => true)$$) ->> 'id' as e2 \gset
select tests.call(:'keeper', format('select stock_move(''stock_in'', %L)',
  jsonb_build_array(jsonb_build_object('product_id', :'e1', 'qty', 10), jsonb_build_object('product_id', :'e2', 'qty', 5))));
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000c01', 's1', '{"10":3}')$$);           -- +30: 10 ×3
select tests.call(:'t1', $$select withdraw('00000000-0000-4000-8000-000000000c02', 's1', 25)$$);                -- −25: 10 ×2, 5 ×1
select tests.call(:'t1', format($$select purchase('00000000-0000-4000-8000-000000000c03', 's2', '[{"product_id":"%s","qty":1}]', 'cash', '{"5":1}')$$, :'e1')); -- +5, 找零 2
select tests.call(:'t1', format($$select purchase('00000000-0000-4000-8000-000000000c04', 's2', '[{"product_id":"%s","qty":1}]', 'account')$$, :'e1'));
select tests.call(:'t1', $$select open_loan('00000000-0000-4000-8000-000000000c05', 's1', 20, '买文具', 'bullet', 2, 'cash')$$);       -- −20: 10 ×2
select tests.call(:'t1', $$select open_loan('00000000-0000-4000-8000-000000000c06', 's2', 10, '买文具', 'bullet', 2, 'account')$$);
select tests.call(:'t1', $$select repay_loan('00000000-0000-4000-8000-000000000c07', '00000000-0000-4000-8000-000000000c05', 5, 'cash', '{"5":1}')$$); -- +5
select tests.call(:'t1', $$select repay_loan('00000000-0000-4000-8000-000000000c08', '00000000-0000-4000-8000-000000000c06', 4, 'account', null)$$);
select tests.call(:'t1', $$select deposit('00000000-0000-4000-8000-000000000c09', 's3', '{"1":4}')$$);
select tests.call(:'t1', $$select reverse_txn('00000000-0000-4000-8000-000000000c0a', '00000000-0000-4000-8000-000000000c09', '金额录错')$$); -- +4 −4
select tests.call(:'t1', $$select open_term_deposit('00000000-0000-4000-8000-000000000c0b', 's4', 100, 2)$$);
select tests.call(:'t1', $$select withdraw_term_early('00000000-0000-4000-8000-000000000c0b')$$);
select tests.call(:'t1', $$select open_term_deposit('00000000-0000-4000-8000-000000000c0c', 's4', 50, 2)$$);
select tests.call(:'t1', $$select open_term_deposit('00000000-0000-4000-8000-000000000c0d', 's4', 30, 4)$$);
select tests.call(:'t1', format('select reverse_txn(''00000000-0000-4000-8000-000000000c0e'', %L, ''金额录错'')',
  (select open_txn from term_deposits where id = '00000000-0000-4000-8000-000000000c0d')));
select tests.call(:'t1', $$select buy_wealth('00000000-0000-4000-8000-000000000c0f', 's5', 'csi300', 60)$$);
update wealth_holdings set value_centi = 6350, opened_on = opened_on - 1, valued_to = (select max(day) + 1 from wealth_navs where product = 'csi300') where id = '00000000-0000-4000-8000-000000000c0f';
select tests.call(:'t1', $$select sell_wealth('00000000-0000-4000-8000-000000000c0f')$$);  -- 63 back: 盈 3
select tests.call(:'t1', $$select buy_wealth('00000000-0000-4000-8000-000000000c10', 's5', 'gold', 40)$$);
select tests.call(:'admin', $$select manual_entry('00000000-0000-4000-8000-000000000c11', 's3', 'deposit', now(), '系统故障', p_denominations => '{"2":5}')$$); -- +10
select tests.call(:'admin', $$select manual_entry('00000000-0000-4000-8000-000000000c12', 's3', 'adjust', now(), '调账', p_amount => 5)$$);
insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id)
values ('00000000-0000-4000-8000-000000000c13', 'interest', 's3', 2, 2, 17, app_private.system_user()),
  ('00000000-0000-4000-8000-000000000c14', 'salary', 's3', 10, 10, 27, :'admin');
update accounts set balance = balance + 12 where student_no = 's3';
select tests.call(:'admin', format('select close_accounts(array[%L]::uuid[])', :'s6'));

select is(array(select concat_ws(' ', type, sum(cash_delta), sum(app_private.cash_sum(coalesce(app_private.txn_cash(t) -> 'income', '{}'))
    - app_private.cash_sum(coalesce(app_private.txn_cash(t) -> 'payout', '{}'))))
  from txns t group by type order by type::text),
  array['adjust 0 0', 'closing 0 0', 'deposit 51 51', 'interest 0 0', 'loan -20 -20', 'opening 0 0', 'purchase 3 3', 'repay 5 5',
    'reversal -4 -4', 'salary 0 0', 'term_close 0 0', 'term_open 0 0', 'wealth_buy 0 0', 'wealth_close 0 0', 'withdraw -25 -25'],
  'by type: the notes of each transaction add up to its cash_delta; only 存款、兑换、放款、还款、取款 and their 冲正 move cash');

-- 纸币 (§11.2) by denomination: 期初 + 发行 − 回收 − 销毁 + flow; flow leaves out the deposit before the 期初现金.
select is(tests.note(n) - 'counted', e, format('%s HTB notes', n)) from (values
  (10, '{"note":10,"baseline":20,"issued":24,"recovered":0,"destroyed":0,"flow":-1,"bank":43,"students":1}'::jsonb),
  (5,  '{"note":5,"baseline":0,"issued":12,"recovered":0,"destroyed":2,"flow":1,"bank":11,"students":-1}'),
  (2,  '{"note":2,"baseline":0,"issued":0,"recovered":0,"destroyed":0,"flow":4,"bank":4,"students":-4}'),
  (1,  '{"note":1,"baseline":45,"issued":0,"recovered":10,"destroyed":0,"flow":0,"bank":35,"students":0}')) x(n, e);
select is(tests.state() -> 'paper',
  '{"baseline":245,"issued":300,"recovered":10,"destroyed":10,"flow":3,"bank":528,"students":-3}',
  'in HTB: 银行应有现金 528, and students hold 3 HTB fewer notes than since the 期初现金 (below 0)');
select is((tests.state() #>> '{paper,flow}')::bigint, (select sum(cash_delta) from txns where created_at >= now() - interval '2 days'),
  'the flow is the cash_delta of every transaction from the 期初现金 on');

-- 电子币 (§11.2): 活期 + 定期 + 理财本金, and 电子币新增 = 工资 + 利息 + 理财盈亏 + 放款入账户 − 从账户还款.
select is(tests.state() -> 'electronic', jsonb_build_object(
    'current', (select sum(balance) from accounts), 'term', 50, 'wealth', 40, 'total', (select sum(balance) + 90 from accounts),
    'new', '{"salary":10,"interest":2,"wealth":3,"loan":10,"repay":4,"total":21}'::jsonb),
  'electronic money and what was newly made');

-- 兑付能力 = 银行应有现金 ÷ 账户余额合计, below payout_ratio_min flagged.
select is(tests.state() -> 'payout', jsonb_build_object('ratio', (select round(100.0 * 528 / (sum(balance) + 90), 1) from accounts),
  'min', 30, 'low', (select 100.0 * 528 / (sum(balance) + 90) < 30 from accounts)), '兑付能力 and the line');
select is(tests.call(:'admin', $$select set_setting('payout_ratio_min', '100')$$) -> 'value', '100', 'the bank admin moves the line');
select is(tests.state() #> '{payout,low}', 'true', 'below it: low');
select tests.call(:'admin', $$select set_setting('payout_ratio_min', '1')$$);
select is(tests.state() #> '{payout,low}', 'false', 'above it: not low');
select is(tests.call(:'admin', x) ->> 'detail', '{"field": "payout_ratio_min"}', format('payout_ratio_min: %s', x))
from unnest(array[$$select set_setting('payout_ratio_min', '0')$$, $$select set_setting('payout_ratio_min', '101')$$,
  $$select set_setting('payout_ratio_min', '30.5')$$, $$select set_setting('payout_ratio_min', '"30"')$$]) x;
select is(tests.err(:'p1', $$select set_setting('payout_ratio_min', '30')$$), 'FORBIDDEN', 'the president does not set it');
select is((select count(*) from risk_alerts where kind = 'setting_change' and target = 'settings:payout_ratio_min'), 2::bigint,
  'each change raises a setting_change alert');
select tests.call(:'admin', $$select set_setting('payout_ratio_min', '30')$$);

-- Against the cash boxes: each teller's latest count, the accountant's when entered.
select is(tests.state() -> 'counted', '{"boxes":0,"at":null,"total":0}', 'no count yet');
select is(tests.note(10) -> 'counted', 'null', 'nor counted notes');
insert into duty (id, user_id, started_at, ended_at, txns) values
  ('00000000-0000-4000-8000-0000000000d1', :'t2', now() - interval '3 days', now() - interval '3 days' + interval '4 hours', 0),
  ('00000000-0000-4000-8000-0000000000d2', :'t3', now() - interval '3 days', now() - interval '3 days' + interval '4 hours', 0),
  ('00000000-0000-4000-8000-0000000000d3', :'t3', now() - interval '2 days', now() - interval '2 days' + interval '4 hours', 0);
insert into cash_counts (duty_id, float, teller_count, review_count, status) values
  ('00000000-0000-4000-8000-0000000000d1', '{}', '{"1":3,"10":2}', null, 'pending'),
  ('00000000-0000-4000-8000-0000000000d2', '{}', '{"10":9}', null, 'pending'),
  ('00000000-0000-4000-8000-0000000000d3', '{}', '{"10":1}', '{"10":2,"5":1}', 'done');
select is(tests.state() -> 'counted', jsonb_build_object('boxes', 2, 'at', now() - interval '2 days' + interval '4 hours', 'total', 48),
  'two boxes, 48 HTB');
select is(array(select concat_ws(' ', n ->> 'note', n ->> 'bank', n ->> 'counted') from jsonb_array_elements(tests.state() -> 'notes') n),
  '{"1 35 3","2 4","5 11 1","10 43 4"}', 'by denomination, beside 银行应有现金');

-- 经营看板 (§16.2).
set local session_replication_role = replica;
update loans set status = 'overdue' where id = '00000000-0000-4000-8000-000000000c06';
insert into rate_weeks (week_start, prev_anchor, deposits, loans, ratio, growth, adjust, anchor, params)
values (date_trunc('week', app_private.cn_date(now()))::date, 2, 0, 0, 0, null, -0.15, 1.85, '{}');
set local session_replication_role = origin;
select tests.call(:'acc', 'select dashboard()') as dash \gset
select is(:'dash'::jsonb -> 'balance', (tests.state() -> 'electronic') - 'new', '账户余额: 活期 + 定期 + 理财本金, as 货币监控');
select is(:'dash'::jsonb -> 'bank_cash', '528', '银行应有现金');
select is(:'dash'::jsonb -> 'payout', tests.state() -> 'payout', '兑付能力');
select is(:'dash'::jsonb -> 'loans', '{"count":2,"remaining":21,"overdue":{"count":1,"remaining":6}}', '贷款余额, the overdue ones apart');
select is(:'dash'::jsonb -> 'stock', '{"qty":13,"cost":16,"uncosted":1}', '文创库存: pieces, cost where known');
select is(:'dash'::jsonb -> 'anchor', jsonb_build_object('week_start', date_trunc('week', app_private.cn_date(now()))::date, 'anchor', 1.85),
  '本周锚点');
select is(:'dash'::jsonb -> 'week', jsonb_build_object('week_start', date_trunc('week', app_private.cn_date(now()))::date, 'count', 15),
  '本周业务笔数: counter business and 补录, not reversed; no 结息、工资、调账、开户、注销、冲正');
select is(jsonb_array_length(:'dash'::jsonb -> 'weeks'), 12, '12 weeks');
select is(array(select (w ->> 'week_start')::date from jsonb_array_elements(:'dash'::jsonb -> 'weeks') w),
  array(select date_trunc('week', app_private.cn_date(now()))::date - 7 * i from generate_series(11, 0, -1) i), 'Mondays, oldest first');
select is(array(select (w ->> 'count')::integer from jsonb_array_elements(:'dash'::jsonb -> 'weeks') w),
  '{0,0,0,0,0,0,0,0,0,0,1,15}', 'the deposit 7 days ago in last week');
select is(tests.call(:'p1', 'select dashboard()'), :'dash'::jsonb, 'the president reads the same');
select is(tests.call(:'admin', 'select dashboard()'), :'dash'::jsonb, 'and the bank admin');

-- The report over the same days gives the same numbers (§19).
select tests.call(:'acc', format('select bank_report(%L, %L)', date_trunc('week', app_private.cn_date(now()))::date, app_private.cn_date(now()))) as rep \gset
select is(:'rep'::jsonb #> '{operations,count}', :'dash'::jsonb #> '{week,count}', 'report: 本周业务笔数');
select is(:'rep'::jsonb #> '{balance,closing}', :'dash'::jsonb #> '{balance,current}', 'report: 活期');
select is(:'rep'::jsonb #> '{holdings,term}', :'dash'::jsonb #> '{balance,term}', 'report: 定期本金');
select is(:'rep'::jsonb #> '{holdings,wealth}', :'dash'::jsonb #> '{balance,wealth}', 'report: 理财本金');
select is(:'rep'::jsonb #> '{holdings,loans}', :'dash'::jsonb #> '{loans,remaining}', 'report: 贷款余额');
select is(:'rep'::jsonb -> 'bank_cash', :'dash'::jsonb -> 'bank_cash', 'report: 银行应有现金');
select is((select sum((p ->> 'closing')::integer) from jsonb_array_elements(:'rep'::jsonb -> 'stock') p), 13::bigint, 'report: 库存件数');
select is((select sum((p ->> 'closing')::integer * (p ->> 'cost')::integer) from jsonb_array_elements(:'rep'::jsonb -> 'stock') p), 16::bigint,
  'report: 库存成本');
select is(tests.call(:'acc', format('select bank_report(%L, %L)', date_trunc('week', app_private.cn_date(now()))::date - 7,
  date_trunc('week', app_private.cn_date(now()))::date - 1)) #> '{operations,count}', '1', 'report: last week''s business');

-- The report's 放款、还款、利息、定期 (§1.2) and 发行.
select is(:'rep'::jsonb -> 'loans', '{"count":2,"amount":30}', 'report: 放款');
select is(:'rep'::jsonb -> 'repays', '{"count":2,"amount":9,"principal":9,"interest":0}', 'report: 还款');
select is(:'rep'::jsonb -> 'interest', '{"count":1,"amount":2}', 'report: 活期结息');
select is(:'rep'::jsonb -> 'terms', '{"open":{"count":2,"amount":150},"close":{"count":1,"amount":100,"interest":0}}',
  'report: 开定期 and 定期转回, the reversed one left out');
select is(:'rep'::jsonb #> '{issues,batches}', jsonb_build_array(jsonb_build_object('batch_no', 'FX-1', 'issued_on', app_private.cn_date(now()),
  'total', 300, 'purpose', '开学发行', 'approver', '王老师', 'denominations', '{"10":30,"5":10}'::jsonb,
  'corrections', '[{"10":-5},{"5":2,"10":-1}]'::jsonb)), 'report: 发行 with its 更正');
select is(:'rep'::jsonb #> '{issues,total}', '300', 'report: issued so far');
select is(tests.call(:'acc', format('select bank_report(%L, %L)', app_private.cn_date(now()) - 20, app_private.cn_date(now()) - 15)) -> 'holdings',
  '{"term":0,"wealth":0,"loans":0}', 'report: nothing held before any of it');

select * from finish();
rollback;
