#!/bin/bash
# Restore test: `dolphin restore` stops before changing anything when the archive or the backup of the current data
# fails, starts every service again when a later step fails, restores with a service already FATAL, and leaves a working
# database when killed midway; the next restore puts back what a killed one left.
# Usage: docker/restore-test.sh [image]   (default dolphin-cloud:dev). Removes only the container and volume it created.
set -euo pipefail
IMAGE=${1:-dolphin-cloud:dev}
NAME=dolphin-restore-$$  # unique per run: parallel runs never touch each other's container or volume
MARK=/data/storage/files/restore-test/mark # stands for an uploaded file

remove() { docker rm -f "$NAME" >/dev/null 2>&1 || true; docker volume rm "$NAME-data" >/dev/null 2>&1 || true; }
trap remove EXIT
fail() { echo "FAIL: $*" >&2; docker exec "$NAME" supervisorctl status >&2 || true; exit 1; }
pass() { echo "PASS: $*"; }
in_() { docker exec "$NAME" "$@"; }
sql() { in_ psql -U postgres -d postgres -qAt -v ON_ERROR_STOP=1 -c "$1"; }
state() { sql "select string_agg(n::text, ' ' order by n) from public.restore_test"; }
mark() { in_ cat "$MARK" 2>/dev/null || echo missing; }
change() { # change <n>: one more row and a new version of the uploaded file
  sql "insert into public.restore_test values ($1)"
  in_ su dolphin -s /bin/sh -c "mkdir -p ${MARK%/*} && echo v$1 > $MARK"
}
running() { # every service restore stops is RUNNING again (supervisord takes a moment to start them)
  for _ in $(seq 1 30); do
    [ "$(in_ supervisorctl status auth rest storage caddy backup-schedule dolphin-jobs | grep -vc RUNNING)" = 0 ] && return 0
    sleep 1
  done
  return 1
}
unchanged() { # unchanged <what>: data, file, services and no work left over, as before the failed restore
  [ "$(state)" = "$STATE" ] || fail "$1: the database changed"
  [ "$(mark)" = "$MARK_NOW" ] || fail "$1: the uploaded file is $(mark), not $MARK_NOW"
  running || fail "$1: services left stopped"
  [ -z "$(in_ find /data/storage -maxdepth 1 -name '.restore.*')" ] || fail "$1: work directory left in /data/storage"
}
now() { STATE=$(state); MARK_NOW=$(mark); }

# LINUX_IMMUTABLE: chattr below makes /data/backups unwritable (Docker allows no mounts inside the container).
docker run -d --name "$NAME" --cap-add LINUX_IMMUTABLE --stop-timeout 120 -p 127.0.0.1::443 -v "$NAME-data:/data" -e DOLPHIN_DOMAIN=localhost "$IMAGE" >/dev/null
for _ in $(seq 1 90); do
  [ "$(sql 'select count(*) from public.app_migrations' 2>/dev/null)" = "$(in_ sh -c 'ls /opt/dolphin/migrations/*.sql | wc -l')" ] \
    && in_ dolphin health 2>/dev/null && running && break
  sleep 2
done
in_ dolphin health || fail "services not ready"

sql "create table public.restore_test (n int)"
change 1
BACKUP=$(basename "$(in_ dolphin backup 2>/dev/null | tail -1)")
BACKED_UP=$(state)
change 2
now
BACKUPS_NOW=$(in_ dolphin backups)

# 1. The backup of the current data fails: the backup directory cannot be written (immutable, which binds root too),
#    or BACKUP_RECIPIENT is not an age key.
in_ chattr +i /data/backups
OUT=$(in_ dolphin restore "$BACKUP" 2>&1) && fail "restored while /data/backups cannot be written"
grep -q 'Backing up the current data failed' <<<"$OUT" || fail "no reason given: $OUT"
grep -q 'Backing up current data first' <<<"$OUT" && fail "printed a backup that failed: $OUT"
in_ chattr -i /data/backups
unchanged "/data/backups not writable"
OUT=$(docker exec -e BACKUP_RECIPIENT=age1notakey "$NAME" dolphin restore "$BACKUP" 2>&1) && fail "restored with a wrong BACKUP_RECIPIENT"
grep -q 'Backing up the current data failed' <<<"$OUT" || fail "no reason given: $OUT"
unchanged "wrong BACKUP_RECIPIENT"
[ "$(in_ dolphin backups)" = "$BACKUPS_NOW" ] || fail "failed backups left files: $(in_ dolphin backups)"
pass "the backup of the current data fails (directory not writable, wrong BACKUP_RECIPIENT): restore stops, nothing changes"

# 2. Archives that are not whole: no storage/; a damaged db.dump, which fails after the services are stopped.
in_ sh -c "set -e; t=\$(mktemp -d); tar -xzf /data/backups/$BACKUP -C \$t
  tar -czf /data/backups/dolphin-nostorage.tar.gz -C \$t db.dump
  head -c 20000 \$t/db.dump > \$t/db.short && mv \$t/db.short \$t/db.dump && tar -czf /data/backups/dolphin-damaged.tar.gz -C \$t db.dump storage
  rm -rf \$t"
OUT=$(in_ dolphin restore dolphin-nostorage.tar.gz 2>&1) && fail "restored an archive without storage/"
grep -q 'needs db.dump and storage/' <<<"$OUT" || fail "no reason given: $OUT"
unchanged "archive without storage/"
pass "an archive without storage/ is refused before anything is backed up or stopped; the uploaded files stay"
in_ dolphin restore dolphin-damaged.tar.gz >/dev/null 2>&1 && fail "restored a damaged db.dump"
unchanged "damaged db.dump"
[ "$(sql "select count(*) from pg_database where datname like 'dolphin\_%'")" = 1 ] || fail "dolphin_old left behind"
pass "a damaged db.dump fails after the services are stopped: the database and files stay, every service runs again"

# 3. A service is FATAL when the restore starts.
in_ sh -c 'cp /usr/local/bin/dolphin-backup-schedule /tmp/schedule && printf "#!/bin/sh\nexit 1\n" > /usr/local/bin/dolphin-backup-schedule'
in_ supervisorctl restart backup-schedule >/dev/null 2>&1 || true
for _ in $(seq 1 30); do { in_ supervisorctl status backup-schedule || true; } | grep -q FATAL && break; sleep 1; done
{ in_ supervisorctl status backup-schedule || true; } | grep -q FATAL || fail "could not make backup-schedule FATAL"
in_ cp /tmp/schedule /usr/local/bin/dolphin-backup-schedule
OUT=$(in_ dolphin restore "$BACKUP" 2>&1) || fail "restore with backup-schedule FATAL: $OUT"
[ "$(state)" = "$BACKED_UP" ] && [ "$(mark)" = v1 ] || fail "restore with backup-schedule FATAL did not bring back the backup"
running || fail "services not all running after the restore"
in_ test -s "/data/backups/$(sed -n 's/.*Backing up current data first: .*\///p' <<<"$OUT")" || fail "safety backup not where it says: $OUT"
pass "with backup-schedule FATAL the restore runs, and every service runs afterwards"

# 4. Killed midway (kill -9: no trap runs) while pg_restore fills the new database: postgres is as it was. A stand-in
#    pg_restore, first on PATH, holds the restore at that step and tells the test the restore's pid.
change 3
now
in_ sh -c 'printf "#!/bin/sh\necho \$PPID \$\$ > /tmp/held\nexec sleep 600\n" > /usr/local/sbin/pg_restore && chmod +x /usr/local/sbin/pg_restore'
in_ dolphin restore "$BACKUP" >/dev/null 2>&1 &
for _ in $(seq 1 60); do in_ test -s /tmp/held && break; sleep 1; done
in_ sh -c 'kill -9 $(cat /tmp/held) && rm /usr/local/sbin/pg_restore /tmp/held' || fail "the restore never reached pg_restore"
wait || true
[ "$(state)" = "$STATE" ] && [ "$(mark)" = "$MARK_NOW" ] || fail "killed restore changed the data"
sql 'select count(*) from public.accounts' >/dev/null || fail "postgres unusable after the kill"
[ "$(sql "select count(*) from pg_database where datname = 'dolphin_restore'")" = 1 ] || fail "killed before pg_restore"
pass "killed during pg_restore: postgres and the files are as they were"

# 5. Killed while swapping the files in: the next restore puts the current ones back before anything else. The work
#    directory the kill left is made to look like it (the swap itself takes milliseconds).
W=$(in_ sh -c 'ls -d /data/storage/.restore.*' | head -1)
[ -n "$W" ] && [ "$(sql "select count(*) from pg_database where datname = 'dolphin_restore'")" = 1 ] || fail "the kill left no work"
in_ sh -c "mkdir -p $W/old && mv /data/storage/files $W/old/ && echo in > $W/phase && mkdir -p /data/storage/files/half"
OUT=$(in_ dolphin restore dolphin-nostorage.tar.gz 2>&1) && fail "restored an archive without storage/"
grep -q "Storage's files are back" <<<"$OUT" || fail "leftover not put back: $OUT"
in_ supervisorctl start auth rest storage caddy backup-schedule dolphin-jobs >/dev/null 2>&1 || true # the services the kill left stopped
unchanged "leftover of a killed restore"
in_ test ! -e /data/storage/files/half || fail "the half-swapped files stayed"
in_ dolphin restore "$BACKUP" >/dev/null 2>&1 || fail "restore after a killed one"
[ "$(state)" = "$BACKED_UP" ] && [ "$(mark)" = v1 ] || fail "restore after a killed one did not bring back the backup"
[ "$(sql "select count(*) from pg_database where datname in ('dolphin_restore', 'dolphin_old')")" = 0 ] || fail "databases left over"
running && in_ dolphin health || fail "not healthy after the restore"
pass "the next restore puts back the files a killed one had swapped out, then restores"
