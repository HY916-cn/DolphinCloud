#!/bin/bash
# Database tests: run the image in a throwaway container and run every supabase/tests/*.sql (pgTAP) against it.
# Usage: docker/db-test.sh [image]   (default dolphin-cloud:dev). Removes its own container and volume.
set -euo pipefail
IMAGE=${1:-dolphin-cloud:dev}
NAME=dolphin-dbtest
TESTS="$(cd "$(dirname "$0")/.." && pwd)/supabase/tests"

remove() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME-data" >/dev/null 2>&1 || true; }
trap remove EXIT
remove
docker run -d --name "$NAME" -e DOLPHIN_DOMAIN=localhost -v "$NAME-data:/data" -v "$TESTS:/tests:ro" "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
  docker exec "$NAME" test -f /data/run/image-version 2>/dev/null && break
  sleep 2
done
docker exec "$NAME" test -f /data/run/image-version || { docker logs --tail 40 "$NAME" >&2; echo "FAIL: migrations did not finish" >&2; exit 1; }

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
