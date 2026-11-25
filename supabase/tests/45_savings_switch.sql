-- 活期计息开关 (PHASE-2.md §9.3, §9.5, §10.11, §14.3, §16.4): who may turn it, the log and the setting_change alert
-- whose 终止 turns it back, every turn kept; a day accrues at 0 when the switch is off at its end, on time and caught
-- up alike; 结息 goes on; 补录 and 提前支取 read the same days the same way; public_rates and interest_profile say so.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.student('s1', 0) as s1 \gset
select app_private.cn_date(now()) as today \gset

create function tests.turn(p_on boolean) returns jsonb language sql as $$
  select tests.call((select id from profiles where login_id = 'teacher'), format('select set_savings_interest_enabled(%L)', p_on))
$$;

-- Who turns it (§3): the bank admin alone; set_setting does not take the key.
select is(tests.err(w, 'select set_savings_interest_enabled(false)'), 'FORBIDDEN', 'refused')
from unnest(array[:'president', :'accountant', :'teller', :'s1']::uuid[]) w;
select is(tests.call(:'teacher', 'select set_savings_interest_enabled(null)') ->> 'detail', '{"field": "enabled"}', 'on or off');
select is(tests.call(:'teacher', $$select set_setting('savings_interest_enabled', 'false')$$) ->> 'detail', '{"field": "key"}',
  'set_setting refuses the key');
select is(app_private.setting('savings_interest_enabled'), 'true', 'on from the start');
select ok(app_private.savings_interest_on(:'today'), 'and so every day before the first turn');

savepoint turning;
select is(tests.turn(true), '{"enabled":true,"changed":false}', 'turning it on while on changes nothing');
select is((select count(*)::int from audit_log where action = 'interest.switch')
  + (select count(*)::int from risk_alerts where target = 'settings:savings_interest_enabled')
  + (select count(*)::int from savings_interest_switches), 0, 'no log, alert or turn');

select is(tests.turn(false), '{"enabled":false,"changed":true}', 'turned off');
select is((select array[value::text, (updated_by = :'teacher')::text] from settings where key = 'savings_interest_enabled'),
  array['false', 'true'], 'the setting, by the bank admin');
select is((select array_agg(concat_ws(' ', enabled, actor_id = :'teacher')) from savings_interest_switches), array['f t'], 'one turn kept');
select is((select concat_ws(' ', before, after) from audit_log where action = 'interest.switch'), '{"enabled": true} {"enabled": false}', 'logged');
select is((select concat_ws(' ', kind, staff_id = :'teacher', detail) from risk_alerts where target = 'settings:savings_interest_enabled'),
  'setting_change t {"key": "savings_interest_enabled", "after": false, "before": true}', 'a setting_change alert');
select is(tests.turn(false), '{"enabled":false,"changed":false}', 'off again changes nothing');
select is((select count(*)::int from risk_alerts where target = 'settings:savings_interest_enabled'), 1, 'and alerts nothing');

-- §16.4, §15: off today, 活期 is 0 on the board and for the student; the anchor and loans as before.
select is(public_rates() -> 'savings_enabled', 'false', 'public_rates says it is off');
select is(public_rates() -> 'current', '0', 'with 活期 at 0');
select is(public_rates() -> 'scores' -> 0 -> 'loan', to_jsonb(app_private.loan_rate(app_private.anchor_on(:'today'), 600)),
  'the loan rates as before');
select tests.call(:'s1', 'select interest_profile()') as profile \gset
select is(array[:'profile'::jsonb ->> 'savings_enabled', :'profile'::jsonb #>> '{rates,current}', :'profile'::jsonb ->> 'anchor'],
  array['false', '0', app_private.anchor_on(:'today')::text], 'interest_profile: off, 活期 0, the week''s anchor');

-- 终止 of the alert turns it back on, and that is a turn too.
select is(tests.call(:'teacher', format('select handle_alert(%s, ''terminate'', ''误操作'') -> ''result''',
  (select id from risk_alerts where target = 'settings:savings_interest_enabled'))),
  '{"key":"savings_interest_enabled","value":true}', '终止 turns it back on');
select is((select array_agg(enabled order by at, id) from savings_interest_switches), array[false, true], 'two turns kept');
select is(public_rates() -> 'savings_enabled', 'true', 'public_rates on again');
select is((public_rates() ->> 'current')::numeric, app_private.saving_rate(app_private.anchor_on(:'today'), 600),
  'at the anchor');
select is(tests.call(:'s1', 'select interest_profile()') #>> '{rates,current}', app_private.saving_rate(app_private.anchor_on(:'today'), 600)::text,
  'and for the student');
rollback to savepoint turning;

-- The days (§9.3, §13). One anchor (2%); a and b opened 25 days ago with 100 HTB. The switch is turned off at noon 8 days
-- ago and on at noon 4 days ago: the days 8 to 5 days ago end with it off.
update settings set value = value || '{"initial":2,"min":2,"max":2}' where key = 'anchor_params';
create function tests.noon(p_day date) returns timestamptz language sql as $$ select (p_day + time '12:00') at time zone 'Asia/Shanghai' $$;
create function tests.old(p_no text, p_opened date) returns void language plpgsql as $$
begin
  perform tests.student(p_no, 0);
  update students set opened_at = (p_opened + time '08:00') at time zone 'Asia/Shanghai' where student_no = p_no;
  update accounts set balance = 100, total_in = 100 where student_no = p_no;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
  values (gen_random_uuid(), 'opening', p_no, 100, 100, 100, (select id from profiles where login_id = 'teacher'), tests.noon(p_opened));
end $$;
create function tests.state() returns text language sql as $$
  select concat_ws(' | ',
    (select string_agg(concat_ws(' ', student_no, day, balance, rate, centi, (select created_at from txns where id = settled_txn)), ', '
       order by student_no, day) from interest_accruals),
    (select string_agg(concat_ws(' ', student_no, amount, balance_after, created_at, reason), ', ' order by student_no, created_at)
       from txns where type = 'interest'),
    (select string_agg(concat_ws(' ', student_no, interest_carry, balance), ', ' order by student_no) from accounts))
$$;
create temp table turns (at timestamptz, enabled boolean);
insert into turns values (tests.noon(:'today'::date - 8), false), (tests.noon(:'today'::date - 4), true);
select tests.old(n, :'today'::date - 25) from unnest(array['a', 'b']) n;
update job_runs set done_to = :'today'::date - 15, last_ok = null, last_err = null;

-- Every day on time, each turn made when it was; then the same days caught up at once with both turns already made.
savepoint every_day;
do $$
declare d date;
begin
  for d in select generate_series(app_private.cn_date(now()) - 14, app_private.cn_date(now()), interval '1 day') loop
    insert into savings_interest_switches (at, enabled) select at, enabled from turns where at < d::timestamp at time zone 'Asia/Shanghai' and at >= (d - 1)::timestamp at time zone 'Asia/Shanghai';
    perform app_private.run_jobs(d);
  end loop;
end $$;
select tests.state() as every_day \gset
rollback to savepoint every_day;
insert into savings_interest_switches (at, enabled) select at, enabled from turns;
select is(app_private.run_jobs(:'today') -> 'failed', 'null', 'catching up fourteen days at once');
select is(tests.state(), :'every_day', 'gives the same accruals, 结息 and balances as every day on time');

select is(array(select concat_ws(' ', day - :'today'::date, rate) from interest_accruals where student_no = 'a' and day >= :'today'::date - 9 order by day),
  array['-9 2.0000', '-8 0.0000', '-7 0.0000', '-6 0.0000', '-5 0.0000', '-4 2.0000', '-3 2.0000', '-2 2.0000', '-1 2.0000'],
  'the days ending off have their rows at 0; the day it was turned on accrues');
select is((select count(*)::int from interest_accruals where rate = 0 and centi <> 0), 0, 'and no interest');
select ok((select count(*) from txns where type = 'interest') > 0, '结息 goes on, paying what was accrued');

-- 补录 (§10.11): a deposit at noon 10 days ago is worked out again on every accrued day at its own rate, 0 on the off days.
select (tests.call(:'teacher', format('select manual_entry(%L, ''a'', ''deposit'', %L, ''系统故障，柜台手写登记'', null, null, ''{"10":5}'')',
  gen_random_uuid(), tests.noon(:'today'::date - 10))) ->> 'id') is not null as entered \gset
select ok(:'entered', 'a 补录');
select is((select coalesce(sum(j.centi), 0)::int from interest_adjustments j join interest_accruals a using (student_no, day) where a.rate = 0), 0,
  'nothing on the off days');
select is((select array_agg(day - :'today'::date order by day) from interest_adjustments where centi > 0), array[-10, -9, -4, -3, -2, -1],
  'about 50 × 2 ÷ 7 = 0.14 more on each of the six days at 2%');
select is(count(*)::int, 0, 'every accrued day: its accrual and corrections = ⌊活期 at its end × its rate ÷ 7⌋')
from interest_accruals a
where a.centi + coalesce((select sum(j.centi) from interest_adjustments j where j.student_no = a.student_no and j.day = a.day), 0)
  <> floor(app_private.balance_on(a.student_no, a.day) * a.rate / 7);

-- 提前支取 (§9.5): a 定期 opened 12 days ago pays 活期 for the eight days at 2%, the four off days at 0.
select app_private.start_term_deposit('00000000-0000-4000-8000-0000000000b1', 'b', 50, 4, :'teller', tests.noon(:'today'::date - 12));
select is((select app_private.early_interest(t, :'today') from term_deposits t where id = '00000000-0000-4000-8000-0000000000b1'), 8 * 14,
  '8 × ⌊50 × 2 ÷ 7⌋ = 1.12 HTB');

select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

select * from finish();
rollback;
