#!/bin/bash
# End-to-end tests (client/e2e, Playwright) against the production image: starts a fresh container on a
# free localhost port, loads supabase/seed.sql, runs the tests, and removes the container and its volume.
# Each spec file starts from the seeded data: resetData (client/e2e/helpers.ts) replays the snapshot taken below.
# Usage: docker/e2e-test.sh [image] [playwright args]   (default dolphin-cloud:dev).
# Needs `npx --prefix client playwright install chromium webkit` once.
set -euo pipefail
IMAGE=${1:-dolphin-cloud:dev}
shift $(( $# > 0 ? 1 : 0 ))
NAME=dolphin-e2e-$$  # unique per run: parallel runs never touch each other's container or volume
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS=$(ls "$ROOT"/supabase/migrations/*.sql | wc -l | tr -d ' ') # the seed needs every migration applied

remove() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME-data" >/dev/null 2>&1 || true; }
trap remove EXIT
docker run -d --name "$NAME" -p 127.0.0.1::443 -v "$NAME-data:/data" -e DOLPHIN_DOMAIN=localhost "$IMAGE" >/dev/null
PORT=$(docker port "$NAME" 443/tcp | head -1 | sed 's/.*://') # Docker picks a free host port
for _ in $(seq 1 90); do
  [ "$(curl -sk -o /dev/null -w '%{http_code}' "https://localhost:$PORT/auth/v1/health")" = 200 ] \
    && [ "$(docker exec "$NAME" psql -U postgres -qAt -c "select count(*) from public.app_migrations" 2>/dev/null)" = "$MIGRATIONS" ] && break
  sleep 2
done
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q < "$ROOT/supabase/seed.sql"
# The snapshot: the seeded rows of every app, Auth and Storage table plus the stored files, restored without
# replacing tables, so Auth, PostgREST and Storage keep their connections. Replica mode skips triggers and foreign
# keys (txns refers to itself) while it truncates and reloads.
docker exec -i "$NAME" sh -e <<'SH'
{ echo "set session_replication_role = replica;"
  psql -U postgres -qAt -c "select 'truncate ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ';'
    from pg_tables where schemaname in ('public', 'app_private', 'auth', 'storage')"
  pg_dump -U postgres --data-only -n public -n app_private -n auth -n storage postgres 2>/dev/null # warns about txns' self-reference
} > /tmp/e2e-seed.sql
tar -cf /tmp/e2e-storage.tar -C /data storage
SH
(cd "$ROOT/client" && E2E_BASE="https://localhost:$PORT" E2E_CONTAINER="$NAME" npx playwright test "$@")
docker exec "$NAME" dolphin check
