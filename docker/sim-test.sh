#!/bin/bash
# One term at full school size (PHASE-2.md §17): a fresh container, 2000 students and an 18-week term in the past, then a
# week of the holidays; each school day writes random deposits and withdrawals, a few 定期 opened or withdrawn early, a
# few 理财 bought or sold (in the six products; each product's change of a trading day fixed, a week's holiday in October
# for the A shares and 恒生指数, no network), a few 信用分 changes and, mid-term, some frozen accounts, loans paid out for 1–4 weeks (past the term's end
# too) and repaid; every day the jobs run as at 00:05 and 00:10 (run_weekly on Mondays before the day's business,
# run_daily after it), the holiday week as the term. Checks that the anchor stays within 1%–4% with one every Monday,
# that 活期 accrues every day, that check_balances finds nothing every day, that no run_daily takes 30 s, that every 定期
# due by the last day simulated has come back (the longer ones run on into the next term), that every product has a net
# value for every day to the last and that every loan with all its periods due by then is paid off or 逾期.
# Usage: docker/sim-test.sh [image]   (default dolphin-cloud:dev). KEEP=1 leaves the container running.
set -euo pipefail
IMAGE=${1:-dolphin-cloud:dev}
NAME=dolphin-sim-$$  # unique per run: parallel runs never touch each other's container or volume

remove() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME-data" >/dev/null 2>&1 || true; }
[ "${KEEP:-}" = 1 ] || trap remove EXIT
docker run -d --name "$NAME" -v "$NAME-data:/data" -e DOLPHIN_DOMAIN=localhost "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
  docker exec "$NAME" test -f /data/run/image-version 2>/dev/null && break
  sleep 2
done
docker exec "$NAME" test -f /data/run/image-version || { docker logs --tail 40 "$NAME" >&2; echo "FAIL: migrations did not finish" >&2; exit 1; }
psql() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
fail() { echo "FAIL: $*" >&2; exit 1; }
# The simulation runs the jobs itself: dolphin-jobs stops first, so its catch-up at start never runs the same days.
docker exec "$NAME" supervisorctl stop dolphin-jobs >/dev/null

# 2000 students opened the week before a term of 18 weeks: Monday 1 September 2025 to Sunday 4 January 2026.
psql <<'SQL'
create schema sim;
insert into public.terms (name, starts_on, ends_on) values ('模拟学期', '2025-09-01', '2026-01-04');
update public.job_runs set done_to = '2025-08-31', last_ok = null, last_err = null;
-- 理财 from 31 August, each product at 1 (what dolphin-jobs fetched at start goes).
set session_replication_role = replica;
delete from public.wealth_days;
delete from public.wealth_navs;
set session_replication_role = origin;
insert into public.wealth_navs (product, day, nav)
select p ->> 'key', '2025-08-31', 1 from jsonb_array_elements(app_private.setting('wealth_params') -> 'products') p;
insert into public.students (student_no, name, division, cohort, class_no, opened_at)
select '4' || lpad(i::text, 7, '0'), '学生' || i, case when i % 3 = 0 then 'junior' else 'primary' end,
  case when i % 3 = 0 then 2024 + i % 3 else 2021 + i % 6 end, 1 + i % 8, '2025-08-25 08:00+08'
from generate_series(1, 2000) i;
insert into public.accounts (student_no, balance, total_in)
select student_no, (hashtext(student_no) & 255), (hashtext(student_no) & 255) from public.students where student_no like '4%';
insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
select gen_random_uuid(), 'opening', student_no, balance, balance, balance, app_private.system_user(), '2025-08-25 08:00+08'
from public.accounts where student_no like '4%' and balance > 0;

-- A school day's business (Monday to Friday): about 30% of the students deposit or withdraw once between 7:30 and
-- 17:30, a withdrawal never more than the balance; at 17:40 about 0.5% of those with no loan and 400 分 or more borrow up
-- to 60 HTB within their 额度 for 1–4 weeks, into the account or in cash; at 17:45 about 1% open a 定期 of up to half
-- their 活期 for 2, 4, 12, 24 or 48 weeks (none with a loan not paid off), and 2% of the 定期 open are withdrawn early;
-- at 17:47 about 0.5% of those with no loan buy 理财 of a random product with up to a third of their 活期, and at 17:52 1%
-- of the holdings open bought before the day are sold; at 17:55 4% of the loans not paid off are repaid in part or in full, from 活期 when it is enough, else in cash; five
-- 信用分 changes by hand. The days' 自动扣款 and 逾期 come from run_daily.
create function sim.business(p_day date) returns integer language plpgsql as $$
declare v_n integer;
begin
  create temp table day_txns on commit drop as
  select a.student_no, a.balance,
    case when random() < 0.5 or a.balance = 0 then 1 + (random() * 49)::integer else -least(a.balance, 1 + (random() * 49)::integer) end as delta,
    (p_day + time '07:30' + random() * interval '10 hours') at time zone 'Asia/Shanghai' as at
  from public.accounts a join public.students s using (student_no)
  where s.status = 'normal' and random() < 0.3;
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, operator_id, created_at)
  select gen_random_uuid(), case when delta > 0 then 'deposit'::public.txn_type else 'withdraw' end, student_no, abs(delta), delta,
    balance + delta, delta, app_private.system_user(), at
  from day_txns where delta <> 0;
  update public.accounts a set balance = a.balance + d.delta,
    total_in = a.total_in + greatest(d.delta, 0), total_out = a.total_out + greatest(-d.delta, 0)
  from day_txns d where a.student_no = d.student_no;
  get diagnostics v_n = row_count;
  perform app_private.start_term_deposit(gen_random_uuid(), x.student_no, 1 + (random() * (x.balance / 2))::integer, x.w,
    app_private.system_user(), (p_day + time '17:45') at time zone 'Asia/Shanghai')
  from (select a.student_no, a.balance, (array[2, 4, 12, 24, 48])[1 + floor(random() * 5)::integer] as w
        from public.accounts a join public.students s using (student_no)
        where s.status = 'normal' and a.balance >= 10 and random() < 0.01
          and not exists (select 1 from public.loans l where l.student_no = a.student_no and l.status in ('active', 'overdue'))) x;
  perform app_private.end_term_deposit(d.id, 'early', app_private.early_interest(d, p_day), app_private.system_user(),
    (p_day + time '17:50') at time zone 'Asia/Shanghai')
  from public.term_deposits d join public.students s using (student_no)
  where d.status = 'open' and s.status = 'normal' and d.matures_on >= p_day and random() < 0.02;
  perform app_private.start_wealth(gen_random_uuid(), x.student_no, 1 + (random() * (x.balance / 3))::integer, x.product,
    app_private.system_user(), (p_day + time '17:47') at time zone 'Asia/Shanghai')
  from (select a.student_no, a.balance, (array['bond', 'gold', 'csi300', 'chinext', 'hsi', 'ndx'])[1 + floor(random() * 6)::integer] as product
        from public.accounts a join public.students s using (student_no)
        where s.status = 'normal' and a.balance >= 10 and random() < 0.005
          and not exists (select 1 from public.loans l where l.student_no = a.student_no and l.status in ('active', 'overdue'))) x;
  perform app_private.end_wealth(h.id, 'redeemed', app_private.system_user(), (p_day + time '17:52') at time zone 'Asia/Shanghai')
  from public.wealth_holdings h join public.students s using (student_no)
  where h.status = 'open' and s.status = 'normal' and h.opened_on < p_day and random() < 0.01;
  perform app_private.start_loan(gen_random_uuid(), x.student_no, least(x.lim, 1 + (random() * 59)::integer), '模拟', x.plan, x.k, x.via,
    app_private.system_user(), (p_day + time '17:40') at time zone 'Asia/Shanghai')
  from (select s.student_no, app_private.credit_limit(c.score) as lim,
          case when random() < 0.5 then 'installment' else 'bullet' end as plan, 1 + floor(random() * 4)::integer as k,
          case when random() < 0.5 then 'account' else 'cash' end as via
        from public.students s join public.credit_scores c using (student_no)
        where s.status = 'normal' and app_private.credit_limit(c.score) is not null and random() < 0.005
          and not exists (select 1 from public.loans l where l.student_no = s.student_no and l.status in ('active', 'overdue'))) x;
  perform app_private.pay_loan(y.id, null, y.amount, y.via, case when y.via = 'cash' then app_private.make_change(y.amount) end,
    app_private.system_user(), (p_day + time '17:55') at time zone 'Asia/Shanghai', p_day, false, null)
  from (select x.id, x.amount, case when x.balance >= x.amount then 'account' else 'cash' end as via
        from (select l.id, a.balance, app_private.loan_take(l,
                1 + floor(random() * (l.remaining + ceil(l.interest_centi / 100.0)))::integer) as amount
              from public.loans l join public.accounts a using (student_no) join public.students s using (student_no)
              where l.status in ('active', 'overdue') and s.status = 'normal' and random() < 0.04) x
        where x.amount > 0) y;
  perform app_private.credit_change(student_no, (random() * 100)::integer - 50, 'manual', '模拟', null, null,
    (p_day + time '12:00') at time zone 'Asia/Shanghai')
  from (select student_no from public.students order by random() limit 5) x;
  return v_n;
end $$;

-- One day as dolphin-jobs and the counter would have it: on a Monday the weekly job (00:10), then the day's business, then
-- the daily job (00:05 the next day) and the self-check. Returns "day status transactions daily_ms weekly_ms mismatches".
-- Students whose number ends in 07 are frozen from 15 October to 15 November.
create function sim.step(p_day date) returns text language plpgsql as $$
declare
  v_t timestamptz;
  v_weekly text := '-';
  v_daily text;
  v_status text;
  v_n integer := 0;
begin
  if extract(isodow from p_day) = 1 then
    v_t := clock_timestamp();
    perform app_private.run_weekly(p_day);
    v_weekly := round(extract(epoch from clock_timestamp() - v_t) * 1000)::text;
  end if;
  if p_day = '2025-10-15' then
    update public.students set status = 'frozen' where student_no like '4%07';
  elsif p_day = '2025-11-15' then
    update public.students set status = 'normal' where status = 'frozen';
  end if;
  -- The closes as dolphin-jobs would have fetched them by the day's business: the A shares' and 恒生指数's of the day
  -- (1 to 7 October a holiday, closed), 纳斯达克 100's of the US day before; each a fixed cycle from −2.6% to +2.4%,
  -- shifted by product. Then the net values.
  insert into public.wealth_days (product, day, change, source, params)
  select p.key, x.d, (array[0.6, -0.4, 1.1, -1.3, 0.2, -2.6, 2.4, 0])[1 + (x.d - date '2025-09-01' + p.i::integer) % 8], 'tencent',
    app_private.setting('wealth_params')
  from unnest(array['bond', 'gold', 'csi300', 'chinext', 'hsi', 'ndx']) with ordinality p(key, i),
    lateral (select case when p.key = 'ndx' then p_day - 1 else p_day end as d) x
  where extract(isodow from x.d) <= 5 and (p.key = 'ndx' or x.d not between '2025-10-01' and '2025-10-07') and x.d >= '2025-09-01';
  perform app_private.advance_wealth_navs(p_day);
  if extract(isodow from p_day) <= 5 and (app_private.current_term(p_day)).id is not null then
    v_n := sim.business(p_day);
  end if;
  v_t := clock_timestamp();
  v_status := app_private.run_daily(p_day) ->> 'status';
  v_daily := round(extract(epoch from clock_timestamp() - v_t) * 1000)::text;
  return concat_ws(' ', p_day, v_status, v_n, v_daily, v_weekly, (select count(*) from app_private.check_balances()));
end $$;
SQL

# Day by day through the term and a week of the holidays after it.
start=$(date +%s)
max_daily=0
max_weekly=0
for i in $(seq 0 132); do
  line=$(psql -c "select sim.step('2025-09-01'::date + $i)")
  set -- $line   # day status transactions daily_ms weekly_ms mismatches
  [ "$6" = 0 ] || fail "check_balances found $6 mismatches after $1"
  [ "$4" -lt 30000 ] || fail "run_daily for $1 took $4 ms"
  if [ "$4" -gt "$max_daily" ]; then max_daily=$4; fi
  if [ "$5" != - ] && [ "$5" -gt "$max_weekly" ]; then max_weekly=$5; fi
  if [ $((i % 7)) = 0 ]; then echo "$line"; fi
  if [ $((i % 30)) = 29 ]; then psql -c 'analyze' >/dev/null; fi
done

psql -c "select concat_ws(' ', count(*), min(anchor), max(anchor)) from public.rate_weeks" | {
  read -r weeks lo hi
  [ "$weeks" = 19 ] || fail "$weeks weekly anchors, not 19 (every Monday from 1 September to 5 January)"
  awk -v lo="$lo" -v hi="$hi" 'BEGIN { exit !(lo >= 1 && hi <= 4) }' || fail "anchor went from $lo to $hi"
  echo "anchors: $weeks weeks, from $lo% to $hi%"
}
psql -c "select string_agg(concat_ws(' ', week_start, deposits, growth, adjust, anchor), E'\n' order by week_start) from public.rate_weeks"
psql -c "select concat_ws(' ', (select count(*) from public.txns where type = 'interest'), (select sum(amount) from public.txns where type = 'interest'),
  (select count(*) from public.interest_accruals), (select count(*) from public.interest_accruals where settled_txn is null and day <= '2026-01-04' and centi > 0),
  (select count(*) from public.txns), (select count(distinct day) from public.interest_accruals))" | {
  read -r paid total accruals unsettled txns days
  [ "$days" = 133 ] || fail "活期 accrued on $days days, not all 133"
  echo "interest: $paid payments, $total HTB in all; $accruals accruals ($unsettled below 1 HTB still waiting); $txns transactions"
}
psql -c "select concat_ws(' ', count(*), count(*) filter (where status = 'matured'), count(*) filter (where status = 'early'),
  count(*) filter (where status = 'open'), coalesce(sum(interest_centi), 0),
  count(*) filter (where status = 'open' and matures_on <= '2026-01-11')) from public.term_deposits" | {
  read -r n matured early open centi due
  [ "$due" = 0 ] || fail "$due 定期 due by 11 January still open"
  echo "定期: $n opened, $matured matured, $early withdrawn early, $open still open into the next term; $centi (0.01 HTB) of interest"
}
psql -c "select concat_ws(' ', count(*), count(*) filter (where status = 'redeemed'), count(*) filter (where status = 'open'),
  coalesce(sum(value_centi - 100 * principal) filter (where status <> 'open'), 0),
  count(*) filter (where status = 'redeemed' and closed_on <= opened_on)) from public.wealth_holdings" | {
  read -r n sold open gain early
  [ "$n" -gt 0 ] || fail "no 理财"
  [ "$early" = 0 ] || fail "$early 理财 sold the day bought"
  echo "理财: $n bought, $sold sold, $open still open; $gain (0.01 HTB) gained over the principal"
}
# Every product has a net value for each day from 31 August to 11 January (134 rows).
psql -F ' ' -c "select product, count(*), max(day), min(nav), max(nav), (array_agg(nav order by day desc))[1] from public.wealth_navs group by product order by product" | {
  while read -r product days last lo hi nav; do
    [ "$days" = 134 ] && [ "$last" = 2026-01-11 ] || fail "$product: $days net values to $last"
    echo "理财 $product: $days net values to $last, from $lo to $hi, last $nav"
  done
}
psql -c "select concat_ws(' ', count(*), count(*) filter (where status = 'closed'), count(*) filter (where status = 'overdue'),
  count(*) filter (where status = 'active'), coalesce(sum(principal), 0),
  (select count(*) from public.loan_payments), (select count(*) from public.loan_payments where auto), (select coalesce(sum(interest), 0) from public.loan_payments),
  (select count(distinct student_no) from public.credit_events where rule = 'overdue'),
  count(*) filter (where status = 'active' and (select max(due_on) from public.loan_periods p where p.loan_id = loans.id) <= '2026-01-11'))
  from public.loans" | {
  read -r n closed overdue active principal repays auto interest late due
  [ "$n" -gt 0 ] || fail "no loans"
  [ "$due" = 0 ] || fail "$due loans due by 11 January neither paid off nor 逾期"
  echo "贷款: $n paid out ($principal HTB), $closed paid off, $overdue 逾期, $active still running; $repays repayments ($auto 自动扣款), $interest HTB of interest; $late students ever 逾期"
}
echo "slowest run_daily: ${max_daily} ms; slowest run_weekly: ${max_weekly} ms; whole term: $(( $(date +%s) - start ))s"
echo 'sim ok'
