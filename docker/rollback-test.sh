#!/bin/bash
# Rollback test, following PHASE-1.md §9.5: build the image of an earlier commit, seed it and take some business, back it
# up (encrypted), upgrade to the new image and take more business, then roll back: start the old image on the same volume
# and restore the backup with the new image's `dolphin`. Checks that the old image is healthy, `dolphin check` passes,
# balances and stock are those of the backup, the schema is exactly the backed-up one, a seed login signs in, the
# commands that wait for migrations answer at once, and the counter takes business again.
# Usage: docker/rollback-test.sh <old git ref> [new image]   (e.g. the commit running in production; default dolphin-cloud:dev).
# Removes only the containers, volume and old image it created.
set -euo pipefail
OLD_REF=${1:?usage: docker/rollback-test.sh <old git ref> [new image]}
IMAGE=${2:-dolphin-cloud:dev}
OLD_IMAGE=dolphin-cloud:rollback-old-$$
NAME=dolphin-rollback-$$  # unique per run: parallel runs never touch each other's container or volume
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d)

remove() { docker rm -f "$NAME" >/dev/null 2>&1 || true; }
trap 'remove; docker volume rm "$NAME-data" >/dev/null 2>&1 || true; docker rmi "$OLD_IMAGE" >/dev/null 2>&1 || true; rm -rf "$WORK"' EXIT
fail() { echo "FAIL: $*" >&2; docker logs --tail 40 "$NAME" >&2 || true; exit 1; }
pass() { echo "PASS: $*"; }
sql() { docker exec "$NAME" psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
healthy() { [ "$(curl -sk -o /dev/null -w '%{http_code}' "https://localhost:$PORT/auth/v1/health")" = 200 ]; }
start() { # start <image>: returns once its dolphin-migrate has finished and Auth answers over HTTPS
  docker run -d --name "$NAME" -p 127.0.0.1::443 -v "$NAME-data:/data" -e DOLPHIN_DOMAIN=localhost \
    -e BACKUP_RECIPIENT="$RECIPIENT" "$1" >/dev/null
  PORT=$(docker port "$NAME" 443/tcp | head -1 | sed 's/.*://') # Docker picks a free host port
  local version; version=$(docker exec "$NAME" printenv DOLPHIN_VERSION)
  for _ in $(seq 1 90); do
    [ "$(docker exec "$NAME" cat /data/run/image-version 2>/dev/null)" = "$version" ] && healthy && return 0
    sleep 2
  done
  fail "$1 did not finish migrating"
}
migrations() { git -C "$ROOT" ls-tree --name-only "$1" supabase/migrations/ | grep -c '\.sql$'; }
ledger() { sql "select string_agg(student_no || '=' || balance, ' ' order by student_no) from public.accounts" \
  && sql "select string_agg(name || '=' || stock, ' ' order by name) from public.products"; }
schema() { docker exec "$NAME" pg_dump -U postgres -s | grep -vE '^\\(un)?restrict '; } # \restrict keys differ per dump
teller() { # teller <sql>: run as teller01, who is on duty since the seed
  sql "select set_config('request.jwt.claims', json_build_object('sub', (select id from public.profiles where login_id = 'teller01'))::text, true); $1" >/dev/null
}
business() { # deposits and a withdrawal at the counter
  teller "select public.deposit(gen_random_uuid(), '20260001', '{\"10\":1,\"5\":1}')"
  teller "select public.withdraw(gen_random_uuid(), '20260002', 5)"
  teller "select public.deposit(gen_random_uuid(), '20260002', '{\"1\":3}')"
}

docker run --rm --entrypoint age-keygen "$IMAGE" > "$WORK/backup-key.txt" 2>/dev/null
RECIPIENT=$(sed -n 's/^# public key: //p' "$WORK/backup-key.txt")

git -C "$ROOT" archive --format=tar "$OLD_REF" | docker build -q --build-arg DOLPHIN_VERSION=rollback-old -t "$OLD_IMAGE" -f docker/Dockerfile - >/dev/null
start "$OLD_IMAGE"
git -C "$ROOT" show "$OLD_REF:supabase/seed.sql" | docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q
business
docker exec "$NAME" dolphin check >/dev/null || fail "old image: dolphin check"
ledger > "$WORK/ledger-before"
schema > "$WORK/schema-before"
BACKUP=$(basename "$(docker exec "$NAME" dolphin backup | tail -1)")
pass "$OLD_REF: seeded, business taken, ledger checked, backed up to $BACKUP"

remove
start "$IMAGE"
[ "$(sql "select count(*) from public.app_migrations")" = "$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ')" ] || fail "upgrade did not migrate"
# 下班 and 上班 again, so the new version's rows refer to the old version's (a cash count refers to its duty).
teller "select public.end_duty((select count(*)::int from public.txns t join public.duty d on d.user_id = t.operator_id
  and d.ended_at is null and t.created_at >= d.started_at))"
teller "select public.start_duty()"
business
docker exec "$NAME" dolphin check >/dev/null || fail "new image: dolphin check"
ledger > "$WORK/ledger-upgraded"
! diff -q "$WORK/ledger-before" "$WORK/ledger-upgraded" >/dev/null || fail "the upgraded image took no business"
pass "$IMAGE: migrated, business taken after 下班 and 上班, ledger checked"

# Roll back as PHASE-1.md §9.5 says: the new image's dolphin restores the backup in the old image.
docker run --rm --entrypoint cat "$IMAGE" /usr/local/bin/dolphin > "$WORK/dolphin-restore"
remove
start "$OLD_IMAGE"
docker cp -q "$WORK/dolphin-restore" "$NAME:/tmp/dolphin-restore"
docker exec -i "$NAME" bash /tmp/dolphin-restore restore "$BACKUP" < "$WORK/backup-key.txt" >/dev/null || fail "restore"
for _ in $(seq 1 30); do healthy && break; sleep 2; done
docker exec "$NAME" dolphin health || fail "health check after the rollback"
docker exec "$NAME" dolphin check >/dev/null || fail "dolphin check after the rollback"
[ "$(sql "select count(*) from public.app_migrations")" = "$(migrations "$OLD_REF")" ] || fail "migration records of the new image left"
schema > "$WORK/schema-after"
diff "$WORK/schema-before" "$WORK/schema-after" >&2 || fail "the schema differs from the backed-up one"
ledger > "$WORK/ledger-after"
diff "$WORK/ledger-before" "$WORK/ledger-after" || fail "balances or stock differ from the backup"
pass "rolled back: healthy, ledger checked, schema exactly the backed-up one, balances and stock as backed up"

docker exec "$NAME" timeout 20 dolphin reset-admin >/dev/null || fail "dolphin reset-admin waited for migrations"
ANON=$(docker exec "$NAME" sh -c '. /data/secrets/env && echo "$ANON_KEY"')
curl -sk -X POST "https://localhost:$PORT/auth/v1/token?grant_type=password" -H "apikey: $ANON" -H 'Content-Type: application/json' \
  -d '{"email":"20260001@student.dolphin.internal","password":"a12345678"}' | jq -e .access_token >/dev/null || fail "seed login after the rollback"
business
docker exec "$NAME" dolphin check >/dev/null || fail "dolphin check after business on the rolled-back image"
pass "$OLD_REF again: commands answer at once, seed login signs in, the counter takes business"
echo "Rollback from $IMAGE to $OLD_REF passed."
