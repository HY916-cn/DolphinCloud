-- 利率与活期利息 (PHASE-2.md §9.1–9.4, §13, §14, §17): the rates of §9.2, the anchor of §9.1, 活期计息 and 结息 on fixed
-- days, a catch-up against every day on time, the interest transaction, the self-check, who reads what, and the settings.
\ir helpers/setup.psql

select tests.staff('teacher', 'teacher') as teacher \gset
select tests.staff('p1', 'president') as president \gset
select tests.staff('acc', 'accountant') as accountant \gset
select tests.staff('t1', 'teller') as teller \gset
select tests.staff('keeper', 'storekeeper') as keeper \gset
select tests.staff('ops', 'sysadmin') as ops \gset
select tests.student('s1', 0) as s1 \gset

-- A transaction at noon of its day (Asia/Shanghai), as the counter would have written it.
create function tests.tx(p_no text, p_type txn_type, p_amount integer, p_day date) returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_delta integer := case when p_type = 'withdraw' then -p_amount else p_amount end;
  v_balance integer;
begin
  update accounts set balance = balance + v_delta, total_in = total_in + case when p_type in ('opening', 'deposit') then p_amount else 0 end,
    total_out = total_out + case when p_type = 'withdraw' then p_amount else 0 end
  where student_no = p_no returning balance into v_balance;
  insert into txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
  values (v_id, p_type, p_no, p_amount, v_delta, v_balance, (select id from profiles where login_id = 'teacher'),
    (p_day + time '12:00') at time zone 'Asia/Shanghai');
  return v_id;
end $$;
-- A student opened on p_opened (8:00) with an opening balance that day.
create function tests.old(p_no text, p_opening integer default 0, p_opened date default '2025-01-01') returns void language plpgsql as $$
begin
  perform tests.student(p_no, 0);
  update students set opened_at = (p_opened + time '08:00') at time zone 'Asia/Shanghai' where student_no = p_no;
  if p_opening > 0 then
    perform tests.tx(p_no, 'opening', p_opening, p_opened);
  end if;
end $$;
create function tests.at(p text) returns timestamptz language sql as $$ select (p::timestamp) at time zone 'Asia/Shanghai' $$;

-- §9.2: every rate of the table at an anchor of 2%.
select is(app_private.rates(2, s), r::jsonb, format('score %s: 活期, 定期 (fixed), 贷款', s))
from (values (0, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":null}'),
  (400, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":7.2}'),
  (600, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":6.2667}'),
  (750, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":5.5667}'),
  (900, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":4.8667}'),
  (1000, '{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":4.4}')) t(s, r);
select is(array[app_private.term_rate(12), app_private.term_rate(3), app_private.loan_rate(2, 399)], array[3, null, null]::numeric[],
  'no 定期 rate for a length without one, no loan rate below 400');
select is(app_private.penalty_rate(app_private.loan_rate(2, 1000)), 6.6, '罚息 = the loan rate × 1.5');
select is(app_private.penalty_rate(6.2667), 9.4001, 'to 4 decimals');
select is(count(*)::int, 0, 'at every score from 400, the loan rate is above 活期 and every 定期 at the initial anchor')
from generate_series(400, 1000) s where app_private.loan_rate(2, s) <= greatest(app_private.saving_rate(2, s), app_private.term_rate(48));
select is(array[app_private.loan_factor(600), app_private.loan_factor(399)], array[1.5667, null], 'the factor shown keeps its 4 decimals');

-- §9.1: the adjustment, by the two examples and within ±0.5.
select is(app_private.anchor_adjust(r, g, app_private.setting('anchor_params')), a, why)
from (values (40, 2, 0.25, '存贷比 40%、增速 2%: +0.25'), (30, 4, -0.5, '存贷比 30%、增速 4%: −0.5'),
  (100, 2, 0.5, 'never more than +0.5'), (30, 50, -0.5, 'nor less than −0.5'), (0, 0, -0.25, 'no deposits: both 0, −0.25'),
  (31, 2, 0.03, 'to 2 decimals')) t(r, g, a, why);
select is(2 + app_private.anchor_adjust(40, 2, app_private.setting('anchor_params')), 2.25, 'so 2% becomes 2.25%');

-- §9.1 on fixed Mondays.
savepoint anchors;
create function tests.week(p date) returns text language sql as $$
  select concat_ws(' ', prev_anchor, deposits, loans, ratio, coalesce(growth::text, '-'), adjust, anchor) from rate_weeks where week_start = p
$$;
select is(tests.week((app_private.publish_anchor('2025-01-06')).week_start), '2.00 0 0 0.0000 - 0.00 2.00', 'the first Monday ever starts from 2% and does not adjust');
select is(tests.week((app_private.publish_anchor('2025-01-13')).week_start), '2.00 0 0 0.0000 0.0000 -0.25 1.75',
  'no deposits: 存贷比 and 增速 count as 0');
select tests.old('x', 1000, '2025-01-14');
select is(tests.week((app_private.publish_anchor('2025-01-20')).week_start), '1.75 1000 0 0.0000 0.0000 -0.25 1.50',
  'growth from no deposits counts as 0');
select tests.tx('x', 'deposit', 100, '2025-01-22');
select is(tests.week((app_private.publish_anchor('2025-01-27')).week_start), '1.50 1100 0 0.0000 10.0000 -0.50 1.00',
  '增速 10%: −2.75, kept to −0.5');
select is(tests.week((app_private.publish_anchor('2025-02-03')).week_start), '1.00 1100 0 0.0000 0.0000 -0.25 1.00',
  'and never below 1%');
select tests.tx('x', 'withdraw', 1045, '2025-02-05');
select is(tests.week((app_private.publish_anchor('2025-02-10')).week_start), '1.00 55 0 0.0000 -95.0000 0.50 1.50',
  'deposits falling: up by 0.5 at most');
select is(tests.call(:'teacher', $$select set_setting('anchor_params', '{"initial":1.8,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":1.8}')$$) ->> 'key',
  'anchor_params', 'the bank admin lowers the ceiling');
select tests.tx('x', 'withdraw', 50, '2025-02-12');
select is(tests.week((app_private.publish_anchor('2025-02-17')).week_start), '1.50 5 0 0.0000 -90.9091 0.50 1.80',
  'from the next Monday: kept within the new ceiling');
select is(array(select params ->> 'max' from rate_weeks order by week_start), array['4', '4', '4', '4', '4', '4', '1.8'],
  'each week keeps the parameters it used');
select is(tests.week((app_private.publish_anchor('2025-03-03')).week_start), '1.80 5 0 0.0000 - 0.00 1.80',
  'no row for the Monday before: no adjustment');
select tests.tx('x', 'deposit', 500, '2025-03-04');
select is(tests.week((app_private.publish_anchor('2025-03-03')).week_start), '1.80 5 0 0.0000 - 0.00 1.80',
  'a week published keeps its row');
select is(count(*)::int, 0, 'every week works out again from its row') from (
  select w.*, lag(anchor) over (order by week_start) as before from rate_weeks w) r
where r.prev_anchor <> coalesce(r.before, 2)
   or r.growth is not null and r.adjust <> app_private.anchor_adjust(r.ratio, r.growth, r.params)
   or r.anchor <> least((r.params ->> 'max')::numeric, greatest((r.params ->> 'min')::numeric, r.prev_anchor + r.adjust));
select throws_ok($$update rate_weeks set anchor = 3$$, '42501', null, 'a published week is never changed');
rollback to savepoint anchors;

-- 活期计息 (§9.3) on Monday 3 March 2025 and the days after, at the initial 2%.
savepoint accruals;
select tests.old('a', 100);
select tests.old('b', 1000);        update credit_scores set score = 1000 where student_no = 'b';
select tests.old('c', 100);         select app_private.credit_change('c', -100, 'manual', '测试', null, null, tests.at('2025-03-04 10:00')) is not null;
select tests.old('d', 100);         select tests.tx('d', 'deposit', 50, '2025-03-04');
select tests.old('tiny', 10);
select tests.old('zero');
select tests.old('gone', 100);
select tests.old('frz', 100);       update students set status = 'frozen' where student_no = 'frz';
select tests.old('grad', 100);      update students set status = 'graduated' where student_no = 'grad';
select tests.old('cls', 100);       update students set status = 'closed' where student_no = 'cls';
select tests.old('late', 100, '2025-03-04');
create function tests.day(p date) returns text[] language sql as $$
  select coalesce(array_agg(concat_ws(' ', student_no, balance, rate, centi) order by student_no), '{}') from interest_accruals where day = p
$$;
select is(app_private.accrue_interest('2025-03-03'), 7, 'one row for each 在读 account opened by the day');
select is(tests.day('2025-03-03'), array['a 100 2.0000 28', 'b 1000 2.0000 285', 'c 100 2.0000 28', 'd 100 2.0000 28', 'gone 100 2.0000 28',
  'tiny 10 2.0000 2', 'zero 0 2.0000 0'],
  'balance × 活期 rate ÷ 7 to 0.01 HTB, less dropped: 100 × 2% ÷ 7 = 0.2857 → 0.28; 1000 at 1000 分 at the same rate → 2.85; none for 冻结、毕业、注销 or one opened later');
select is(app_private.accrue_interest('2025-03-03'), 0, 'a day accrued again adds nothing');
update students set status = 'normal' where student_no = 'frz';
select app_private.accrue_interest('2025-03-04');
select is(tests.day('2025-03-04'), array['a 100 2.0000 28', 'b 1000 2.0000 285', 'c 100 2.0000 28', 'd 150 2.0000 42', 'frz 100 2.0000 28',
  'gone 100 2.0000 28', 'late 100 2.0000 28', 'tiny 10 2.0000 2', 'zero 0 2.0000 0'],
  'each day at its closing balance, whatever the score: c dropped to 500 分 that day, d deposited 50, frz unfrozen accrues again, late opened');
select is((select array_agg(day order by day) from interest_accruals where student_no = 'frz'), array['2025-03-04'::date],
  'the frozen days stay without interest');
select app_private.accrue_interest(d::date) from generate_series('2025-03-05'::date, '2025-03-09', interval '1 day') d;

-- 结息 (§9.4) on Monday 10 March: d is frozen and still paid; gone is closed and is not.
update students set status = 'frozen' where student_no = 'd';
update students set status = 'closed' where student_no = 'gone';
select is(app_private.settle_interest(tests.at('2025-03-10')), 6, 'six accounts have 1 HTB or more');
select is(to_jsonb(t) - 'id' - 'seq' - 'txn_no' - 'device_id' - 'client_created_at' - 'operator_id' - 'created_at' - 'term_id' - 'loan_id' - 'wealth_id' - 'corrects',
  '{"type":"interest","student_no":"a","amount":1,"balance_delta":1,"balance_after":101,"cash_delta":0,"payment":null,"denominations":null,
    "change_given":null,"status":"normal","reversal_of":null,"reason":"3月3日至3月9日活期利息","offline":false,"entered_at":null}',
  'the whole HTB of the week, 7 × 0.28 = 1.96, paid as one interest transaction')
from txns t where student_no = 'a' and type = 'interest';
select is((select array[operator_id::text, created_at::text, left(txn_no, 8)] from txns where student_no = 'a' and type = 'interest'),
  array[app_private.system_user()::text, tests.at('2025-03-10')::text, 'HT250310'], 'by the system login, dated the Monday''s midnight');
select is(array(select concat_ws(' ', student_no, (select amount from txns t where t.student_no = a.student_no and type = 'interest'), interest_carry)
    from accounts a where student_no in ('a', 'b', 'c', 'd', 'frz', 'late', 'tiny', 'gone') order by student_no),
  array['a 1 96', 'b 19 95', 'c 1 96', 'd 2 80', 'frz 1 68', 'gone 0', 'late 1 68', 'tiny 0'],
  'the rest stays as the carry: b 7 × 2.85 = 19.95, d 0.28 + 6 × 0.42 = 2.80');
select is((select count(*)::int from interest_accruals where settled_txn is null and centi > 0), 14,
  'tiny''s 0.14 and gone''s accruals wait');
select is(array[app_private.pending_interest('a'), app_private.pending_interest('tiny'), app_private.pending_interest('gone')], array[96, 14, 196],
  '待入账利息: the carry and what is not yet paid');
select is(app_private.settle_interest(tests.at('2025-03-10')), 0, 'settling again pays nothing more');
select app_private.accrue_interest('2025-03-10');
select is(app_private.pending_interest('a'), 124, 'the next day accrues on the balance with the interest: 101 → 0.28');
select is(tests.call(:'teacher', format('select reverse_txn(gen_random_uuid(), %L, ''金额录错'')',
  (select id from txns where student_no = 'a' and type = 'interest'))) ->> 'error', 'REVERSAL_NOT_ALLOWED', '结息 is never reversed');
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();

-- Who reads what (§3, §16).
select user_id as a_login from students where student_no = 'a' \gset
select is(tests.call(:'a_login', 'select interest_profile()'),
  '{"student_no":"a","score":600,"week_start":null,"anchor":2,"savings_enabled":true,"rates":{"current":2,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":6.2667},"pending_centi":124}',
  'a student reads this week''s rates and 待入账利息 1.24 HTB');
select is(tests.call(:'a_login', 'select interest_profile(''a'')') ->> 'pending_centi', '124', 'also by their own number');
select is(tests.err(:'a_login', 'select interest_profile(''b'')'), 'FORBIDDEN', 'but no one else''s');
select is(tests.call(w, 'select interest_profile(''b'')') #> '{rates,current}', '2', 'the accountant, president and bank admin read anyone''s')
from unnest(array[:'accountant', :'president', :'teacher']::uuid[]) w;
select is(tests.err(:'teacher', 'select interest_profile(''nobody'')'), 'STUDENT_NOT_FOUND', 'of a student that exists');
select is(tests.err(:'teacher', 'select interest_profile()'), 'FORBIDDEN', 'staff name the student');
select is(tests.err(w, 'select interest_profile(''b'')'), 'FORBIDDEN', 'not the others') from unnest(array[:'teller', :'keeper', :'ops']::uuid[]) w;
select is(tests.call(:'a_login', 'select count(distinct student_no) from interest_accruals'), '1', 'a student reads their own accruals');
select is(tests.call(w, 'select to_jsonb(count(distinct student_no) > 2) from interest_accruals'), 'true', 'the accountant, president and bank admin everyone''s')
from unnest(array[:'accountant', :'president', :'teacher']::uuid[]) w;
select is(tests.call(w, 'select count(*) from interest_accruals'), '0', 'the others none') from unnest(array[:'teller', :'keeper', :'ops']::uuid[]) w;

-- The self-check (§14.1) finds interest that does not match its accruals.
update interest_accruals set centi = centi + 1 where student_no = 'b' and day = '2025-03-05';
update accounts set interest_carry = 50 where student_no = 'c';
select is(array(select concat_ws(' ', kind, key, recorded, expected) from app_private.check_balances() order by key),
  array['interest b 1995 1996', 'interest c 150 196'], 'check_balances: 100 × interest paid + carry against the settled accruals');
rollback to savepoint accruals;

-- run_jobs (§13) through two terms and the holidays around them, every day alike: 春季 from Wednesday 5 March to Friday
-- 28 March 2025, 夏季 from Wednesday 9 April to Wednesday 30 April. A saver deposits every Wednesday, holidays too; mixed
-- drops to 500 分 on 12 March and withdraws most of it on 19 March; frozen never accrues.
insert into terms (name, starts_on, ends_on) values ('春季', '2025-03-05', '2025-03-28'), ('夏季', '2025-04-09', '2025-04-30');
update job_runs set done_to = '2025-03-02', last_ok = null, last_err = null;
select tests.old('saver', 500, '2025-03-01');
select tests.tx('saver', 'deposit', 20, d::date) from generate_series('2025-03-05'::date, '2025-04-30', interval '7 day') d;
select tests.old('mixed', 300, '2025-03-01');
select app_private.credit_change('mixed', -100, 'manual', '测试', null, null, tests.at('2025-03-12 10:00')) is not null;
select tests.tx('mixed', 'withdraw', 250, '2025-03-19');
select tests.old('frozen', 300, '2025-03-01');
update students set status = 'frozen' where student_no = 'frozen';

create function tests.state() returns text language sql as $$
  select concat_ws(' | ',
    (select string_agg(concat_ws(' ', student_no, day, balance, rate, centi, (select created_at from txns where id = settled_txn)), ', '
       order by student_no, day) from interest_accruals),
    (select string_agg(concat_ws(' ', student_no, amount, balance_after, created_at, reason), ', ' order by student_no, created_at)
       from txns where type = 'interest'),
    (select string_agg(concat_ws(' ', week_start, prev_anchor, deposits, ratio, growth, adjust, anchor), ', ' order by week_start) from rate_weeks),
    (select string_agg(concat_ws(' ', student_no, rule, delta, score, at), ', ' order by student_no, id) from credit_events),
    (select string_agg(concat_ws(' ', student_no, interest_carry, balance), ', ' order by student_no) from accounts))
$$;
savepoint every_day;
do $$
declare d date;
begin
  for d in select generate_series('2025-03-03'::date, '2025-05-06', interval '1 day') loop
    perform app_private.run_jobs(d);
  end loop;
end $$;
select tests.state() as every_day \gset
rollback to savepoint every_day;
select is(app_private.run_jobs('2025-05-06') -> 'failed', 'null', 'catching up both terms at once');
select is(tests.state(), :'every_day', 'gives the same accruals, interest, anchors, scores and balances as every day on time');
select is(app_private.run_jobs('2025-05-06') -> 'ran', '[]', 'and running again changes nothing');
select is(tests.state(), :'every_day', 'nothing at all');

select is(array(select concat_ws(' ', week_start, adjust, anchor) from rate_weeks order by week_start),
  array(select concat_ws(' ', w, a, n) from (values ('2025-03-03', '0.00', '2.00'), ('2025-03-10', '-0.50', '1.50'), ('2025-03-17', '-0.50', '1.00'),
    ('2025-03-24', '0.50', '1.50'), ('2025-03-31', '-0.50', '1.00'), ('2025-04-07', '-0.50', '1.00'), ('2025-04-14', '-0.50', '1.00'),
    ('2025-04-21', '-0.50', '1.00'), ('2025-04-28', '-0.50', '1.00'), ('2025-05-05', '-0.50', '1.00')) t(w, a, n)),
  'an anchor on every Monday, in the holidays and on the first Monday of a term too; the first ever starts from 2% unadjusted');
select is(count(*)::int, 0, 'always within 1%–4%') from rate_weeks where anchor not between 1 and 4;
select is((select count(*)::int from interest_accruals where student_no = 'saver'), 64,
  'interest every day from 3 March to 5 May for the saver, the holidays too');
select is((select count(*)::int from interest_accruals where student_no = 'frozen'), 0, 'none for the frozen');
select is(array(select concat_ws(' ', created_at, reason) from txns where student_no = 'saver' and type = 'interest' order by created_at),
  array(select concat_ws(' ', tests.at(a), r) from (values ('2025-03-10', '3月3日至3月9日活期利息'), ('2025-03-17', '3月10日至3月16日活期利息'),
    ('2025-03-24', '3月17日至3月23日活期利息'), ('2025-03-31', '3月24日至3月30日活期利息'), ('2025-04-07', '3月31日至4月6日活期利息'),
    ('2025-04-14', '4月7日至4月13日活期利息'), ('2025-04-21', '4月14日至4月20日活期利息'), ('2025-04-28', '4月21日至4月27日活期利息'),
    ('2025-05-05', '4月28日至5月4日活期利息')) t(a, r)),
  'paid every Monday for the week before, across the terms'' ends and starts alike');
select is((select array_agg(day) from interest_accruals where student_no = 'saver' and settled_txn is null), array['2025-05-05'::date],
  'only yesterday waits for next Monday');
select is((select array_agg(rate order by day) from interest_accruals where student_no = 'mixed' and day in ('2025-03-11', '2025-03-12')),
  array[1.5, 1.5], 'mixed at the anchor of 1.50 on 11 March at 600 分 and on 12 March at 500 分 alike');
select is(count(*)::int, 0, 'every accrual works out again from the balance, anchor and score of its day') from interest_accruals
where balance <> app_private.balance_on(student_no, day)
   or rate <> app_private.saving_rate(app_private.anchor_on(day), app_private.score_on(student_no, day))
   or centi <> floor(balance * rate / 7);
select is(count(*)::int, 0, 'the ledger checks out') from app_private.check_balances();
select is((select count(*)::int from txns where type = 'interest' and (cash_delta <> 0 or operator_id <> app_private.system_user())), 0,
  'no cash moves for interest');
select is(tests.call(:'teacher', 'select bank_report(''2025-03-01'', ''2025-05-06'')') #>> '{balance,changes,interest}',
  (select sum(amount)::text from txns where type = 'interest'), 'the report shows 结息 among the balance changes');
select is(tests.call(:'teacher', 'select bank_report(''2025-03-01'', ''2025-05-06'')') -> 'tellers', '[{"name":"teacher","count":10,"deposit_count":9,"deposit":180,"withdraw_count":1,"withdraw":250,"purchase_count":0,"purchase":0,"reversed":0,"reversals":0}]', 'and leaves the system login out of the tellers'' table');

-- The system login (§14.2) signs in to nothing.
select is((select array[disabled::text, (closed_at is not null)::text, display_name] from profiles where login_id = 'system'), array['true', 'true', '系统'],
  'the system login is disabled and closed');
select ok((select banned_until > now() from auth.users where id = app_private.system_user()), 'and banned from Auth');

-- 后台「利率」 (§16.2): the accountant, president and bank admin.
select is(tests.call(:'accountant', 'select rate_overview()') - 'table', '{"week_start":"2025-05-05","anchor":1.00}', 'this week''s anchor');
select is(tests.call(:'president', 'select rate_overview()') -> 'table' -> 2, '{"score":600,"current":1,"term":{"2":2.5,"4":2.75,"12":3,"24":3.25,"48":3.5},"loan":3.1333}',
  'and the rates by score under it');
select is(jsonb_path_query_array(tests.call(:'teacher', 'select rate_overview()') -> 'table', '$[*].score'), '[0,400,600,750,900,1000]',
  'the scores of §9.2');
select is(tests.err(w, 'select rate_overview()'), 'FORBIDDEN', 'not the others') from unnest(array[:'teller', :'keeper', :'ops', :'s1']::uuid[]) w;
select is(tests.call(w, 'select to_jsonb(count(*) = 10) from rate_weeks'), 'true', 'they read the weekly history') from unnest(array[:'accountant', :'president', :'teacher']::uuid[]) w;
select is(tests.call(w, 'select count(*) from rate_weeks'), '0', 'the others do not') from unnest(array[:'teller', :'keeper', :'ops', :'s1']::uuid[]) w;

-- The settings (§14.3): the bank admin changes the anchor's start and bounds; the anchor formula's
-- other keys and the multipliers are fixed.
select is(tests.call(:'teacher', $$select set_settings('{"anchor_params":{"initial":2.5,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1.25,"max":5}}')$$),
  '{"anchor_params":{"initial":2.5,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1.25,"max":5}}', 'the bank admin changes the start and bounds');
select is(tests.err(:'president', $$select set_setting('anchor_params', '{}')$$), 'FORBIDDEN', 'not the president');
select is(tests.call(:'teacher', $$select set_setting('anchor_params', '{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4}')$$) -> 'value',
  '{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4}', 'and back');
select is(tests.call(:'teacher', format('select set_setting(%L, %L)', k, v)) ->> 'detail', format('{"field": "%s"}', k), why)
from (values ('anchor_params', '{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1}', 'every key'),
  ('anchor_params', '{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4,"x":1}', 'no other'),
  ('anchor_params', '{"initial":0.5,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4}', 'the start within the bounds'),
  ('anchor_params', '{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":5,"max":4}', 'the bounds in order'),
  ('anchor_params', '{"initial":2.005,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4}', 'whole hundredths'),
  ('anchor_params', '{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":0,"max":4}', 'from 0.01'),
  ('anchor_params', '{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":100.01}', 'up to 100'),
  ('anchor_params', '{"initial":"2","ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4}', 'numbers'),
  ('anchor_params', '{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.5,"max_adjust":0.5,"min":1,"max":4}', 'the formula''s other keys are fixed'),
  ('anchor_params', '{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":3,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4}', 'every one of them'),
  ('loan_multiplier', '2.5', 'so is the loan multiplier'),
  ('penalty_multiplier', '2', 'and the 罚息 multiplier')) t(k, v, why);
select is(tests.err(:'teacher', $$select set_settings('{"anchor_params":{"initial":2.5,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1.25,"max":5},"loan_multiplier":2.5}')$$), 'INVALID_INPUT',
  'set_settings with a fixed one');
select is((select jsonb_object_agg(key, value) from settings where key in ('anchor_params', 'loan_multiplier', 'penalty_multiplier')),
  '{"anchor_params":{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4},"loan_multiplier":2,"penalty_multiplier":1.5}',
  'saves none of it, and the fixed values stay');
select is(tests.err(w, $$select set_setting('anchor_params', '{"initial":2,"ratio_target":30,"ratio_step":10,"growth_target":2,"growth_step":1,"weight":0.25,"max_adjust":0.5,"min":1,"max":4}')$$), 'FORBIDDEN', 'not the others')
from unnest(array[:'accountant', :'teller', :'keeper', :'ops', :'s1']::uuid[]) w;

select * from finish();
rollback;
