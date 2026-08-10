#!/bin/sh
# Runs automatically on a schedule (see backup/crontab) — takes a full backup of the production
# database and deletes backups older than BACKUP_RETENTION_DAYS. Also runs once immediately when
# the `backup` container starts, so a fresh deployment has proof-of-life right away instead of
# waiting until the first scheduled run.
#
# Safe by construction: pg_dump only ever reads the database, it never modifies or deletes
# anything in it. This script cannot damage the live database no matter when or how often it runs.
set -eu

BACKUP_DIR="/backups"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
FILE="$BACKUP_DIR/leaflow_${TIMESTAMP}.dump"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

echo "[backup] $(date -Iseconds) starting backup -> $FILE"

# -Fc = Postgres's "custom" dump format: compressed, and restorable with pg_restore (see
# backup/restore.sh and backup/test-restore.sh) including the --clean/--if-exists options those
# scripts rely on for a clean restore.
pg_dump -Fc -h db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$FILE"

SIZE=$(du -h "$FILE" | cut -f1)
echo "[backup] $(date -Iseconds) backup finished ($SIZE)"

DELETED=$(find "$BACKUP_DIR" -name "leaflow_*.dump" -mtime "+${RETENTION_DAYS}" -print -delete)
if [ -n "$DELETED" ]; then
  echo "[backup] $(date -Iseconds) removed backups older than ${RETENTION_DAYS} days:"
  echo "$DELETED"
fi

echo "[backup] $(date -Iseconds) done. Current backups:"
ls -lh "$BACKUP_DIR"/leaflow_*.dump 2>/dev/null || echo "[backup] (none yet)"
