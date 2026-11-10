#!/bin/bash
# M0 smoke test: run the image with DOLPHIN_DOMAIN=localhost and check, over HTTPS (Caddy's local CA):
# HTTP → HTTPS redirect, security headers, non-root services, migration checksums, health check, login, lockout,
# password rule, create-admin, RPC, image upload and public read, encrypted backup → change → restore, container restart.
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
login() { # login <email> <password> → prints access token, empty on failure
  http -X POST "$BASE/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$1\",\"password\":\"$2\"}" >/dev/null
  jq -r '.access_token // empty' "$WORK/body"
}

docker run --rm --entrypoint age-keygen "$IMAGE" > "$WORK/backup-key.txt" 2>/dev/null
RECIPIENT=$(sed -n 's/^# public key: //p' "$WORK/backup-key.txt")
docker run -d --name "$NAME" -p 127.0.0.1::443 -p 127.0.0.1::80 -v "$NAME-data:/data" -e DOLPHIN_DOMAIN=localhost -e ACME_EMAIL=it@example.com \
  -e BACKUP_RECIPIENT="$RECIPIENT" "$IMAGE" >/dev/null
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
for p in auth rest storage caddy migrate backup-schedule; do
  pid=$(docker exec "$NAME" supervisorctl pid "$p" || true) # 0 and exit 1 once migrate has finished
  [ "$pid" = 0 ] || [ "$(docker exec "$NAME" stat -c %U "/proc/$pid")" = dolphin ] || fail "$p does not run as dolphin"
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
pass "encrypted backup → change → restore with the key brings back the backed-up state"

docker restart "$NAME" >/dev/null
wait_ready
TOKEN=$(login admin@staff.dolphin.internal Smoke-pass-1)
[ -n "$TOKEN" ] && [ "$(http -X POST "$BASE/rest/v1/rpc/whoami" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN")" = 200 ] || fail "after restart"
pass "data and services survive a container restart"
echo "All M0 checks passed."
