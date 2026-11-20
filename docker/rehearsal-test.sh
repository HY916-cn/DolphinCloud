#!/bin/bash
# Pre-launch rehearsals (PHASE-2.md §19) in two running containers, A and B, from the same data and business, with the
# bank admin's steps over HTTPS through Caddy and the jobs run as dolphin-jobs runs them:
#   1. 学期结转: a term of business (活期, a 定期 and a 理财 past the term's end, a loan running and one 逾期, 信用分
#      changes, a 补录), then the bank admin registers the next term and 结转; balances, scores and everything open carry
#      over unchanged, `dolphin check` agrees, the old term reads back by term, and only 补录 and 编辑 change it.
#   2. 停机补跑: A runs the jobs every day; B is stopped with `docker stop` for 3–6 days (always over a Monday) and
#      started again, and dolphin-jobs catches up by itself. Every job's result in A and B must be the same.
# The days are in the past (the clock cannot be moved): the window is the 16 days before today, the term ends 8 days
# before today and the next term starts the day after. Past business goes in with its own time, as docker/sim-test.sh
# does; the days are run with app_private.run_jobs(day), what dolphin-jobs runs at 00:05 that day. The index's daily
# closes come from `dolphin jobs fetch` itself, against a stand-in for the providers (fixed closes, no network): each day
# in A, and for B at its restart the days it missed, as the real fetch at a restart brings in the days since.
# Usage: docker/rehearsal-test.sh [image]   (default dolphin-cloud:dev). KEEP=1 leaves the containers running.
set -euo pipefail
IMAGE=${1:-dolphin-cloud:dev}
A=dolphin-rehearsal-a-$$
B=dolphin-rehearsal-b-$$
WORK=$(mktemp -d)
started=$(date +%s)

remove() {
  for c in "$A" "$B"; do docker rm -f "$c" >/dev/null 2>&1 || true; docker volume rm "$c-data" >/dev/null 2>&1 || true; done
  rm -rf "$WORK"
}
[ "${KEEP:-}" = 1 ] || trap remove EXIT
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }
sq() { local c=$1; shift; docker exec -i "$c" psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }
# rpc <container> <function> <json> [token]: POST over HTTPS through Caddy as the bank admin (or the token given);
# prints the body, then the status on the last line.
rpc() {
  docker exec "$1" curl -sk -w '\n%{http_code}' -X POST "https://localhost/rest/v1/rpc/$2" -H "apikey: $(cat "$WORK/$1.anon")" \
    -H "Authorization: Bearer ${4:-$(cat "$WORK/$1.token")}" -H 'Content-Type: application/json' -d "$3"
}
rest() { # rest <container> <method> <path> [json]: the REST API on a table as the bank admin; prints the status
  docker exec "$1" curl -sk -o /dev/null -w '%{http_code}' -X "$2" "https://localhost/rest/v1/$3" -H "apikey: $(cat "$WORK/$1.anon")" \
    -H "Authorization: Bearer $(cat "$WORK/$1.token")" -H 'Content-Type: application/json' -d "${4:-}"
}
ok() { # ok <container> <function> <json>: the body of a call that must succeed
  local out; out=$(rpc "$@"); [ "$(tail -1 <<<"$out")" = 200 ] || fail "$2: $out"; sed '$d' <<<"$out"
}
login() { # login <container> <email> <password> → token
  docker exec "$1" curl -sk -X POST "https://localhost/auth/v1/token?grant_type=password" -H "apikey: $(cat "$WORK/$1.anon")" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$2\",\"password\":\"$3\"}" | jq -r '.access_token // empty'
}

# The stand-in for the index providers: Tencent answers with the closes in /tmp/rehearsal-closes.json, Sina and
# eastmoney do not answer; every other curl is the real one.
mkdir -p "$WORK/bin"
cat > "$WORK/bin/curl" <<'SH'
#!/bin/sh
case "$*" in
  *gtimg.cn*) exec cat /tmp/rehearsal-closes.json ;;
  *sina.cn*|*eastmoney.com*) echo "curl: (6) Could not resolve host" >&2; exit 6 ;;
esac
exec /usr/bin/curl "$@"
SH
chmod 755 "$WORK/bin/curl"
IMAGE_PATH=$(docker image inspect "$IMAGE" -f '{{range .Config.Env}}{{println .}}{{end}}' | sed -n 's/^PATH=//p')

for c in "$A" "$B"; do
  docker run -d --name "$c" --stop-timeout 120 -v "$c-data:/data" -v "$WORK/bin:/opt/rehearsal:ro" -e PATH="/opt/rehearsal:$IMAGE_PATH" \
    -e DOLPHIN_DOMAIN=localhost "$IMAGE" >/dev/null
done
for c in "$A" "$B"; do
  for _ in $(seq 1 90); do docker exec "$c" test -f /data/run/image-version 2>/dev/null && break; sleep 2; done
  docker exec "$c" test -f /data/run/image-version || { docker logs --tail 40 "$c" >&2; fail "$c: migrations did not finish"; }
  # The rehearsal runs the days itself until B's outage; dolphin-jobs comes back with B's restart.
  docker exec "$c" supervisorctl stop dolphin-jobs >/dev/null
  docker exec "$c" sh -c '. /data/secrets/env && echo "$ANON_KEY"' > "$WORK/$c.anon"
done
# shortcut: today is taken once, so a run across midnight in Shanghai fails; run it again after midnight.
T=$(sq "$A" -c "select app_private.cn_date(now())")
D0=$(sq "$A" -c "select date '$T' - 16")
E=$(sq "$A" -c "select date '$T' - 8")
# B is down from the evening of day DOWN − 1 to today: 3 days, or more to take in the last Monday.
L=$(sq "$A" -c "select greatest(3, extract(isodow from date '$T')::integer - 1)")
DOWN=$(sq "$A" -c "select date '$T' - $L")
echo "today $T; window $D0 to $(sq "$A" -c "select date '$T' - 1"); term 1 ends $E; B down $L days from the evening of $(sq "$A" -c "select date '$DOWN' - 1")"

for c in "$A" "$B"; do
  sq "$c" -v d0="$D0" -v e="$E" -v t="$T" <<'SQL'
-- A fresh database: nothing to undo but the startup run, which on a Monday published today's anchor.
set session_replication_role = replica;
delete from public.rate_weeks;
set session_replication_role = origin;
update public.job_runs set done_to = date :'d0' - 1, last_ok = null, last_err = null;
create schema reh;
create table reh.cfg as select date :'d0' as d0, date :'e' as e, date :'t' as t;
-- Six students opened three days before the window.
insert into public.students (student_no, name, division, cohort, class_no, opened_at)
select '7000000' || i, '演练' || i, 'primary', 2021, 1, (date :'d0' - 3 + time '08:00') at time zone 'Asia/Shanghai'
from generate_series(1, 6) i;
insert into public.accounts (student_no, balance, total_in)
select '7000000' || i, b, b from unnest(array[300, 400, 300, 5, 200, 100]) with ordinality x(b, i);
insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
select gen_random_uuid(), 'opening', student_no, balance, balance, balance, app_private.system_user(),
  (date :'d0' - 3 + time '08:00') at time zone 'Asia/Shanghai'
from public.accounts where student_no like '7%';

-- A deposit (or, below 0, a withdrawal) at the counter at a given time.
create function reh.move(p_no text, p_delta integer, p_at timestamp) returns void language sql as $$
  insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, cash_delta, operator_id, created_at)
  select gen_random_uuid(), case when p_delta > 0 then 'deposit'::public.txn_type else 'withdraw' end, p_no, abs(p_delta),
    p_delta, balance + p_delta, p_delta, app_private.system_user(), p_at at time zone 'Asia/Shanghai'
  from public.accounts where student_no = p_no;
  update public.accounts set balance = balance + p_delta, total_in = total_in + greatest(p_delta, 0),
    total_out = total_out + greatest(-p_delta, 0) where student_no = p_no;
$$;
-- The counter's business of day n of the window (0 = its first day).
create function reh.business(n integer) returns void language plpgsql as $$
declare
  d date := (select d0 from reh.cfg) + n;
  sys uuid := app_private.system_user();
begin
  case n
    when 0 then
      perform reh.move('70000001', 50, d + time '10:00');
      -- 30 HTB in cash for a week: 70000004 has 5 HTB, so the day it falls due it goes 逾期.
      perform app_private.start_loan(gen_random_uuid(), '70000004', 30, '演练', 'bullet', 1, 'cash', sys, (d + time '11:00') at time zone 'Asia/Shanghai');
    when 1 then
      perform app_private.start_term_deposit(gen_random_uuid(), '70000002', 200, 12, sys, (d + time '10:00') at time zone 'Asia/Shanghai');
      perform app_private.start_term_deposit(gen_random_uuid(), '70000002', 50, 2, sys, (d + time '10:05') at time zone 'Asia/Shanghai');
      perform app_private.start_wealth(gen_random_uuid(), '70000003', 150, 4, 'bold', sys, (d + time '10:30') at time zone 'Asia/Shanghai');
    when 2 then
      perform app_private.start_loan(gen_random_uuid(), '70000005', 40, '演练', 'installment', 4, 'account', sys, (d + time '11:00') at time zone 'Asia/Shanghai');
    when 3 then
      perform reh.move('70000006', -30, d + time '09:00');
      perform app_private.credit_change('70000001', 20, 'manual', '演练：课堂表现', null, null, (d + time '12:00') at time zone 'Asia/Shanghai');
    when 5 then
      perform reh.move('70000001', -40, d + time '15:00');
    when 9 then
      perform reh.move('70000001', 30, d + time '10:00');
      perform reh.move('70000006', 25, d + time '10:10');
    else
  end case;
end $$;
-- The index's daily closes up to a day, as Tencent sends them: every weekday from two weeks before the window.
create function reh.closes(p_to date) returns text language sql as $$
  select jsonb_build_object('data', jsonb_build_object('sh000300', jsonb_build_object('day', coalesce(jsonb_agg(jsonb_build_array(
    d::date::text, '3800.00', round((3800 + 90 * sin(d::date - date '2026-01-01'))::numeric, 2)::text) order by d), '[]'))))::text
  from generate_series((select d0 from reh.cfg) - 14, p_to, interval '1 day') d where extract(isodow from d) < 6
$$;
-- Everything the jobs make, without ids, transaction numbers (a sequence: Postgres may skip numbers after a restart)
-- and the times things were entered: A and B must print the same.
create function reh.snapshot() returns setof text language sql as $$
  (select concat_ws('|', 'account', student_no, balance, total_in, total_out, interest_carry, term_total, wealth_total) from public.accounts order by 1)
  union all (select concat_ws('|', 'score', student_no, score) from public.credit_scores order by 1)
  union all (select concat_ws('|', 'credit', student_no, at, delta, score, rule, reason) from public.credit_events order by 1)
  union all (select concat_ws('|', 'accrual', student_no, day, balance, rate, centi, settled_txn is not null) from public.interest_accruals order by 1)
  union all (select concat_ws('|', 'correction', student_no, day, balance, centi, settled_txn is not null) from public.interest_adjustments order by 1)
  union all (select concat_ws('|', 'anchor', week_start, prev_anchor, deposits, loans, ratio, growth, adjust, anchor) from public.rate_weeks order by 1)
  union all (select concat_ws('|', 'term', student_no, principal, weeks, rate, opened_on, matures_on, status, interest_centi, expected_centi) from public.term_deposits order by 1)
  union all (select concat_ws('|', 'wealth', student_no, principal, weeks, tier, opened_on, matures_on, value_centi, valued_to, status, closed_on) from public.wealth_holdings order by 1)
  union all (select concat_ws('|', 'loan', loan_no, student_no, principal, remaining, rate, score, plan, periods, interest_centi, status, opened_on, closed_on) from public.loans order by 1)
  union all (select concat_ws('|', 'period', l.loan_no, p.seq, p.due_on, p.principal, p.paid, p.overdue_at) from public.loan_periods p join public.loans l on l.id = p.loan_id order by 1)
  union all (select concat_ws('|', 'payment', l.loan_no, t.created_at, p.interest, p.principal, p.auto) from public.loan_payments p join public.loans l on l.id = p.loan_id join public.txns t on t.id = p.txn_id order by 1)
  union all (select concat_ws('|', 'txn', created_at, type, student_no, amount, balance_delta, balance_after, cash_delta, status, reason) from public.txns order by 1)
  union all (select concat_ws('|', 'index', day, change) from public.wealth_days order by 1)
  union all (select concat_ws('|', 'term_row', name, starts_on, ends_on, closed_at is not null) from public.terms order by 1)
  union all (select concat_ws('|', 'job', job, done_to) from public.job_runs order by 1)
$$;
SQL
  sq "$c" -c "select app_private.create_admin('rehadmin') ->> 'password'" > "$WORK/$c.pw"
  sq "$c" -c "update public.profiles set must_change_password = false where login_id = 'rehadmin'" # as after setting a new password
  login "$c" rehadmin@staff.dolphin.internal "$(cat "$WORK/$c.pw")" > "$WORK/$c.token"
  [ -s "$WORK/$c.token" ] || fail "$c: the bank admin cannot sign in"
done

fetch() { # fetch <container> <day>: the provider has the closes up to that day; dolphin-jobs' fetch in the running container
  sq "$A" -c "select reh.closes('$2')" > "$WORK/closes.json"
  docker cp -q "$WORK/closes.json" "$1:/tmp/rehearsal-closes.json"
  [ "${3:-}" = stopped ] || docker exec "$1" dolphin jobs fetch >/dev/null || fail "$1: dolphin jobs fetch for $2"
}
term_rows() { sq "$1" -c "select id from public.terms where name = '$2'"; }

# The bank admin registers the term as it is, over HTTPS.
for c in "$A" "$B"; do
  ok "$c" upsert_term "{\"p_id\":null,\"p_name\":\"演练学期一\",\"p_starts\":\"$(sq "$c" -c "select date '$D0' - 3")\",\"p_ends\":\"$E\"}" >/dev/null
done

# Day by day: at 00:05 the jobs (run_jobs with that day as today, as dolphin-jobs runs them), then the counter's
# business, then the day's index close (fetched after 15:30). B is down from DOWN on.
for n in $(seq 0 15); do
  d=$(sq "$A" -c "select date '$D0' + $n")
  for c in "$A" "$B"; do
    [ "$c" = "$B" ] && [ "$d" \> "$(sq "$A" -c "select date '$DOWN' - 1")" ] && continue  # B is down
    if [ "$d" = "$(sq "$A" -c "select date '$E' + 1")" ]; then
      # 结转 before the daily job has done the term's last day: TERM_OPEN_ITEMS, and nothing changes.
      out=$(rpc "$c" close_term "{\"p_id\":\"$(term_rows "$c" 演练学期一)\"}")
      grep -q TERM_OPEN_ITEMS <<<"$out" || fail "close before the last day was done: $out"
    fi
    sq "$c" -c "select app_private.run_jobs('$d')" | grep -q '"failed": null' || fail "$c: run_jobs($d)"
    if [ "$d" = "$(sq "$A" -c "select date '$E' + 1")" ]; then
      ok "$c" upsert_term "{\"p_id\":null,\"p_name\":\"演练学期二\",\"p_starts\":\"$d\",\"p_ends\":\"$(sq "$c" -c "select date '$d' + 150")\"}" >/dev/null
      sq "$c" -c "select * from reh.snapshot()" > "$WORK/$c.before-close"
      ok "$c" close_term "{\"p_id\":\"$(term_rows "$c" 演练学期一)\"}" > "$WORK/$c.closed"
      sq "$c" -c "select * from reh.snapshot()" > "$WORK/$c.after-close"
    fi
    sq "$c" -c "select reh.business($n)" >/dev/null
    if [ "$n" = 4 ]; then
      # 补录: a deposit two days ago the counter could not record (the bank admin, over HTTPS).
      ok "$c" manual_entry "{\"p_id\":\"$(uuidgen)\",\"p_student_no\":\"70000006\",\"p_type\":\"deposit\",
        \"p_occurred_at\":\"$(sq "$c" -c "select date '$d' - 2")T14:00:00+08:00\",\"p_reason\":\"演练：系统故障\",\"p_denominations\":{\"10\":2}}" >/dev/null
    fi
    fetch "$c" "$d"
  done
done
docker exec "$A" dolphin jobs run > "$WORK/a.run" || fail "A: dolphin jobs run: $(cat "$WORK/a.run")"

echo "== 演练 2：停机补跑"
# B was stopped on the evening of the day before DOWN, and stays down L days. It starts again with the closes of those
# days at the provider, and dolphin-jobs catches up by itself.
YESTERDAY=$(sq "$A" -c "select date '$T' - 1")
docker stop "$B" >/dev/null
fetch "$B" "$YESTERDAY" stopped
since=$(date -u +%Y-%m-%dT%H:%M:%SZ)
docker start "$B" >/dev/null
for _ in $(seq 1 90); do
  [ "$(sq "$B" -c "select done_to from public.job_runs where job = 'daily'" 2>/dev/null)" = "$YESTERDAY" ] && break
  sleep 2
done
docker exec "$B" dolphin jobs | tee "$WORK/b.jobs"
grep -q "^daily  done to $YESTERDAY" "$WORK/b.jobs" || fail "B did not catch up: $(cat "$WORK/b.jobs")"
docker logs --since "$since" "$B" 2>&1 | grep -E '^wealth: ' | sed 's/^/B at the restart: /'
! docker logs --since "$since" "$B" 2>&1 | grep -q 'not properly shut down' || fail "B: Postgres was killed at docker stop before it shut down cleanly"
ran=$(docker logs --since "$since" "$B" 2>&1 | grep -E '^(daily|weekly) [0-9-]+ done$' | tr '\n' ' ' | sed 's/ $//')
expect=$(sq "$A" -c "select string_agg(j || ' ' || d::date || ' done', ' ' order by d, o)
  from generate_series(date '$DOWN' - 1, date '$T', interval '1 day') d, unnest(array['weekly', 'daily']) with ordinality u(j, o)
  where (j = 'daily' and d < date '$T') or (j = 'weekly' and extract(isodow from d) = 1)")
[ "$ran" = "$expect" ] || fail "B caught up '$ran', not '$expect'"
pass "B, down $L days, caught up by itself at the restart: $ran"
sq "$A" -c "select * from reh.snapshot()" > "$WORK/a.snap"
sq "$B" -c "select * from reh.snapshot()" > "$WORK/b.snap"
diff "$WORK/a.snap" "$WORK/b.snap" >&2 || fail "A and B differ after the catch-up"
docker exec "$B" dolphin check >/dev/null 2>&1 || fail "B: dolphin check"
summary=$(cut -d'|' -f1 "$WORK/a.snap" | sort | uniq -c | awk '{printf "%s %s, ", $1, $2}' | sed 's/, $//')
pass "A (every day) and B (caught up) are the same, row for row: $summary"
sq "$A" -c "select string_agg(concat_ws(' ', student_no, principal, status, value_centi, valued_to), '; ') from public.wealth_holdings" | sed 's/^/理财 (student, principal, status, value 0.01 HTB, valued to): /'
sq "$A" -c "select string_agg(concat_ws(' ', week_start, anchor), '; ' order by week_start) from public.rate_weeks" | sed 's/^/anchors: /'

echo "== 演练 1：学期结转"
for c in "$A" "$B"; do
  diff <(grep -v '^term_row|' "$WORK/$c.before-close") <(grep -v '^term_row|' "$WORK/$c.after-close") >&2 || fail "$c: 结转 changed the ledger"
done
jq -e '.closed_at != null' "$WORK/$A.closed" >/dev/null || fail "close_term: $(cat "$WORK/$A.closed")"
sq "$A" -c "select count(*) from public.audit_log where action = 'term.close'" | grep -qx 1 || fail "no term.close in the log"
pass "结转 after the term's last day was done (before: TERM_OPEN_ITEMS); no transaction, nothing changed, term.close logged"
read -r open_terms open_wealth active overdue scored < <(sq "$A" -F ' ' -c "select
  (select count(*) from public.term_deposits where status = 'open' and opened_on <= '$E'),
  (select count(*) from public.wealth_holdings where status = 'open' and opened_on <= '$E'),
  (select count(*) from public.loans where status = 'active' and opened_on <= '$E'),
  (select count(*) from public.loans where status = 'overdue' and opened_on <= '$E'),
  (select count(*) from public.credit_scores where score <> 600)")
[ "$open_terms" -ge 1 ] && [ "$open_wealth" = 1 ] && [ "$active" = 1 ] && [ "$overdue" = 1 ] && [ "$scored" -ge 2 ] \
  || fail "carried over: $open_terms 定期, $open_wealth 理财, $active loans running, $overdue 逾期, $scored scores changed"
grep '^account|\|^score|' "$WORK/$A.after-close" | tr '\n' ' ' | sed 's/^/at the 结转: /'; echo
pass "carried into the next term: $open_terms 定期, $open_wealth 理财, $active loan running and $overdue 逾期, $scored scores changed"
sq "$A" -c "select string_agg(concat_ws(' ', d::date, (select count(*) from public.interest_accruals a where a.day = d)), ', ' order by d)
  from generate_series(date '$E' + 1, date '$T' - 1, interval '1 day') g(d)" | sed 's/^/accruals per day after the term: /'
missing=$(sq "$A" -c "select count(*) from generate_series(date '$E' + 1, date '$T' - 1, interval '1 day') g(d)
  where (select count(*) from public.interest_accruals a where a.day = g.d) < 5")
mondays=$(sq "$A" -c "select string_agg(d::date::text, ' ') from generate_series(date '$E' + 1, date '$T', interval '1 day') d where extract(isodow from d) = 1")
for w in $mondays; do
  read -r anchor settled weekly < <(sq "$A" -F ' ' -c "select (select anchor from public.rate_weeks where week_start = '$w'),
    (select count(*) from public.txns where type = 'interest' and created_at = date '$w'::timestamp at time zone 'Asia/Shanghai'),
    (select count(*) from public.credit_events where rule <> 'manual' and (at at time zone 'Asia/Shanghai')::date = '$w')")
  [ -n "$anchor" ] && [ "$settled" -ge 1 ] && [ "$weekly" -ge 1 ] || fail "after the 结转, Monday $w: anchor '$anchor', $settled 结息, $weekly weekly 信用分 changes"
  echo "Monday $w after the 结转: anchor $anchor%, $settled 结息, $weekly weekly 信用分 changes"
done
[ "$missing" = 0 ] && [ -n "$mondays" ] || fail "after the 结转: $missing days without 计息, Mondays: $mondays"
pass "after the 结转 the jobs run on: 活期 accrues every day, every Monday 结息, 信用分 and the anchor"
sq "$A" -c "select string_agg(concat_ws(' ', l.loan_no, l.status, l.remaining, (select count(*) from public.loan_payments p where p.loan_id = l.id and p.auto)), '; ')
  from public.loans l" | sed 's/^/loans now (no, status, remaining, 自动扣款): /'
docker exec "$A" dolphin check >/dev/null 2>&1 || fail "dolphin check: $(docker exec "$A" dolphin check)"
pass "dolphin check: balances and stock match the ledger"

# The old term by term: the report and the transactions over its dates.
T1_FROM=$(sq "$A" -c "select starts_on from public.terms where name = '演练学期一'")
report() { ok "$A" bank_report "{\"p_from\":\"$T1_FROM\",\"p_to\":\"$E\"}"; }
report > "$WORK/report1"
closing=$(jq -r '.balance.closing' "$WORK/report1")
expected=$(sq "$A" -c "select sum(balance_delta) from public.txns where created_at < (date '$E' + 1)::timestamp at time zone 'Asia/Shanghai'")
[ "$closing" = "$expected" ] || fail "the term's report closes at $closing, its transactions at $expected"
in_term=$(sq "$A" -c "select count(*) from public.txns where student_no = '70000001' and created_at < (date '$E' + 1)::timestamp at time zone 'Asia/Shanghai'")
# The 流水 page reads the table over the REST API, between the term's first day and the day after its last (Shanghai time).
listed=$(docker exec "$A" curl -sk "https://localhost/rest/v1/txns?select=txn_no&student_no=eq.70000001&created_at=gte.${T1_FROM}T00:00:00%2B08:00&created_at=lt.$(sq "$A" -c "select date '$E' + 1")T00:00:00%2B08:00" \
  -H "apikey: $(cat "$WORK/$A.anon")" -H "Authorization: Bearer $(cat "$WORK/$A.token")" | jq length)
[ "$listed" = "$in_term" ] || fail "the 流水 over the term lists $listed of $in_term"
echo "term 1 report: $(jq -c '{balance: .balance | {opening, closing}, interest, loans, terms}' "$WORK/report1")"
pass "the old term reads back by its dates: the report closes at $closing HTB, 70000001 has $listed transactions in it"

# Nothing but 补录 and 编辑 changes it. Straight to the tables: refused, as for every signed-in user.
txn=$(sq "$A" -c "select txn_no from public.txns where student_no = '70000001' and type = 'deposit' order by created_at limit 1")
for try in "PATCH txns?txn_no=eq.$txn {\"amount\":999}" "DELETE txns?txn_no=eq.$txn" "PATCH accounts?student_no=eq.70000001 {\"balance\":0}" \
           "PATCH terms?id=eq.$(term_rows "$A" 演练学期一) {\"ends_on\":\"$T\"}" "POST txns {\"type\":\"deposit\",\"student_no\":\"70000001\",\"amount\":1}"; do
  set -- $try
  code=$(rest "$A" "$1" "$2" "${3:-}")
  case $code in 401|403|405) ;; *) fail "$1 $2 answered $code" ;; esac
done
report | diff - "$WORK/report1" >&2 || fail "a write to the tables changed the term"
T1=$(term_rows "$A" 演练学期一)
out=$(rpc "$A" upsert_term "{\"p_id\":\"$T1\",\"p_name\":\"改名\",\"p_starts\":\"$T1_FROM\",\"p_ends\":\"$E\"}")
grep -q TERM_CLOSED <<<"$out" || fail "upsert_term on the closed term: $out"
out=$(rpc "$A" close_term "{\"p_id\":\"$T1\"}")
grep -q TERM_CLOSED <<<"$out" || fail "close_term on the closed term: $out"
pass "writes to the tables are refused (401/403); the closed term cannot be changed or closed again (TERM_CLOSED)"

# Ordinary business today: a teller's deposit is recorded now; neither the teller nor the bank admin 冲正 an old deposit.
sq "$A" >/dev/null <<'SQL'
select app_private.create_login('rehteller@staff.dolphin.internal', 'a12345678');
insert into public.profiles (id, login_kind, login_id, display_name, must_change_password)
select id, 'staff', 'rehteller', '演练柜员', false from auth.users where email = 'rehteller@staff.dolphin.internal';
insert into public.user_roles select id, 'teller' from auth.users where email = 'rehteller@staff.dolphin.internal';
SQL
TELLER=$(login "$A" rehteller@staff.dolphin.internal a12345678)
[ -n "$TELLER" ] || fail "the teller cannot sign in"
rpc "$A" start_duty '{}' "$TELLER" | tail -1 | grep -qx 200 || fail "start_duty"
rpc "$A" deposit "{\"p_id\":\"$(uuidgen)\",\"p_student_no\":\"70000001\",\"p_denominations\":{\"10\":1}}" "$TELLER" | tail -1 | grep -qx 200 || fail "teller deposit"
id=$(sq "$A" -c "select id from public.txns where txn_no = '$txn'")
for who in "$TELLER" ""; do
  out=$(rpc "$A" reverse_txn "{\"p_id\":\"$(uuidgen)\",\"p_original_id\":\"$id\",\"p_reason\":\"金额录错\"}" $who)
  grep -q "$([ -n "$who" ] && echo REVERSAL_NOT_ALLOWED || echo TERM_CLOSED)" <<<"$out" || fail "冲正 of an old term's deposit: $out"
done
report | diff - "$WORK/report1" >&2 || fail "today's business changed the old term's report"
pass "today's business is recorded in the new term: a teller's deposit leaves the old term's report as it was, and its 冲正 is refused (teller REVERSAL_NOT_ALLOWED, bank admin TERM_CLOSED)"

# 补录 and 编辑 do change it, at the original time.
ok "$A" manual_entry "{\"p_id\":\"$(uuidgen)\",\"p_student_no\":\"70000006\",\"p_type\":\"deposit\",
  \"p_occurred_at\":\"$(sq "$A" -c "select date '$E' - 1")T15:00:00+08:00\",\"p_reason\":\"演练：结转后补录\",\"p_denominations\":{\"10\":1}}" >/dev/null
wid=$(sq "$A" -c "select id from public.txns where student_no = '70000001' and type = 'withdraw' and status = 'normal' order by created_at limit 1")
ok "$A" correct_txn "{\"p_id\":\"$(uuidgen)\",\"p_original_id\":\"$wid\",\"p_new\":{\"amount\":30},\"p_reason\":\"金额录错\"}" >/dev/null
after=$(report | jq -r '.balance.closing')
[ "$after" = $((closing + 10 + 10)) ] || fail "after a 补录 of 10 and an 编辑 of a 40 withdrawal to 30 the term closes at $after, not $((closing + 20))"
docker exec "$A" dolphin check >/dev/null 2>&1 || fail "dolphin check after the 补录 and 编辑"
pass "a 补录 (+10) and an 编辑 (withdrawal 40 → 30) in the closed term change its report: closing $closing → $after HTB; dolphin check agrees"
echo "rehearsal ok in $(( $(date +%s) - started ))s"
