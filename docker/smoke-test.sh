#!/bin/bash
# M0 smoke test: run the image with DOLPHIN_DOMAIN=localhost and check, over HTTPS (Caddy's local CA):
# login, password rule, RPC, image upload and public read, backup → change → restore, container restart.
# Usage: docker/smoke-test.sh [image]   (default dolphin-cloud:dev). Removes its own container and volume.
set -euo pipefail
IMAGE=${1:-dolphin-cloud:dev}
NAME=dolphin-smoke
PORT=18443
BASE="https://localhost:$PORT"
WORK=$(mktemp -d)
LOGO="$(cd "$(dirname "$0")/.." && pwd)/design-system/project/assets/Logos/dolphin-cloud-logo.png"

remove() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME-data" >/dev/null 2>&1 || true; }
trap 'remove; rm -rf "$WORK"' EXIT
fail() { echo "FAIL: $*" >&2; docker logs --tail 40 "$NAME" >&2 || true; exit 1; }
pass() { echo "PASS: $*"; }
sql() { docker exec "$NAME" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
http() { curl -sS --cacert "$WORK/root.crt" -o "$WORK/body" -w '%{http_code}' "$@"; }
wait_ready() {
  for _ in $(seq 1 90); do
    if docker exec "$NAME" test -f /data/caddy/caddy/pki/authorities/local/root.crt 2>/dev/null; then
      docker cp -q "$NAME:/data/caddy/caddy/pki/authorities/local/root.crt" "$WORK/root.crt"
      [ "$(http "$BASE/auth/v1/health" 2>/dev/null)" = 200 ] \
        && [ "$(sql "select count(*) from public.app_migrations" 2>/dev/null)" -ge 1 ] \
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

remove
docker run -d --name "$NAME" -p "$PORT:443" -v "$NAME-data:/data" -e DOLPHIN_DOMAIN=localhost -e ACME_EMAIL=it@example.com "$IMAGE" >/dev/null
wait_ready
ANON=$(docker exec "$NAME" sh -c '. /data/secrets/env && echo "$ANON_KEY"')
SERVICE=$(docker exec "$NAME" sh -c '. /data/secrets/env && echo "$SERVICE_ROLE_KEY"')

[ "$(http "$BASE/")" = 200 ] && grep -q 海豚云 "$WORK/body" || fail "static site"
[ "$(http "$BASE/config.js")" = 200 ] && grep -q "$ANON" "$WORK/body" && ! grep -q "$SERVICE" "$WORK/body" || fail "config.js"
pass "HTTPS static site and config.js (anon key only)"

USER_ID=$(sql "select app_private.create_login('teacher01@staff.dolphin.internal', 'Smoke-pass-1')")
TOKEN=$(login teacher01@staff.dolphin.internal Smoke-pass-1)
[ -n "$TOKEN" ] || fail "login: $(cat "$WORK/body")"
[ -z "$(login teacher01@staff.dolphin.internal wrong-password)" ] || fail "wrong password accepted"
pass "login with SQL-created account; wrong password rejected"

set_password() { http -X PUT "$BASE/auth/v1/user" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"password\":\"$1\"}"; }
for weak in abcdefgh 12345678 abc1234; do
  code=$(set_password "$weak")
  [ "$code" = 422 ] && grep -q weak_password "$WORK/body" || fail "password $weak accepted ($code): $(cat "$WORK/body")"
done
[ "$(set_password Smoke-pass-9)" = 200 ] && [ "$(set_password Smoke-pass-1)" = 200 ] || fail "valid password refused: $(cat "$WORK/body")"
pass "passwords need at least 8 characters with a letter and a digit"

[ "$(http -X POST "$BASE/rest/v1/rpc/whoami" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN")" = 200 ] || fail "rpc: $(cat "$WORK/body")"
[ "$(jq -r .user_id "$WORK/body")" = "$USER_ID" ] && [ "$(jq -r .role "$WORK/body")" = authenticated ] || fail "whoami: $(cat "$WORK/body")"
code=$(http -X POST "$BASE/rest/v1/rpc/whoami" -H "apikey: $ANON")
[ "$code" = 401 ] || [ "$code" = 404 ] || fail "anon may call whoami ($code)"
pass "RPC returns the caller's id; anon is refused"

OBJ="$BASE/storage/v1/object/product-images/smoke/logo.png"
code=$(http -X POST "$OBJ" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'Content-Type: image/png' --data-binary @"$LOGO")
[ "$code" -ge 400 ] || fail "user without upload policy could upload ($code)"
[ "$(http -X POST "$OBJ" -H "apikey: $ANON" -H "Authorization: Bearer $SERVICE" -H 'Content-Type: image/png' --data-binary @"$LOGO")" = 200 ] || fail "upload: $(cat "$WORK/body")"
[ "$(http "$BASE/storage/v1/object/public/product-images/smoke/logo.png")" = 200 ] && cmp -s "$WORK/body" "$LOGO" || fail "public read"
pass "image upload (RLS blocks users without a policy) and public read"

BACKUP=$(docker exec "$NAME" dolphin backup | tail -1)
sql "select app_private.create_login('after@staff.dolphin.internal', 'Smoke-pass-2')" >/dev/null
[ "$(http -X DELETE "$OBJ" -H "apikey: $ANON" -H "Authorization: Bearer $SERVICE")" = 200 ] || fail "delete object"
docker exec "$NAME" dolphin restore "$(basename "$BACKUP")" >/dev/null
wait_ready
[ -z "$(login after@staff.dolphin.internal Smoke-pass-2)" ] || fail "account created after backup survived restore"
[ -n "$(login teacher01@staff.dolphin.internal Smoke-pass-1)" ] || fail "account lost in restore"
[ "$(http "$BASE/storage/v1/object/public/product-images/smoke/logo.png")" = 200 ] && cmp -s "$WORK/body" "$LOGO" || fail "image lost in restore"
pass "backup → change → restore brings back the backed-up state"

docker restart "$NAME" >/dev/null
wait_ready
TOKEN=$(login teacher01@staff.dolphin.internal Smoke-pass-1)
[ -n "$TOKEN" ] && [ "$(http -X POST "$BASE/rest/v1/rpc/whoami" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN")" = 200 ] || fail "after restart"
pass "data and services survive a container restart"
echo "All M0 checks passed."
