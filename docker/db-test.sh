#!/bin/bash
# Database tests: run the image in a throwaway container and run every supabase/tests/*.sql (pgTAP) against it.
# Usage: docker/db-test.sh [image]   (default dolphin-cloud:dev). Removes only the container and volume it created.
set -euo pipefail
IMAGE=${1:-dolphin-cloud:dev}
NAME=dolphin-dbtest-$$  # unique per run: parallel runs never touch each other's container or volume
TESTS="$(cd "$(dirname "$0")/.." && pwd)/supabase/tests"

remove() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME-data" >/dev/null 2>&1 || true; }
trap remove EXIT
docker run -d --name "$NAME" -e DOLPHIN_DOMAIN=localhost -v "$NAME-data:/data" -v "$TESTS:/tests:ro" "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
  docker exec "$NAME" test -f /data/run/image-version 2>/dev/null && break
  sleep 2
done
docker exec "$NAME" test -f /data/run/image-version || { docker logs --tail 40 "$NAME" >&2; echo "FAIL: migrations did not finish" >&2; exit 1; }
# dolphin-jobs stops and what its start-up catch-up did is undone (a Monday's anchor), so every run starts from the
# migrated state whatever the day; the lock waits for a catch-up still running.
docker exec "$NAME" supervisorctl stop dolphin-jobs >/dev/null
docker exec "$NAME" psql -U postgres -qAt -c "lock public.job_runs; set local session_replication_role = replica;
  delete from public.rate_weeks; update public.job_runs set done_to = app_private.cn_date(now()) - 1, last_ok = null, last_err = null" >/dev/null

failed=0
for f in "$TESTS"/*.sql; do
  name=$(basename "$f")
  if out=$(docker exec "$NAME" psql -X -U postgres -d postgres -f "/tests/$name" 2>&1) \
     && ! grep -qE '^not ok|^# Looks like' <<<"$out"; then
    echo "PASS: $name ($(grep -c '^ok' <<<"$out") tests)"
  else
    echo "FAIL: $name"; grep -E '^(not ok|#|psql:)' <<<"$out" | sed 's/^/  /'; failed=1
  fi
done
exit $failed
