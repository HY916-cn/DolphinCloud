-- 风险提醒 (PHASE-2.md §12): each kind is raised at its threshold and not below it, once per event; 终止 undoes the
-- event in the same transaction and a failed undo leaves the alert open; 已查看 and 终止 are the bank admin's, each alert
-- handled once, while the president reads; the list and the overview; an alert that cannot be recorded never fails the
-- business.
\ir helpers/setup.psql

select tests.staff('t1', 'teller') as t1 \gset
select tests.staff('t2', 'teller') as t2 \gset
select tests.staff('t3', 'teller') as t3 \gset
select tests.staff('t4', 'teller') as t4 \gset
select tests.staff('t5', 'teller') as t5 \gset
select tests.staff('acc', 'accountant') as acc \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('p1', 'president') as p1 \gset
select tests.staff('admin', 'teacher') as admin \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.student('s1', 500) as s1 \gset
select tests.student('s2', 150) \gset
select tests.student('s3', 0) \gset
select tests.student('s3b', 0) \gset
select tests.student('low', 0) \gset
select tests.student('s5', 0) \gset
select tests.student('s6', 0) \gset
select tests.student('s7', 0) \gset
select tests.student('s8', 500) \gset
select tests.student('s9', 100) \gset
select tests.student('s10', 500) \gset
select tests.student(s, 0) from unnest(array['r1', 'r2', 'r3', 'r4', 'r5', 'r6']) s;

-- The alerts of a kind, and the id of one.
create function tests.n(p_kind text) returns bigint language sql as $$ select count(*) from risk_alerts where kind = p_kind $$;
create function tests.alert(p_kind text, p_target text) returns bigint language sql as $$
  select id from risk_alerts where kind = p_kind and target = p_target
$$;
create function tests.handle(p_user uuid, p_id bigint, p_action text, p_note text default null) returns jsonb language sql as $$
  select tests.call(p_user, format('select handle_alert(%s, %L, %L)', p_id, p_action, p_note))
$$;
-- Within the test's one transaction now() stands still: a student's or a teller's transactions move back by p_by.
create function tests.age(p_student text, p_operator uuid, p_by interval, p_type txn_type default null) returns void language plpgsql as $$
begin
  perform set_config('session_replication_role', 'replica', true);
  update txns set created_at = created_at - p_by
  where (p_student is null or student_no = p_student) and (p_operator is null or operator_id = p_operator) and (p_type is null or type = p_type);
  perform set_config('session_replication_role', 'origin', true);
end $$;

-- 风险阈值 (§14.3) and the limits the tests count on.
select is(app_private.setting('risk_rules'),
  '{"loan_amount":50,"loan_score":600,"withdraw_ratio":80,"reversals":3,"ops_count":5,"ops_minutes":10}', 'risk_rules by default');
select is(tests.call(:'admin', $$select set_setting('risk_rules', '{"loan_amount":50,"loan_score":600,"withdraw_ratio":80,"reversals":3,"ops_count":1,"ops_minutes":10}')$$) ->> 'detail',
  '{"field": "risk_rules"}', 'risk_rules: ops_count is 2 at least');
select is(tests.call(:'admin', $$select set_setting('risk_rules', '{"loan_amount":50,"loan_score":600,"withdraw_ratio":80,"reversals":3,"ops_count":5}')$$) ->> 'detail',
  '{"field": "risk_rules"}', 'every key');
select is(tests.call(:'admin', $$select set_setting('risk_rules', '{"loan_amount":50,"loan_score":600,"withdraw_ratio":101,"reversals":3,"ops_count":5,"ops_minutes":10}')$$) ->> 'detail',
  '{"field": "risk_rules"}', 'withdraw_ratio 1–100');
select is(tests.err(:'p1', $$select set_setting('risk_rules', '{"loan_amount":50,"loan_score":600,"withdraw_ratio":80,"reversals":3,"ops_count":5,"ops_minutes":10}')$$),
  'FORBIDDEN', 'the president does not set it');
select tests.call(:'admin', $$select set_setting('risk_rules', '{"loan_amount":50,"loan_score":600,"withdraw_ratio":80,"reversals":3,"ops_count":5,"ops_minutes":10}')$$);
select is(tests.n('setting_change'), 0::bigint, 'saving the same value raises nothing');
select tests.call(:'admin', $$select set_settings('{"withdraw_single_limit":{"primary":100,"junior":100},"withdraw_daily_limit":{"primary":1000,"junior":1000}}')$$);

-- setting_change: each parameter that changes, with the value before and after.
select tests.alert('setting_change', 'settings:withdraw_single_limit') as limit_alert \gset
select is((select row(staff_id, detail, status, student_no)::text from risk_alerts where id = :limit_alert),
  row(:'admin'::uuid, (jsonb_build_object('key', 'withdraw_single_limit', 'before', '{"primary":200,"junior":200}'::jsonb,
    'after', '{"primary":100,"junior":100}'::jsonb)), 'open', null::text)::text, 'a limit change: who, before, after');
select is(tests.n('setting_change'), 2::bigint, 'one alert for each setting changed');
select is(tests.call(:'admin', format($$select handle_alert(%s, 'seen', ' 已核实 ')$$, :limit_alert)) #>> '{alert,note}', '已核实',
  '已查看 with a note');

-- withdraw_large: above 80% of the 单笔限额 of the student's division.
select tests.call(:'t1', $$select withdraw('00000000-0000-4000-8000-000000000101', 's1', 80)$$);
select is(tests.n('withdraw_large'), 0::bigint, '80% of the limit raises nothing');
select tests.call(:'t1', $$select withdraw('00000000-0000-4000-8000-000000000102', 's1', 81)$$);
select tests.alert('withdraw_large', 'txns:00000000-0000-4000-8000-000000000102') as w1 \gset
select is((select row(student_no, staff_id, detail ->> 'amount', detail ->> 'limit', detail ->> 'ratio')::text from risk_alerts where id = :w1),
  row('s1', :'t1'::uuid, '81', '100', '80')::text, 'above it: the student, the teller, the amount and the limit');
select is(tests.call(:'t1', $$select withdraw('00000000-0000-4000-8000-000000000102', 's1', 81)$$) ->> 'txn_no',
  (select txn_no from txns where id = '00000000-0000-4000-8000-000000000102'), 'the same withdrawal again');
select is(tests.n('withdraw_large'), 1::bigint, 'raises no second alert');

-- Who handles.
select is(tests.err(w, format($$select handle_alert(%s, 'seen')$$, :w1)), 'FORBIDDEN', 'not ' || r)
from (values (:'t1'::uuid, 'a teller'), (:'acc'::uuid, 'the accountant'), (:'keeper'::uuid, 'the storekeeper'), (:'s1'::uuid, 'a student')) v(w, r);
select is(tests.call(:'p1', format($$select handle_alert(%s, 'seen')$$, :w1)), '{"error":"FORBIDDEN","detail":"{\"roles\": [\"teacher\", \"sysadmin\"]}"}',
  'the president does not mark an alert 已查看');
select is(tests.call(:'p1', format($$select handle_alert(%s, 'terminate', '家长未同意')$$, :w1)), '{"error":"FORBIDDEN","detail":"{\"roles\": [\"teacher\", \"sysadmin\"]}"}',
  'nor terminates it');
select is(tests.err(:'ops', format($$select handle_alert(%s, 'seen')$$, :w1)), 'FORBIDDEN', 'nor does the sysadmin');
select is((select row(status, handled_by)::text from risk_alerts where id = :w1), row('open', null::uuid)::text, 'the alert stays open');
select is(tests.call(:'acc', $$select to_jsonb(count(*)) from risk_alerts$$), '0', 'the accountant reads no alert');
select is(tests.call(:'p1', $$select to_jsonb(count(*)) from risk_alerts$$), to_jsonb((select count(*) from risk_alerts)), 'the president reads them all');
select is(tests.handle(:'admin', :w1, 'close') ->> 'detail', '{"field": "action"}', 'seen or terminate');
select is(tests.handle(:'admin', 0, 'seen') ->> 'detail', '{"field": "id"}', 'an alert that exists');
select is(tests.handle(:'admin', :w1, 'terminate', '  ') ->> 'detail', '{"field": "note"}', '终止 needs a reason');
select is(tests.handle(:'admin', :w1, 'terminate', repeat('长', 201)) ->> 'detail', '{"field": "note"}', 'of 200 characters at most');

-- 终止 a large withdrawal: reversed, by the bank admin, outside any duty.
select tests.handle(:'admin', :w1, 'terminate', '家长未同意') as w1_done \gset
select is(row(:'w1_done'::jsonb #>> '{alert,status}', :'w1_done'::jsonb #>> '{alert,handled_by}', :'w1_done'::jsonb #>> '{alert,handler_name}',
    :'w1_done'::jsonb #>> '{alert,note}', (:'w1_done'::jsonb #>> '{alert,handled_at}')::timestamptz = now())::text,
  row('terminated', :'admin', 'admin', '家长未同意', true)::text, '终止: handled by the bank admin, with the reason');
select is((select row(r.type, r.reason, r.operator_id, o.status)::text from txns r join txns o on o.id = r.reversal_of
    where o.id = '00000000-0000-4000-8000-000000000102'),
  row('reversal', '其他：家长未同意', :'admin'::uuid, 'reversed')::text, 'the withdrawal is reversed with the reason');
select is((select balance from accounts where student_no = 's1'), 420, 'and the 81 HTB are back');
select is(tests.handle(:'admin', :w1, 'terminate', '再次') ->> 'error', 'ALERT_HANDLED', 'handled once: no 终止 again');
select is((tests.handle(:'admin', :w1, 'seen') ->> 'detail')::jsonb - 'handled_at', '{"status":"terminated","handler_name":"admin"}',
  'or 已查看 after it, says who did what');
select is(tests.handle(:'admin', :limit_alert, 'seen') ->> 'detail', format('{"status": "seen", "handled_at": "%s", "handler_name": "admin"}',
    to_jsonb(now()) #>> '{}'), 'nor 已查看 twice');

-- A failed undo leaves the alert open: the teller reversed the withdrawal first.
select tests.call(:'t1', $$select withdraw('00000000-0000-4000-8000-000000000103', 's1', 90)$$);
select tests.alert('withdraw_large', 'txns:00000000-0000-4000-8000-000000000103') as w2 \gset
select tests.call(:'t1', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000103', '金额录错')$$);
select is(tests.handle(:'admin', :w2, 'terminate', '大额') ->> 'error', 'REVERSAL_NOT_ALLOWED', '终止 says why it failed');
select is((select row(status, handled_by, note)::text from risk_alerts where id = :w2), row('open', null::uuid, null::text)::text,
  'and the alert stays open');
select is(tests.handle(:'admin', :w2, 'seen') #>> '{alert,status}', 'seen', 'it can still be marked 已查看');

-- term_early: every 提前支取 at the counter; 终止 reverses it and the deposit is open again.
select tests.call(:'t1', $$select open_term_deposit('00000000-0000-4000-8000-000000000201', 's2', 100, 2)$$);
select is(tests.n('term_early'), 0::bigint, 'opening a deposit raises nothing');
select tests.call(:'t1', $$select withdraw_term_early('00000000-0000-4000-8000-000000000201')$$) #>> '{id}' as early \gset
select tests.alert('term_early', 'txns:' || :'early') as e1 \gset
select is((select row(student_no, staff_id, detail ->> 'amount', detail ->> 'principal')::text from risk_alerts where id = :e1),
  row('s2', :'t1'::uuid, '100', '100')::text, '提前支取: the student, the teller, the amount');
select tests.call(:'t1', $$select withdraw(gen_random_uuid(), 's2', 80)$$);
select is(tests.handle(:'admin', :e1, 'terminate', '误操作') ->> 'error', 'REVERSAL_INSUFFICIENT_BALANCE', '终止 fails while 活期 is short');
select is((select row(a.status, d.status)::text from risk_alerts a, term_deposits d where a.id = :e1 and d.id = '00000000-0000-4000-8000-000000000201'),
  row('open', 'early')::text, 'the alert stays open and the deposit closed');
select tests.call(:'t1', $$select deposit(gen_random_uuid(), 's2', '{"10":5}')$$);
select is(tests.handle(:'admin', :e1, 'terminate', '误操作') #>> '{alert,status}', 'terminated', 'with enough 活期 it is terminated');
select is((select row(d.status, a.balance, a.term_total)::text from term_deposits d, accounts a
    where d.id = '00000000-0000-4000-8000-000000000201' and a.student_no = 's2'),
  row('open', 20, 100)::text, 'the deposit is open again');

-- loan_large: above 50 HTB, or lent below 600 points.
select tests.call(:'t1', $$select open_loan('00000000-0000-4000-8000-000000000301', 's3b', 50, '买书', 'bullet', 1, 'account')$$);
select is(tests.n('loan_large'), 0::bigint, '50 HTB at 600 points raises nothing');
select tests.call(:'t1', $$select open_loan('00000000-0000-4000-8000-000000000302', 's3', 51, '买书', 'installment', 2, 'account')$$);
select tests.alert('loan_large', 'loans:00000000-0000-4000-8000-000000000302') as l1 \gset
select is((select row(student_no, staff_id, detail ->> 'amount', detail ->> 'score')::text from risk_alerts where id = :l1),
  row('s3', :'t1'::uuid, '51', '600')::text, 'above 50 HTB');
update credit_scores set score = 599 where student_no = 'low';
select tests.call(:'t1', $$select open_loan('00000000-0000-4000-8000-000000000303', 'low', 10, '买书', 'bullet', 1, 'account')$$);
select tests.alert('loan_large', 'loans:00000000-0000-4000-8000-000000000303') as l2 \gset
select is((select detail ->> 'score' from risk_alerts where id = :l2), '599', 'or below 600 points');
select is(tests.handle(:'admin', :l1, 'terminate', '额度过大') #>> '{result,loan,status}', 'closed', '终止: 提前到期');
select is((select row(status, terminated_by, terminate_reason)::text from loans where id = '00000000-0000-4000-8000-000000000302'),
  row('closed', :'admin'::uuid, '额度过大')::text, 'the loan is terminated with the reason');
select loan_txn as low_txn from loans where id = '00000000-0000-4000-8000-000000000303' \gset
select is(tests.call(:'t1', format($$select reverse_txn(gen_random_uuid(), %L, '业务选错')$$, :'low_txn')) ->> 'type', 'reversal', 'the teller reverses the loan');
select is(tests.handle(:'admin', :l2, 'terminate', '分数低') ->> 'detail', '{"field": "loan_id", "status": "reversed"}',
  'a reversed loan is not terminated');
select is((select status from risk_alerts where id = :l2), 'open', 'and the alert stays open');

-- loan_overdue: the first time a loan falls overdue.
select app_private.mark_overdue('00000000-0000-4000-8000-000000000301', (select due_on from loan_periods where loan_id = '00000000-0000-4000-8000-000000000301'), now());
select app_private.mark_overdue('00000000-0000-4000-8000-000000000301', (select due_on from loan_periods where loan_id = '00000000-0000-4000-8000-000000000301') + 1, now());
select tests.alert('loan_overdue', 'loans:00000000-0000-4000-8000-000000000301') as l3 \gset
select is((select row(student_no, staff_id, detail ->> 'remaining', detail ->> 'seq')::text from risk_alerts where id = :l3),
  row('s3b', null::uuid, '50', '1')::text, 'overdue: the student, the remaining principal and the period');
select is(tests.n('loan_overdue'), 1::bigint, 'once');
select is(tests.handle(:'admin', :l3, 'terminate', '逾期') #>> '{result,loan,status}', 'closed', '终止: 提前到期');

-- reversal_many: a teller's 3rd 冲正 of a day on, each; 终止 forces the teller off duty.
select tests.call(:'t2', format($$select deposit(%L, %L, '{"10":1}')$$, '00000000-0000-4000-8000-00000000040' || i, 'r' || i))
from generate_series(1, 6) i;
select tests.call(:'t2', format($$select reverse_txn(gen_random_uuid(), %L, '金额录错')$$, '00000000-0000-4000-8000-00000000040' || i))
from generate_series(1, 2) i;
select tests.age(null, :'t2', '1 day', 'reversal');
select tests.call(:'t2', format($$select reverse_txn(gen_random_uuid(), %L, '金额录错')$$, '00000000-0000-4000-8000-00000000040' || i))
from generate_series(3, 4) i;
select is(tests.n('reversal_many'), 0::bigint, 'the day before''s do not count: 2 today raise nothing');
select tests.call(:'t2', $$select reverse_txn('00000000-0000-4000-8000-000000000415', '00000000-0000-4000-8000-000000000405', '金额录错')$$);
select tests.alert('reversal_many', 'txns:00000000-0000-4000-8000-000000000415') as v1 \gset
select is((select row(student_no, staff_id, detail ->> 'count', detail ->> 'duty_id', detail ->> 'original_no')::text from risk_alerts where id = :v1),
  row('r5', :'t2'::uuid, '3', (select id from duty where user_id = :'t2')::text, (select txn_no from txns where id = '00000000-0000-4000-8000-000000000405'))::text,
  'the 3rd: the teller, the count and the duty');
select tests.call(:'t2', $$select reverse_txn('00000000-0000-4000-8000-000000000416', '00000000-0000-4000-8000-000000000406', '金额录错')$$);
select tests.alert('reversal_many', 'txns:00000000-0000-4000-8000-000000000416') as v2 \gset
select is((select detail ->> 'count' from risk_alerts where id = :v2), '4', 'and the 4th');
select tests.call(:'admin', $$select reverse_txn(gen_random_uuid(), '00000000-0000-4000-8000-000000000101', '金额录错')$$);
select is(tests.n('reversal_many'), 2::bigint, 'the bank admin''s 冲正 do not count');
select is(tests.handle(:'admin', :v1, 'terminate', '冲正过多') #>> '{result,status}', 'forced', '终止: the teller is forced off duty');
select is((select row(d.ended_at is not null, c.status, c.forced_by, c.forced_reason)::text from duty d join cash_counts c on c.duty_id = d.id
    where d.user_id = :'t2'), row(true, 'forced', :'admin'::uuid, '冲正过多')::text, '轧账 shows 强制下班 by the bank admin');
select is(tests.err(:'t2', $$select deposit(gen_random_uuid(), 'r1', '{"10":1}')$$), 'OFF_DUTY', 'the teller must start a new duty');
select is(tests.handle(:'admin', :v2, 'terminate', '冲正过多') ->> 'detail', '{"field": "duty_id", "status": "forced"}',
  'a duty already ended is not forced again');
select is((select status from risk_alerts where id = :v2), 'open', 'and that alert stays open');

-- ops_frequent: a student's 5th transaction at the counter within 10 minutes, once a window.
select tests.call(:'t3', $$select deposit(gen_random_uuid(), 's6', '{"1":1}')$$) from generate_series(1, 4);
select tests.age('s6', null, '11 minutes');
select tests.call(:'t3', $$select deposit(gen_random_uuid(), 's6', '{"1":1}')$$) from generate_series(1, 4);
select is(tests.n('ops_frequent'), 0::bigint, '4 within 10 minutes raise nothing');
select tests.call(:'t3', $$select deposit('00000000-0000-4000-8000-000000000501', 's6', '{"1":1}')$$);
select tests.alert('ops_frequent', 'txns:00000000-0000-4000-8000-000000000501') as o1 \gset
select is((select row(student_no, staff_id, detail ->> 'count', detail ->> 'minutes', detail ->> 'duty_id')::text from risk_alerts where id = :o1),
  row('s6', :'t3'::uuid, '5', '10', (select id from duty where user_id = :'t3')::text)::text, 'the 5th: the student, the teller, the duty');
select tests.call(:'t3', $$select deposit(gen_random_uuid(), 's6', '{"1":1}')$$);
select is(tests.n('ops_frequent'), 1::bigint, 'the 6th within the window raises no other');
select is(tests.handle(:'admin', :o1, 'terminate', '代他人办理') #>> '{result,status}', 'forced', '终止 forces the teller off duty');

-- credit_adjust: 终止 records the opposite change; the 信用分开关 is credit_switch, 已查看 only.
select tests.call(:'admin', $$select adjust_credit('s7', 30, '表现好')$$);
select (select id from risk_alerts where kind = 'credit_adjust' and student_no = 's7') as c1 \gset
select is((select row(staff_id, detail ->> 'delta', detail ->> 'score', detail ->> 'reason')::text from risk_alerts where id = :c1),
  row(:'admin'::uuid, '30', '630', '银行管理员调整：表现好')::text, 'a manual change: by whom, how much');
select tests.handle(:'admin', :c1, 'terminate', '依据不足') as c1_done \gset
select is(row(:'c1_done'::jsonb #>> '{result,event,delta}', :'c1_done'::jsonb #>> '{result,event,ref}', :'c1_done'::jsonb #>> '{result,credit,score}')::text,
  row('-30', 'risk_alerts:' || :c1, '600')::text, '终止 takes it back');
select is((select reason from credit_events where ref = 'risk_alerts:' || :c1), '风险提醒终止：依据不足', 'with the reason');
select is(tests.n('credit_adjust'), 1::bigint, 'and raises no alert of its own');
select tests.call(:'admin', $$select adjust_credit('s7', -20, '迟到')$$);
select (select max(id) from risk_alerts where kind = 'credit_adjust') as c2 \gset
select tests.call(:'admin', $$select set_credit_enabled(false, '期末维护')$$);
select (select max(id) from risk_alerts where kind = 'credit_switch') as sw \gset
select is((select row(target, staff_id, detail - 'students', detail ? 'students')::text from risk_alerts where id = :sw),
  row('settings:credit_enabled', :'admin'::uuid, '{"reason": "期末维护", "enabled": false}'::jsonb, true)::text,
  '信用分 turned off: credit_switch with the reason');
select is(tests.handle(:'admin', :c2, 'terminate', '依据不足') ->> 'error', 'CREDIT_DISABLED', 'no 终止 of a change while 信用分 is off');
select is((select status from risk_alerts where id = :c2), 'open', 'it stays open');
select is(tests.handle(:'admin', :sw, 'terminate', '恢复') ->> 'detail', '{"kind": "credit_switch", "field": "action"}', 'a switch is not terminated');
select tests.call(:'admin', $$select set_credit_enabled(true, null)$$);
select is(tests.n('credit_switch'), 2::bigint, 'turning it on is another');
select is(tests.handle(:'admin', :c2, 'terminate', '依据不足') #>> '{result,credit,score}', '600', 'on again, the change is taken back');

-- setting_change: 终止 restores the value before while it is still the one recorded.
select app_private.setting('term_rates') as rates0 \gset
select tests.call(:'admin', $$select set_setting('term_rates', '{"2":3,"4":3,"12":3,"24":3,"48":3}')$$);
select (select max(id) from risk_alerts where target = 'settings:term_rates') as r1 \gset
select tests.call(:'admin', $$select set_setting('term_rates', '{"2":4,"4":4,"12":4,"24":4,"48":4}')$$);
select (select max(id) from risk_alerts where target = 'settings:term_rates') as r2 \gset
select is(tests.handle(:'admin', :r1, 'terminate', '未经讨论') ->> 'detail', '{"key": "term_rates"}', 'changed again since: ALERT_OUTDATED');
select is((select status from risk_alerts where id = :r1), 'open', 'and stays open');
select is(tests.handle(:'admin', :r2, 'terminate', '未经讨论') #>> '{result,value}', '{"2": 3, "4": 3, "12": 3, "24": 3, "48": 3}', 'the latest goes back one');
select is(app_private.setting('term_rates'), '{"2":3,"4":3,"12":3,"24":3,"48":3}', 'saved');
select is(tests.handle(:'admin', :r1, 'terminate', '未经讨论') #>> '{alert,status}', 'terminated', 'then the first');
select is(app_private.setting('term_rates'), :'rates0'::jsonb, 'back to where it was');
select is((select count(*) from risk_alerts where target = 'settings:term_rates'), 2::bigint, 'restoring raises no alert');
select app_private.salary_rates() as pay0 \gset
select tests.call(:'admin', format('select set_salary_rates(%L)', (select jsonb_object_agg(role, jsonb_build_object('am', (r ->> 'am')::integer + 1, 'pm', r -> 'pm'))
  from jsonb_each(:'pay0'::jsonb) e(role, r))));
select tests.alert('setting_change', 'salary_rates') as pay \gset
select is((select detail -> 'before' from risk_alerts where id = :pay), :'pay0'::jsonb, '工资标准 too, the whole table');
select tests.call(:'admin', format('select set_salary_rates(%L)', (select detail -> 'after' from risk_alerts where id = :pay)));
select is((select count(*) from risk_alerts where target = 'salary_rates'), 1::bigint, 'the same table again raises nothing');
select tests.handle(:'admin', :pay, 'terminate', '暂不调整');
select is(app_private.salary_rates(), :'pay0'::jsonb, '终止 restores it');

-- stock_low: falling to the 安全库存; once while open.
select tests.call(:'keeper', $$select upsert_product(null, '海豚书签', 7, p_listed => true)$$) ->> 'id' as pen \gset
select tests.call(:'keeper', format($$select stock_in(%L, 11)$$, :'pen'));
select tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's8', %L, 'account')$$, jsonb_build_array(jsonb_build_object('product_id', :'pen', 'qty', 5))));
select is(tests.n('stock_low'), 0::bigint, 'above the 安全库存 raises nothing');
select tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's8', %L, 'account')$$, jsonb_build_array(jsonb_build_object('product_id', :'pen', 'qty', 1))));
select tests.alert('stock_low', 'products:' || :'pen') as k1 \gset
select is((select detail from risk_alerts where id = :k1), '{"name": "海豚书签", "stock": 5, "safety_stock": 5}', 'at it: the product and the stock');
select tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's8', %L, 'account')$$, jsonb_build_array(jsonb_build_object('product_id', :'pen', 'qty', 1))));
select tests.call(:'keeper', format($$select stock_in(%L, 10)$$, :'pen'));
select tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's10', %L, 'account')$$, jsonb_build_array(jsonb_build_object('product_id', :'pen', 'qty', 10))));
select is(tests.n('stock_low'), 1::bigint, 'falling again while it is open raises no other');
select is(tests.handle(:'admin', :k1, 'terminate', '补货') ->> 'detail', '{"kind": "stock_low", "field": "action"}', 'stock_low: 已查看 only');
select tests.handle(:'admin', :k1, 'seen');
select tests.call(:'keeper', format($$select stock_in(%L, 10)$$, :'pen'));
select tests.call(:'t1', format($$select purchase(gen_random_uuid(), 's10', %L, 'account')$$, jsonb_build_array(jsonb_build_object('product_id', :'pen', 'qty', 10))));
select is(tests.n('stock_low'), 2::bigint, 'after 已查看 the next fall is another');

-- cash_unbalanced: the teller's count, or the count at review, unlike the expected; one per duty.
select id as d4 from duty where user_id = :'t4' \gset
select id as d5 from duty where user_id = :'t5' \gset
select tests.call(:'t4', $$select end_duty(0, '{"10":1}', '多一张 10 元')$$);
select tests.call(:'t5', $$select end_duty(0, '{}')$$);
select is((select row(target, staff_id, detail ->> 'by', detail #>> '{diff,10}', detail ->> 'note')::text from risk_alerts where kind = 'cash_unbalanced'),
  row('duty:' || :'d4', :'t4'::uuid, 'teller', '1', '多一张 10 元')::text, '下班 unbalanced: the teller''s count; balanced raises nothing');
select tests.call(:'acc', format($$select review_cash_count(%L, '{"1":2}', '盒里多 2 元')$$, :'d5'));
select tests.call(:'acc', format($$select review_cash_count(%L, '{"10":2}', '又多一张')$$, :'d4'));
select is(array(select concat_ws(' ', target, detail ->> 'by') from risk_alerts where kind = 'cash_unbalanced' order by id),
  array['duty:' || :'d4' || ' teller', 'duty:' || :'d5' || ' review'], 'the review''s count too, once per duty');
select is(tests.handle(:'admin', tests.alert('cash_unbalanced', 'duty:' || :'d5'), 'terminate', 'x') ->> 'detail',
  '{"kind": "cash_unbalanced", "field": "action"}', 'cash_unbalanced: 已查看 only');

-- manual_entry and txn_correct (§10.11): each 补录 and each 更正, 已查看 only.
select tests.call(:'admin', $$select manual_entry('00000000-0000-4000-8000-000000000601', 's9', 'adjust', now(), '11月系统故障', 10)$$);
select tests.alert('manual_entry', 'txns:00000000-0000-4000-8000-000000000601') as m1 \gset
select is((select row(student_no, staff_id, detail ->> 'type', detail ->> 'amount', detail ->> 'reason')::text from risk_alerts where id = :m1),
  row('s9', :'admin'::uuid, 'adjust', '10', '补录：11月系统故障')::text, '补录: the student, the bank admin, what was entered');
select tests.call(:'admin', $$select correct_txn('00000000-0000-4000-8000-000000000602', '00000000-0000-4000-8000-000000000601', '{"amount":12}', '金额录错')$$);
select tests.alert('txn_correct', 'txns:00000000-0000-4000-8000-000000000601') as m2 \gset
select is((select row(detail ->> 'txn_no', detail ->> 'original_no', detail ->> 'amount')::text from risk_alerts where id = :m2),
  row((select txn_no from txns where id = '00000000-0000-4000-8000-000000000602'), (select txn_no from txns where id = '00000000-0000-4000-8000-000000000601'), '12')::text,
  '更正: the new transaction and the original');
select is(tests.n('manual_entry'), 1::bigint, 'the correction is not a 补录 too');
select is(tests.handle(:'admin', :m2, 'terminate', 'x') ->> 'detail', '{"kind": "txn_correct", "field": "action"}', 'txn_correct: 已查看 only');

-- Recording never fails the business: a threshold that cannot be read skips the alert.
update settings set value = '{"withdraw_ratio":"x"}' where key = 'risk_rules';
select ok(tests.call(:'t1', $$select withdraw(gen_random_uuid(), 's10', 95)$$) ? 'txn_no', 'the withdrawal goes through');
select is(tests.n('withdraw_large'), 2::bigint, 'without an alert');
update settings set value = '{"loan_amount":50,"loan_score":600,"withdraw_ratio":80,"reversals":3,"ops_count":5,"ops_minutes":10}' where key = 'risk_rules';

-- The 风险提醒 page and the overview.
select is(tests.err(w, 'select list_risk_alerts()'), 'FORBIDDEN', 'the list: not ' || r)
from (values (:'t1'::uuid, 'a teller'), (:'acc'::uuid, 'the accountant')) v(w, r);
select is(tests.err(:'acc', 'select risk_alert_overview()'), 'FORBIDDEN', 'nor the overview');
select is(jsonb_array_length(tests.call(:'p1', 'select list_risk_alerts()')), (select count(*)::integer from risk_alerts), 'every alert');
select is(jsonb_path_query_array(tests.call(:'p1', 'select list_risk_alerts(p_limit => 3)'), '$[*].id'),
  (select jsonb_agg(id order by id desc) from (select id from risk_alerts order by id desc limit 3) a), 'newest first, p_limit at a time');
select is(jsonb_path_query_array(tests.call(:'p1', format('select list_risk_alerts(p_before => %s, p_limit => 2)', :c2)), '$[*].id'),
  (select jsonb_agg(id order by id desc) from (select id from risk_alerts where id < :c2 order by id desc limit 2) a), 'below p_before');
select is(tests.call(:'p1', $$select list_risk_alerts(array['terminated'], array['withdraw_large'])$$) -> 0,
  (select app_private.risk_alert_json(a) from risk_alerts a where id = :w1), 'by status and kind, each with its names');
select is(tests.call(:'p1', $$select list_risk_alerts(array['terminated'], array['withdraw_large'])$$) #>> '{0,student_name}', '学生s1', 'the student''s name');
select is(tests.call(:'p1', format('select list_risk_alerts(p_from => %L)', app_private.cn_date(now()) + 1)), '[]', 'by day');
select is(jsonb_array_length(tests.call(:'p1', format('select list_risk_alerts(p_from => %1$L, p_to => %1$L)', app_private.cn_date(now())))),
  (select count(*)::integer from risk_alerts), 'today''s');
select is(tests.call(:'p1', $$select list_risk_alerts(array['done'])$$) ->> 'detail', '{"field": "status"}', 'statuses open, seen, terminated');
select is(tests.call(:'p1', $$select list_risk_alerts(p_kind => array['big'])$$) ->> 'detail', '{"field": "kind"}', 'the kinds of §12.1');
select is(tests.call(:'p1', $$select list_risk_alerts(p_limit => 201)$$) ->> 'detail', '{"field": "limit"}', 'p_limit 1–200');
select tests.call(:'p1', 'select risk_alert_overview()') as ov \gset
select is(row(:'ov'::jsonb -> 'open', jsonb_path_query_array(:'ov'::jsonb, '$.recent[*].id'))::text,
  row(to_jsonb((select count(*) from risk_alerts where status = 'open')),
    (select jsonb_agg(id order by id desc) from (select id from risk_alerts where status = 'open' order by id desc limit 5) a))::text,
  'the overview, the president''s too: how many are open and the newest 5 of them');
select is((select count(*) from audit_log where target = 'risk_alerts:' || :w1 and action = 'risk_alerts.update'), 1::bigint, 'each handling is logged');

select * from finish();
rollback;
