#!/bin/bash
# End-to-end tests (client/e2e, Playwright) against the production image: starts a fresh container on
# https://localhost:18445, loads supabase/seed.sql, runs the tests, and removes the container and its volume.
# Usage: docker/e2e-test.sh [image] [playwright args]   (default dolphin-cloud:dev). Needs `npx playwright install chromium` once.
set -euo pipefail
IMAGE=${1:-dolphin-cloud:dev}
shift $(( $# > 0 ? 1 : 0 ))
NAME=dolphin-e2e
PORT=18445
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

remove() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME-data" >/dev/null 2>&1 || true; }
trap remove EXIT
remove
docker run -d --name "$NAME" -p "$PORT:443" -v "$NAME-data:/data" -e DOLPHIN_DOMAIN=localhost "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
  [ "$(curl -sk -o /dev/null -w '%{http_code}' "https://localhost:$PORT/auth/v1/health")" = 200 ] \
    && docker exec "$NAME" psql -U postgres -qAt -c "select 1 from public.settings limit 1" >/dev/null 2>&1 && break
  sleep 2
done
docker exec -i "$NAME" psql -U postgres -v ON_ERROR_STOP=1 -q < "$ROOT/supabase/seed.sql"
(cd "$ROOT/client" && E2E_BASE="https://localhost:$PORT" npx playwright test "$@")
docker exec "$NAME" dolphin check
