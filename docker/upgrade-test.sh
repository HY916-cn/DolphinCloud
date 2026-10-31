#!/bin/bash
# Upgrade test: build the image of an earlier commit, fill it with that commit's supabase/seed.sql, then start the new
# image on the same volume and check that it migrates, backs up first, keeps every balance and stock, still passes
# `dolphin check`, and that a seed login still signs in over HTTPS.
# Usage: docker/upgrade-test.sh <old git ref> [new image]   (e.g. the commit running in production; default dolphin-cloud:dev).
# Removes its own containers, volume and old image.
set -euo pipefail
OLD_REF=${1:?usage: docker/upgrade-test.sh <old git ref> [new image]}
IMAGE=${2:-dolphin-cloud:dev}
OLD_IMAGE=dolphin-cloud:upgrade-old
NAME=dolphin-upgrade
PORT=18447
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d)

remove() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap 'remove; docker volume rm "$NAME-data" >/dev/null 2>&1 || true; docker rmi "$OLD_IMAGE" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
fail() { echo "FAIL: $*" >&2; docker logs --tail 40 "$NAME" >&2 || true; exit 1; }
pass() { echo "PASS: $*"; }
sql() { docker exec "$NAME" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
start() { # start <image> <number of migrations it must apply>
  docker run -d --name "$NAME" -p "$PORT:443" -v "$NAME-data:/data" -e DOLPHIN_DOMAIN=localhost "$1" >/dev/null
  for _ in $(seq 1 90); do
    [ "$(curl -sk -o /dev/null -w '%{http_code}' "https://localhost:$PORT/auth/v1/health")" = 200 ] \
      && [ "$(sql "select count(*) from public.app_migrations" 2>/dev/null)" = "$2" ] && return 0
    sleep 2
  done
  fail "$1 did not finish its $2 migrations"
}
ledger() { sql "select string_agg(student_no || '=' || balance, ' ' order by student_no) from public.accounts" \
  && sql "select string_agg(name || '=' || stock, ' ' order by name) from public.products"; }

git -C "$ROOT" archive --format=tar "$OLD_REF" | docker build -q --build-arg DOLPHIN_VERSION=upgrade-old -t "$OLD_IMAGE" -f docker/Dockerfile - >/dev/null
docker volume rm "$NAME-data" >/dev/null 2>&1 || true
remove
start "$OLD_IMAGE" "$(git -C "$ROOT" ls-tree --name-only "$OLD_REF" supabase/migrations/ | grep -c '\.sql$')"
git -C "$ROOT" show "$OLD_REF:supabase/seed.sql" | docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q
docker exec "$NAME" dolphin check >/dev/null || fail "old image: dolphin check"
ledger > "$WORK/before"
pass "$OLD_REF: migrated, seeded, ledger checked"

remove
start "$IMAGE" "$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')"
[ -n "$(docker exec "$NAME" dolphin backups)" ] || fail "no backup before the upgrade migrated"
docker exec "$NAME" dolphin check || fail "new image: dolphin check"
ledger > "$WORK/after"
diff "$WORK/before" "$WORK/after" || fail "balances or stock changed in the upgrade"
docker exec "$NAME" dolphin health || fail "health check"
ANON=$(docker exec "$NAME" sh -c '. /data/secrets/env && echo "$ANON_KEY"')
curl -sk -X POST "https://localhost:$PORT/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d '{"email":"20260001@student.dolphin.internal","password":"a12345678"}' | jq -e .access_token >/dev/null || fail "seed login after the upgrade"
pass "$IMAGE: backed up, migrated, same balances and stock, ledger checked, healthy, seed login signs in"
echo "Upgrade from $OLD_REF passed."
