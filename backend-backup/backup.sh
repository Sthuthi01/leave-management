#!/bin/sh
# Backup mechanism for the CURRENT stack — Django + PostgreSQL (backend-db), not the old Next.js
# app's `db`/`leaflow` database. Runs automatically on a schedule (see backend-backup/crontab) and
# once immediately when the `backup` container starts, so a fresh deployment has proof-of-life
# right away instead of waiting for the first scheduled run.
#
# Safe by construction: pg_dump only ever reads the database, it never modifies or deletes
# anything in it. This script cannot damage the live database no matter when or how often it runs.
#
# Backs up TWO things together, in the same run, with the same timestamp — the Postgres database
# AND the onboarding-document media volume. They must never be restored from mismatched points in
# time: a Postgres-only backup restores every Resource/ResourceDocument row, but the uploaded file
# each row points at would be missing from disk; a media-only backup has the files, but no
# database rows to authorize or resolve a download to them. See DEPLOYMENT.backend.md §12.
set -eu

BACKUP_DIR="/backups"
MEDIA_SOURCE_DIR="/media"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
DB_FILE="$BACKUP_DIR/backend_db_${TIMESTAMP}.dump"
MEDIA_FILE="$BACKUP_DIR/backend_media_${TIMESTAMP}.tar.gz"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"

echo "[backup] $(date -Iseconds) starting backup -> $DB_FILE"

# -Fc = Postgres's "custom" dump format: compressed, and restorable with pg_restore (see
# backend-backup/restore.sh and backend-backup/test-restore.sh) including the --clean/--if-exists
# options those scripts rely on for a clean restore. Connects to the CURRENT stack's `backend-db`
# service, using the CURRENT stack's own credentials (BACKEND_POSTGRES_*, set in
# docker-compose.backend.prod.yml) — never the old app's `db` service or `leaflow` credentials.
pg_dump -Fc -h backend-db -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f "$DB_FILE"
DB_SIZE=$(du -h "$DB_FILE" | cut -f1)
echo "[backup] $(date -Iseconds) database backup finished ($DB_SIZE)"

echo "[backup] $(date -Iseconds) starting media backup -> $MEDIA_FILE"
if [ -d "$MEDIA_SOURCE_DIR" ] && [ -n "$(ls -A "$MEDIA_SOURCE_DIR" 2>/dev/null)" ]; then
  tar -czf "$MEDIA_FILE" -C "$MEDIA_SOURCE_DIR" .
  MEDIA_SIZE=$(du -h "$MEDIA_FILE" | cut -f1)
  echo "[backup] $(date -Iseconds) media backup finished ($MEDIA_SIZE)"
else
  echo "[backup] $(date -Iseconds) media directory empty or missing — skipping media archive for this run"
fi

DELETED=$(find "$BACKUP_DIR" \( -name "backend_db_*.dump" -o -name "backend_media_*.tar.gz" \) -mtime "+${RETENTION_DAYS}" -print -delete)
if [ -n "$DELETED" ]; then
  echo "[backup] $(date -Iseconds) removed backups older than ${RETENTION_DAYS} days:"
  echo "$DELETED"
fi

echo "[backup] $(date -Iseconds) done. Current backups:"
ls -lh "$BACKUP_DIR"/backend_db_*.dump "$BACKUP_DIR"/backend_media_*.tar.gz 2>/dev/null || echo "[backup] (none yet)"
