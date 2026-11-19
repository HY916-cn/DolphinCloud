#!/bin/bash
# M0 smoke test: run the image with DOLPHIN_DOMAIN=localhost and check, over HTTPS (Caddy's local CA):
# HTTP → HTTPS redirect, security headers, non-root services, migration checksums, health check, login, lockout,
# password rule, create-admin, RPC, image upload and public read, 公开页面 (server time, rates, 文件传输 through Storage,
# client IPs), encrypted backup → change → restore, the scheduled jobs and their catch-up after a restart, container restart.
# Usage: docker/smoke-test.sh [image]   (default dolphin-cloud:dev). Removes only the container and volume it created.
set -euo pipefail
IMAGE=${1:-dolphin-cloud:dev}
NAME=dolphin-smoke-$$  # unique per run: parallel runs never touch each other's container or volume
WORK=$(mktemp -d)
LOGO="$(cd "$(dirname "$0")/.." && pwd)/design-system/project/assets/Logos/dolphin-cloud-logo.png"

remove() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME-data" >/dev/null 2>&1 || true; }
trap 'remove; rm -rf "$WORK"' EXIT
fail() { echo "FAIL: $*" >&2; docker logs --tail 40 "$NAME" >&2 || true; exit 1; }
pass() { echo "PASS: $*"; }
sql() { docker exec "$NAME" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
http() { curl -sS --cacert "$WORK/root.crt" -o "$WORK/body" -D "$WORK/headers" -w '%{http_code}' "$@"; }
port() { docker port "$NAME" "$1/tcp" | head -1 | sed 's/.*://'; } # Docker picks free host ports, anew on restart
wait_ready() {
  BASE="https://localhost:$(port 443)"
  for _ in $(seq 1 90); do
    if docker exec "$NAME" test -f /data/caddy/caddy/pki/authorities/local/root.crt 2>/dev/null; then
      docker cp -q "$NAME:/data/caddy/caddy/pki/authorities/local/root.crt" "$WORK/root.crt"
      [ "$(http "$BASE/auth/v1/health" 2>/dev/null)" = 200 ] \
        && [ "$(sql "select count(*) from public.app_migrations" 2>/dev/null || echo 0)" -ge 1 ] \
        && [ "$(http "$BASE/storage/v1/status" 2>/dev/null)" = 200 ] && return 0
    fi
    sleep 2
  done
  fail "services not ready"
}
migrate_exited_ok() { # migrate may finish between `supervisorctl pid` and `stat`; supervisorctl status shows no exit code
  docker exec "$NAME" python3 -c 'from xmlrpc.client import ServerProxy; from supervisor.xmlrpc import SupervisorTransport
i = ServerProxy("http://supervisor", SupervisorTransport(None, None, "unix:///run/supervisor.sock")).supervisor.getProcessInfo("migrate")
exit(not (i["pid"] == 0 and i["statename"] == "EXITED" and i["exitstatus"] == 0))'
}
rpc() { # rpc <function> <json> [curl options]: as anon (not signed in)
  http -X POST "$BASE/rest/v1/rpc/$1" -H "apikey: $ANON" -H 'Content-Type: application/json' -d "$2" "${@:3}"
}
login() { # login <email> <password> → prints access token, empty on failure
  http -X POST "$BASE/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" >/dev/null
  jq -r '.access_token // empty' "$WORK/body"
}

docker run --rm --entrypoint age-keygen "$IMAGE" > "$WORK/backup-key.txt" 2>/dev/null
RECIPIENT=$(sed -n 's/^# public key: //p' "$WORK/backup-key.txt")
# Docker forwards the published ports from a private address: Caddy takes a PROXY protocol header from there, if any.
docker run -d --name "$NAME" -p 127.0.0.1::443 -p 127.0.0.1::80 -v "$NAME-data:/data" -e DOLPHIN_DOMAIN=localhost -e ACME_EMAIL=it@example.com \
  -e BACKUP_RECIPIENT="$RECIPIENT" -e DOLPHIN_PROXY_PROTOCOL="10.0.0.0/8 172.16.0.0/12 192.168.0.0/16 127.0.0.0/8" "$IMAGE" >/dev/null
wait_ready
ANON=$(docker exec "$NAME" sh -c '. /data/secrets/env && echo "$ANON_KEY"')
SERVICE=$(docker exec "$NAME" sh -c '. /data/secrets/env && echo "$SERVICE_ROLE_KEY"')

[ "$(http "$BASE/")" = 200 ] && grep -q 海豚云 "$WORK/body" || fail "static site"
[ "$(http "$BASE/config.js")" = 200 ] && grep -q "$ANON" "$WORK/body" && ! grep -q "$SERVICE" "$WORK/body" || fail "config.js"
pass "HTTPS static site and config.js (anon key only)"

code=$(http "http://localhost:$(port 80)/smoke/path?q=1")
location=$(awk 'tolower($1) == "location:" { print $2 }' "$WORK/headers" | tr -d '\r')
{ [ "$code" = 301 ] || [ "$code" = 308 ]; } && [ "$location" = "https://localhost/smoke/path?q=1" ] \
  || fail "port 80 answered $code, Location: $location"
pass "HTTP on port 80 redirects to the same path over HTTPS"

http "$BASE/" >/dev/null
grep -qi '^x-frame-options: DENY' "$WORK/headers" && grep -qi "^content-security-policy:.*frame-ancestors 'none'" "$WORK/headers" \
  || fail "site headers: $(cat "$WORK/headers")"
for p in auth rest storage caddy migrate backup-schedule dolphin-jobs; do
  pid=$(docker exec "$NAME" supervisorctl pid "$p" || true) # 0 and exit 1 once migrate has finished
  [ "$pid" = 0 ] || [ "$(docker exec "$NAME" stat -c %U "/proc/$pid")" = dolphin ] \
    || { [ "$p" = migrate ] && migrate_exited_ok; } || fail "$p does not run as dolphin"
done
pass "the site cannot be framed; services run as dolphin"

FIRST=$(sql "select name from public.app_migrations order by name limit 1")
[ "$(sql "select count(*) from public.app_migrations where checksum is null")" = 0 ] || fail "migrations without checksum"
SUM=$(sql "select checksum from public.app_migrations where name = '$FIRST'")
sql "update public.app_migrations set checksum = 'edited' where name = '$FIRST'"
! docker exec -u dolphin "$NAME" dolphin-migrate >/dev/null 2>&1 || fail "dolphin-migrate ran over an edited migration"
sql "update public.app_migrations set checksum = '$SUM' where name = '$FIRST'"
docker exec -u dolphin "$NAME" dolphin-migrate >/dev/null || fail "dolphin-migrate"
pass "applied migrations are checksummed; a changed one stops dolphin-migrate"

docker exec "$NAME" dolphin health || fail "dolphin health"
[ "$(docker inspect -f '{{.Config.Healthcheck.Test}}' "$NAME")" = '[CMD dolphin health]' ] || fail "image has no HEALTHCHECK"
pass "the image's health check passes"

docker exec "$NAME" supervisorctl status dolphin-jobs | grep -q RUNNING || fail "dolphin-jobs is not running"
YESTERDAY=$(sql "select app_private.cn_date(now()) - 1")
JOBS=$(docker exec "$NAME" dolphin jobs) || fail "dolphin jobs"
grep -q "^daily  done to $YESTERDAY, last ok " <<<"$JOBS" && grep -q '^weekly done to ' <<<"$JOBS" && grep -q '^term:  none' <<<"$JOBS" \
  || fail "dolphin jobs: $JOBS"
docker exec "$NAME" dolphin status | grep -q "^jobs: ok, daily done to $YESTERDAY" || fail "dolphin status has no jobs line"
# On a Monday this week's weekly job may still wait for dolphin-jobs, whose start fetches the 理财 closes first (up to a
# minute, depending on the network): one run catches up whatever is left, and then there is nothing to do.
OUT=$(docker exec "$NAME" dolphin jobs run) || fail "dolphin jobs run: $OUT"
grep -qvE "^(Nothing to catch up|weekly $(sql "select app_private.cn_date(now())") done)\$" <<<"$OUT" && fail "dolphin jobs run caught up more than today's weekly job: $OUT"
[ "$(docker exec "$NAME" dolphin jobs run)" = "Nothing to catch up" ] || fail "dolphin jobs run when up to date"
pass "dolphin-jobs runs; dolphin jobs and dolphin status show the jobs up to yesterday"

USER_ID=$(sql "select app_private.create_login('admin@staff.dolphin.internal', 'Smoke-pass-1')")
TOKEN=$(login admin@staff.dolphin.internal Smoke-pass-1)
[ -n "$TOKEN" ] || fail "login: $(cat "$WORK/body")"
[ -z "$(login admin@staff.dolphin.internal wrong-password)" ] || fail "wrong password accepted"
pass "login with SQL-created account; wrong password rejected"

sql "select app_private.create_login('locked@staff.dolphin.internal', 'Smoke-pass-3')" >/dev/null
for _ in 1 2 3 4 5; do login locked@staff.dolphin.internal wrong-password >/dev/null; done
grep -q LOGIN_LOCKED "$WORK/body" || fail "fifth wrong password: $(cat "$WORK/body")"
[ -z "$(login locked@staff.dolphin.internal Smoke-pass-3)" ] && grep -q LOGIN_LOCKED "$WORK/body" || fail "locked login signed in"
[ "$(sql "select count(*) from public.audit_log where action = 'login.locked'")" = 1 ] || fail "refused attempt not audited"
pass "five wrong passwords through Auth lock the login, even against the right password"

ADMIN_PW=$(docker exec "$NAME" dolphin create-admin smokeadmin | sed -n 's/.*Initial password: //p')
[ -n "$ADMIN_PW" ] && [ -n "$(login smokeadmin@staff.dolphin.internal "$ADMIN_PW")" ] || fail "create-admin password: $(cat "$WORK/body")"
pass "create-admin prints a working initial password"

set_password() { http -X PUT "$BASE/auth/v1/user" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"password\":\"$1\"}"; }
for short in 1234567 abc1234; do
  code=$(set_password "$short")
  [ "$code" = 422 ] && grep -q weak_password "$WORK/body" || fail "password $short accepted ($code): $(cat "$WORK/body")"
done
[ "$(set_password 12345678)" = 200 ] && [ "$(set_password Smoke-pass-1)" = 200 ] || fail "valid password refused: $(cat "$WORK/body")"
pass "passwords need at least 8 characters; all digits is allowed"

[ "$(http -X POST "$BASE/rest/v1/rpc/whoami" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN")" = 200 ] || fail "rpc: $(cat "$WORK/body")"
[ "$(jq -r .user_id "$WORK/body")" = "$USER_ID" ] && [ "$(jq -r .role "$WORK/body")" = authenticated ] || fail "whoami: $(cat "$WORK/body")"
code=$(http -X POST "$BASE/rest/v1/rpc/whoami" -H "apikey: $ANON")
[ "$code" = 401 ] || [ "$code" = 404 ] || fail "anon may call whoami ($code)"
pass "RPC returns the caller's id; anon is refused"

TOKEN=$(login admin@staff.dolphin.internal Smoke-pass-1)
[ "$(http -X POST "$BASE/rest/v1/rpc/note_login" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'X-Device-Id: smoke-pad')" = 200 ] \
  && [ "$(jq -r .noted "$WORK/body")" = true ] || fail "note_login: $(cat "$WORK/body")"
[ -n "$(sql "select ip from public.audit_log where action = 'login.ok' and device_id = 'smoke-pad' and ip <> ''")" ] || fail "sign-in IP not recorded"
pass "a sign-in notes its device and IP through Caddy"

OBJ="$BASE/storage/v1/object/product-images/smoke/logo.png"
code=$(http -X POST "$OBJ" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: image/png' --data-binary @"$LOGO")
[ "$code" -ge 400 ] || fail "user without upload policy could upload ($code)"
[ "$(http -X POST "$OBJ" -H "apikey: $ANON" -H "Authorization: Bearer $SERVICE" -H 'Content-Type: image/png' --data-binary @"$LOGO")" = 200 ] || fail "upload: $(cat "$WORK/body")"
[ "$(http "$BASE/storage/v1/object/public/product-images/smoke/logo.png")" = 200 ] && cmp -s "$WORK/body" "$LOGO" || fail "public read"
grep -qi "^content-security-policy: default-src 'none'; sandbox" "$WORK/headers" && grep -qi '^x-content-type-options: nosniff' "$WORK/headers" \
  || fail "storage headers: $(cat "$WORK/headers")"
pass "image upload (RLS blocks users without a policy) and public read, sandboxed by CSP"

# 公开页面 (PHASE-2.md §16.4), not signed in.
[ "$(rpc server_time '{}')" = 200 ] && [ $(( $(cat "$WORK/body") / 1000 - $(date +%s) )) -ge -5 ] \
  && [ $(( $(cat "$WORK/body") / 1000 - $(date +%s) )) -le 5 ] || fail "server_time: $(cat "$WORK/body")"
[ "$(rpc public_rates '{}')" = 200 ] && jq -e '(.scores | length) == 4 and (.term | length) == 5 and (.wealth.tiers | length) == 3 and (has("anchor") | not)' "$WORK/body" >/dev/null \
  || fail "public_rates: $(cat "$WORK/body")"
pass "server_time and public_rates answer anon"

# 文件传输: two files and one of 100 MB through Storage's signed URLs, a code, and the downloads.
TRANSFERS=/data/storage/files/dolphin/transfers
printf '海豚云 smoke\n' > "$WORK/a.txt"
head -c 104857600 /dev/zero > "$WORK/big.bin"
head -c 104857601 /dev/zero > "$WORK/too-big.bin"
FILES=$(jq -nc --argjson a "$(wc -c < "$WORK/a.txt")" --argjson l "$(wc -c < "$LOGO")" \
  '[{name: "报告 v2.txt", size: $a}, {name: "logo.png", size: $l}, {name: "big.bin", size: 104857600}]')
[ "$(rpc create_transfer "{\"p_files\":$FILES}" -H 'X-Forwarded-For: 203.0.113.99')" = 200 ] || fail "create_transfer: $(cat "$WORK/body")"
cp "$WORK/body" "$WORK/transfer.json"
ID=$(jq -r .id "$WORK/transfer.json")
put() { http -X PUT "$BASE$(jq -r ".files[$1].url" "$WORK/transfer.json")" -H "Content-Type: $2" --data-binary @"$3"; }
IP=$(sql "select ip from public.transfers where id = '$ID'")
[ -n "$IP" ] && [ "$IP" != 203.0.113.99 ] || fail "the client IP is the one the request claimed: $IP"
[ "$(rpc finish_transfer "{\"p_id\":\"$ID\"}")" = 400 ] && [ "$(jq -r .message "$WORK/body")" = TRANSFER_INCOMPLETE ] \
  || fail "finished before the uploads: $(cat "$WORK/body")"
[ "$(put 0 'text/plain; charset=utf-8' "$WORK/a.txt")" = 200 ] && [ "$(put 1 image/png "$LOGO")" = 200 ] || fail "upload: $(cat "$WORK/body")"
[ "$(put 2 application/octet-stream "$WORK/too-big.bin")" = 400 ] && grep -q EntityTooLarge "$WORK/body" || fail "a file over 100 MB was taken: $(cat "$WORK/body")"
[ "$(put 2 application/octet-stream "$WORK/big.bin")" = 200 ] || fail "a file of 100 MB was refused: $(cat "$WORK/body")"
code=$(http -X PUT "$BASE$(jq -r '.files[0].url' "$WORK/transfer.json" | sed 's#/1?token#/9?token#')" --data-binary @"$WORK/a.txt")
[ "$code" -ge 400 ] || fail "an upload URL put another object ($code)"
[ "$(rpc finish_transfer "{\"p_id\":\"$ID\"}")" = 200 ] || fail "finish_transfer: $(cat "$WORK/body")"
CODE=$(jq -r .code "$WORK/body")
[ "$(rpc open_transfer '{"p_code":"x0x0"}')" = 400 ] && [ "$(jq -r .message "$WORK/body")" = TRANSFER_NOT_FOUND ] \
  && [ "$(sql "select count(*) from public.transfer_misses where ip = '$IP'")" = 1 ] || fail "a wrong code: $(cat "$WORK/body")"
[ "$(rpc open_transfer "{\"p_code\":\"$CODE\"}")" = 200 ] && [ "$(jq '.files | length' "$WORK/body")" = 3 ] || fail "open_transfer: $(cat "$WORK/body")"
cp "$WORK/body" "$WORK/opened.json"
get() { http "$BASE$(jq -r ".files[$1].url" "$WORK/opened.json")"; }
[ "$(get 0)" = 200 ] && cmp -s "$WORK/body" "$WORK/a.txt" \
  && grep -qi "^content-disposition: attachment; .*filename\*=UTF-8''%E6%8A%A5%E5%91%8A%20v2.txt" "$WORK/headers" \
  && grep -qi "^content-security-policy: default-src 'none'; sandbox" "$WORK/headers" || fail "download: $(cat "$WORK/headers")"
[ "$(get 1)" = 200 ] && cmp -s "$WORK/body" "$LOGO" && [ "$(get 2)" = 200 ] && cmp -s "$WORK/body" "$WORK/big.bin" || fail "downloads"
code=$(http "$BASE$(jq -r '.files[0].url' "$WORK/opened.json" | sed 's#/1?token#/2?token#')")
[ "$code" -ge 400 ] || fail "a download URL read another object ($code)"
[ "$(http "$BASE$(jq -r '.files[0].url' "$WORK/transfer.json")")" -ge 400 ] || fail "an upload URL downloads"
code=$(http "$BASE/storage/v1/object/transfers/$ID/1" -H "apikey: $ANON")
[ "$code" -ge 400 ] || fail "the bucket is readable without a signed URL ($code)"
pass "文件传输: uploads (100 MB, not more) through signed URLs, a code, downloads saved under their names; the client IP is Caddy's"

[ "$(curl -sS --cacert "$WORK/root.crt" --haproxy-clientip 198.51.100.7 -o "$WORK/body" -w '%{http_code}' -X POST "$BASE/rest/v1/rpc/create_transfer" \
  -H "apikey: $ANON" -H 'Content-Type: application/json' -d '{"p_files":[{"name":"a","size":1}]}')" = 200 ] \
  && [ "$(sql "select ip from public.transfers where id = '$(jq -r .id "$WORK/body")'")" = 198.51.100.7 ] || fail "PROXY protocol: $(cat "$WORK/body")"
pass "behind a forwarder in DOLPHIN_PROXY_PROTOCOL, the client IP is the PROXY protocol header's"

sql "update public.profiles set must_change_password = false where login_id = 'smokeadmin'" # as after setting a new password
ADMIN_TOKEN=$(login smokeadmin@staff.dolphin.internal "$ADMIN_PW")
[ "$(http -X POST "$BASE/rest/v1/rpc/list_transfers" -H "apikey: $ANON" -H "Authorization: Bearer $ADMIN_TOKEN")" = 200 ] \
  && [ "$(jq -r ".transfers[] | select(.id == \"$ID\") | .ip" "$WORK/body")" = "$IP" ] || fail "list_transfers: $(cat "$WORK/body")"
[ "$(http -X POST "$BASE/rest/v1/rpc/delete_transfer" -H "apikey: $ANON" -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'Content-Type: application/json' -d "$(jq -nc --arg id "$ID" '{p_id: $id, p_reason: "冒烟测试"}')")" = 200 ] || fail "delete_transfer: $(cat "$WORK/body")"
[ "$(get 0)" -ge 400 ] || fail "a deleted transfer still downloads"
docker exec "$NAME" test -d "$TRANSFERS/$ID" || fail "no files on disk at $TRANSFERS/$ID"
docker exec "$NAME" touch -d '4 hours ago' "$TRANSFERS/$ID"
docker exec -u dolphin "$NAME" dolphin jobs clean >/dev/null || fail "dolphin jobs clean"
! docker exec "$NAME" test -e "$TRANSFERS/$ID" || fail "dolphin jobs clean left the deleted transfer's files"
docker exec -u dolphin "$NAME" dolphin jobs clean >/dev/null || fail "dolphin jobs clean again"
pass "the bank admin lists and deletes a transfer; downloads stop, and dolphin jobs clean removes its files"

# A transfer at backup time is not in the backup.
rpc create_transfer '{"p_files":[{"name":"a.txt","size":1}]}' >/dev/null && cp "$WORK/body" "$WORK/transfer.json"
printf x > "$WORK/x.txt"
[ "$(put 0 text/plain "$WORK/x.txt")" = 200 ] || fail "upload before the backup: $(cat "$WORK/body")"

BACKUP=$(docker exec "$NAME" dolphin backup | tail -1)
[ "$(docker exec "$NAME" stat -c %a /data/backups "$BACKUP" | tr '\n' ' ')" = '700 600 ' ] || fail "backup permissions"
[ "$(sql "select count(*) from public.audit_log where action = 'backup.create' and after ->> 'file' = '$(basename "$BACKUP")'")" = 1 ] \
  || fail "backup not in audit_log"
sql "select app_private.create_login('after@staff.dolphin.internal', 'Smoke-pass-2')" >/dev/null
[ "$(http -X DELETE "$OBJ" -H "apikey: $ANON" -H "Authorization: Bearer $SERVICE")" = 200 ] || fail "delete object"
[ "${BACKUP##*.}" = age ] && [ "$(docker exec "$NAME" head -c 21 "$BACKUP")" = age-encryption.org/v1 ] || fail "backup not encrypted: $BACKUP"
! docker exec "$NAME" dolphin restore "$(basename "$BACKUP")" </dev/null >/dev/null 2>&1 || fail "restored without the key"
docker exec -i "$NAME" dolphin restore "$(basename "$BACKUP")" < "$WORK/backup-key.txt" >/dev/null
wait_ready
[ -z "$(login after@staff.dolphin.internal Smoke-pass-2)" ] || fail "account created after backup survived restore"
[ -n "$(login admin@staff.dolphin.internal Smoke-pass-1)" ] || fail "account lost in restore"
[ "$(sql "select count(*) from public.audit_log where action = 'backup.restore'")" = 1 ] || fail "restore not in audit_log"
[ "$(http "$BASE/storage/v1/object/public/product-images/smoke/logo.png")" = 200 ] && cmp -s "$WORK/body" "$LOGO" || fail "image lost in restore"
[ "$(sql "select count(*) from public.transfers")" = 0 ] && ! docker exec "$NAME" test -e "$TRANSFERS" || fail "文件传输 came back from the backup"
[ "$(rpc create_transfer '{"p_files":[{"name":"a.txt","size":1}]}')" = 200 ] && cp "$WORK/body" "$WORK/transfer.json" \
  && [ "$(put 0 text/plain "$WORK/x.txt")" = 200 ] || fail "upload after the restore: $(cat "$WORK/body")"
pass "encrypted backup → change → restore with the key brings back the backed-up state, without 文件传输"

# Three days missed: dolphin-jobs catches up when the container starts again.
sql "update public.job_runs set done_to = done_to - 3 where job = 'daily'"
docker restart "$NAME" >/dev/null
wait_ready
for _ in $(seq 1 30); do
  [ "$(sql "select done_to from public.job_runs where job = 'daily'")" = "$YESTERDAY" ] && break
  sleep 2
done
[ "$(sql "select done_to from public.job_runs where job = 'daily'")" = "$YESTERDAY" ] || fail "jobs not caught up after a restart: $(docker exec "$NAME" dolphin jobs)"
pass "after a restart dolphin-jobs catches up the days missed"
TOKEN=$(login admin@staff.dolphin.internal Smoke-pass-1)
[ -n "$TOKEN" ] && [ "$(http -X POST "$BASE/rest/v1/rpc/whoami" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN")" = 200 ] || fail "after restart"
pass "data and services survive a container restart"
echo "All M0 checks passed."
