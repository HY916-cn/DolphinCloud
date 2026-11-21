#!/bin/sh
# Puts the demo container back to the state saved by `reset.sh save` (taken right after seed.sql), so every take
# records the same data. Same snapshot and restore as docker/e2e-test.sh, but taken after the seed.
#   capture/reset.sh save      once, after seed.sql
#   capture/reset.sh           before each take
set -eu
NAME=${DEMO_CONTAINER:-dolphin-video1}
if [ "${1:-}" = save ]; then
  docker exec -i "$NAME" sh -e <<'SH'
supervisorctl stop dolphin-jobs >/dev/null
{ echo "set session_replication_role = replica;"
  psql -U postgres -qAt -c "select 'truncate ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ';'
    from pg_tables where schemaname in ('public', 'app_private', 'auth', 'storage')"
  pg_dump -U postgres --data-only -n public -n app_private -n auth -n storage postgres 2>/dev/null
} > /tmp/demo-base.sql
tar -cf /tmp/demo-storage.tar -C /data storage
supervisorctl start dolphin-jobs >/dev/null
SH
  echo saved
else
  docker exec "$NAME" sh -ec '
    psql -U postgres -v ON_ERROR_STOP=1 -q -1 -f /tmp/demo-base.sql >/dev/null
    find /data/storage -mindepth 1 -delete
    tar -xf /tmp/demo-storage.tar -C /data'
  echo restored
fi
