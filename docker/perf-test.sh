#!/bin/bash
# Performance at full school size (PHASE-1.md §10): a fresh container with the seed, 2000 students imported through
# import_roster in batches of 100, and 100 000 transactions. Times the reads and functions the acceptance names and
# times 报表 and the 流水 export, and checks that no role can change balances, stock or the ledger through the API.
# Usage: docker/perf-test.sh [image]   (default dolphin-cloud:dev). KEEP=1 leaves the container on https://localhost:18446.
set -euo pipefail
IMAGE=${1:-dolphin-cloud:dev}
NAME=dolphin-perf
BASE=https://localhost:18446
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

remove() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME-data" >/dev/null 2>&1 || true; }
[ "${KEEP:-}" = 1 ] || trap remove EXIT
remove
docker run -d --name "$NAME" -p 18446:443 -v "$NAME-data:/data" -e DOLPHIN_DOMAIN=localhost "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
  [ "$(curl -sk -o /dev/null -w '%{http_code}' "$BASE/auth/v1/health")" = 200 ] \
    && docker exec "$NAME" psql -U postgres -qAt -c "select 1 from public.settings limit 1" >/dev/null 2>&1 && break
  sleep 2
done
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q < "$ROOT/supabase/seed.sql"
psql() { docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -qAt "$@"; }

ANON=$(curl -sk "$BASE/config.js" | sed -E 's/.*"anonKey":"([^"]+)".*/\1/')
token() { curl -sk "$BASE/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"a12345678\"}" | sed -E 's/.*"access_token":"([^"]+)".*/\1/'; }
api() { local who=$1; shift; curl -sk -H "apikey: $ANON" -H "Authorization: Bearer $who" -H 'Content-Type: application/json' "$@"; }
TEACHER=$(token admin@staff.dolphin.internal)
TELLER=$(token teller01@staff.dolphin.internal)
fail() { echo "FAIL: $*" >&2; exit 1; }
# The time of one request that must answer 200.
timed() { local out; out=$(api "$@" -o /dev/null -w '%{http_code} %{time_total}'); [ "${out% *}" = 200 ] || fail "request answered ${out% *}"; echo "${out#* }"; }
under() { awk -v t="$1" -v max="$2" 'BEGIN { exit !(t < max) }' || fail "$3 took ${1}s (limit ${2}s)"; echo "$3: ${1}s"; }

# 2000 students through the import, as the teacher does it: 20 batches of 100.
start=$(date +%s)
for b in $(seq 0 19); do
  rows=$(seq $((b * 100 + 1)) $((b * 100 + 100)) | awk '{ printf "%s{\"student_no\":\"3%07d\",\"name\":\"学生%d\",\"division\":\"%s\",\"cohort\":%d,\"class_no\":%d,\"opening_balance\":%d}", (NR > 1 ? "," : ""), $1, $1, ($1 % 3 ? "primary" : "junior"), ($1 % 3 ? 2021 + $1 % 6 : 2024 + $1 % 3), 1 + $1 % 8, $1 % 50 }')
  out=$(api "$TEACHER" "$BASE/rest/v1/rpc/import_roster" -d "{\"p_rows\":[$rows]}")
  case $out in *'"created"'*) ;; *) fail "import batch $b: $out" ;; esac
done
echo "import 2000 students: $(( $(date +%s) - start ))s"

# 100 000 deposits spread over every student, with balances kept equal to the ledger.
psql <<'SQL'
create temp table load as
select s.student_no, t.i, 1 + t.i % 20 as amount
from generate_series(1, 100000) as t(i)
join (select student_no, row_number() over (order by student_no) - 1 as n from public.students) s
  on s.n = t.i % (select count(*) from public.students);
insert into public.txns (id, type, student_no, amount, balance_delta, balance_after, operator_id, created_at)
select gen_random_uuid(), 'deposit', l.student_no, l.amount, l.amount, a.balance + sum(l.amount) over (partition by l.student_no order by l.i),
       (select id from public.profiles where login_id = 'teller01'), now() - make_interval(mins => 100001 - l.i)
from load l join public.accounts a using (student_no);
update public.accounts a set balance = a.balance + d.total, total_in = a.total_in + d.total
from (select student_no, sum(amount) as total from load group by student_no) d where a.student_no = d.student_no;
analyze;
SQL
echo "transactions: $(psql -c 'select count(*) from public.txns')"
docker exec "$NAME" dolphin check | tail -1 | grep -q 'match' || fail 'balances do not match the ledger after loading'

# The student home (§12.2: balance and the last 10 transactions within 2 s) and the accounting functions (< 1 s).
STUDENT=$(token 30001000@student.dolphin.internal)
t=$(timed "$STUDENT" "$BASE/rest/v1/accounts?select=balance&student_no=eq.30001000")
t2=$(timed "$STUDENT" "$BASE/rest/v1/txns?select=id,type,amount,balance_delta,payment,status,reason,created_at,txn_items(name,qty)&student_no=eq.30001000&balance_delta=neq.0&order=seq.desc&limit=10")
under "$(awk -v a="$t" -v b="$t2" 'BEGIN { print (a > b ? a : b) }')" 2 'student home reads'
t=$(timed "$TELLER" "$BASE/rest/v1/rpc/deposit" \
  -d "{\"p_id\":\"$(uuidgen | tr A-Z a-z)\",\"p_student_no\":\"30000500\",\"p_denominations\":{\"10\":1}}")
under "$t" 1 'deposit'
t=$(timed "$TELLER" "$BASE/rest/v1/rpc/withdraw" \
  -d "{\"p_id\":\"$(uuidgen | tr A-Z a-z)\",\"p_student_no\":\"30000500\",\"p_amount\":5}")
under "$t" 1 'withdraw'
t=$(timed "$TEACHER" "$BASE/rest/v1/txns?select=id,txn_no,type,amount&order=seq.desc&limit=50")
under "$t" 1 'back-office ledger page'
# 报表 over a whole year of every student (the longest range the page offers), and the 流水 export read page by page.
t=$(timed "$TEACHER" "$BASE/rest/v1/rpc/bank_report" -d "{\"p_from\":\"$(date -u -d '-365 days' +%F 2>/dev/null || date -u -v-365d +%F)\",\"p_to\":\"$(date -u +%F)\"}")
under "$t" 5 'bank_report, one year, every student'
t=$(timed "$TEACHER" "$BASE/rest/v1/txns?select=txn_no,type,amount,balance_delta,created_at,student_no,students(name)&order=seq.desc&offset=99000&limit=1000")
under "$t" 2 'ledger export, last page of 1000'
start=$(date +%s); docker exec "$NAME" dolphin check | tail -1; echo "dolphin check: $(( $(date +%s) - start ))s"

# No role changes balances, stock or the ledger directly; each answer must leave the data as it was.
before=$(psql -c "select balance from public.accounts where student_no = '30000001'")
for who in TEACHER TELLER STUDENT; do
  api "${!who}" -o /dev/null -X PATCH "$BASE/rest/v1/accounts?student_no=eq.30000001" -d '{"balance":999999}'
  api "${!who}" -o /dev/null -X DELETE "$BASE/rest/v1/txns?student_no=eq.30000001"
  api "${!who}" -o /dev/null -X PATCH "$BASE/rest/v1/txns?student_no=eq.30000001" -d '{"amount":1}'
  api "${!who}" -o /dev/null -X POST "$BASE/rest/v1/txns" -d '{"type":"deposit","student_no":"30000001","amount":5,"balance_delta":5,"balance_after":5,"operator_id":"00000000-0000-0000-0000-000000000000","txn_no":"X"}'
  api "${!who}" -o /dev/null -X PATCH "$BASE/rest/v1/products?id=not.is.null" -d '{"stock":999}'
done
[ "$(psql -c "select balance from public.accounts where student_no = '30000001'")" = "$before" ] || fail 'a direct request changed a balance'
[ "$(psql -c "select count(*) from public.products where stock = 999")" = 0 ] || fail 'a direct request changed stock'
docker exec "$NAME" dolphin check | tail -1 | grep -q 'match' || fail 'direct requests changed the ledger'
echo 'direct changes to balances, stock and transactions: refused'
echo 'perf ok'
