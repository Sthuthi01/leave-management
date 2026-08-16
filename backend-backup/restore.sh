#!/bin/sh
# DISASTER RECOVERY for the CURRENT stack (Django + PostgreSQL, backend-db) — run this ONLY when
# you actually need to recover lost or corrupted data. Not the old Next.js app's restore script —
# that one targets a different service (`db`), different credentials (`leaflow`), and a different
# compose file (`docker-compose.prod.yml`).
#
# This REPLACES everything currently in the production database AND the onboarding-document media
# volume with the contents of the backup pair you choose. Anything created or changed after that
# backup was taken will be permanently lost. It will ask you to type a confirmation word before
# doing anything, and it will not run at all unless you do.
#
# How to use it, from the same folder as docker-compose.backend.prod.yml:
#   1. See what backups are available:
#        docker compose -f docker-compose.backend.prod.yml --env-file .env.backend exec backup ls -lh /backups
#   2. Run this script with the DATABASE backup filename you want to restore (the matching media
#      archive, if one exists for that timestamp, is restored automatically):
#        ./backend-backup/restore.sh backend_db_2026-08-08_02-00-00.dump
set -eu

COMPOSE_FILE="docker-compose.backend.prod.yml"
ENV_FILE="${ENV_FILE:-.env.backend}"

DB_BACKUP_FILE="${1:-}"
if [ -z "$DB_BACKUP_FILE" ]; then
  echo "Usage: ./backend-backup/restore.sh <database-backup-filename>"
  echo ""
  echo "See available backups with:"
  echo "  docker compose -f $COMPOSE_FILE --env-file $ENV_FILE exec backup ls -lh /backups"
  exit 1
fi

# The media archive shares the same timestamp suffix as the database dump — derive its name from
# it rather than requiring a second argument.
TIMESTAMP_SUFFIX=$(echo "$DB_BACKUP_FILE" | sed -E 's/^backend_db_(.*)\.dump$/\1/')
MEDIA_BACKUP_FILE="backend_media_${TIMESTAMP_SUFFIX}.tar.gz"

echo "======================================================================"
echo " WARNING: THIS WILL ERASE THE CURRENT DATABASE AND ONBOARDING DOCUMENTS"
echo "======================================================================"
echo ""
echo "You are about to replace everything currently in the database, and every"
echo "onboarding document currently uploaded, with the contents of this backup:"
echo ""
echo "    Database: $DB_BACKUP_FILE"
echo "    Media:    $MEDIA_BACKUP_FILE (if present)"
echo ""
echo "Anything created or changed since that backup was taken (new leave"
echo "requests, new employees, password changes, uploaded documents,"
echo "everything) will be LOST."
echo ""
echo "The application will be briefly unavailable while this runs."
echo ""
printf "Type RESTORE (in capital letters) to continue, or press Enter to cancel: "
read -r CONFIRM
if [ "$CONFIRM" != "RESTORE" ]; then
  echo ""
  echo "Cancelled. Nothing was changed."
  exit 1
fi

echo ""
echo "1/4 Stopping the backend so nobody can use it while data is being restored..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" stop backend

echo "2/4 Restoring $DB_BACKUP_FILE into the database — this can take a few minutes for a large database..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T backup \
  pg_restore -h backend-db -U "$(grep '^BACKEND_POSTGRES_USER=' "$ENV_FILE" | cut -d= -f2)" \
  -d "$(grep '^BACKEND_POSTGRES_DB=' "$ENV_FILE" | cut -d= -f2)" \
  --clean --if-exists --no-owner "/backups/$DB_BACKUP_FILE"

echo "3/4 Restoring $MEDIA_BACKUP_FILE into the onboarding-document volume..."
if docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T backup test -f "/backups/$MEDIA_BACKUP_FILE"; then
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" exec -T backup \
    sh -c "cat /backups/$MEDIA_BACKUP_FILE" | \
    docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" run --rm --no-deps --entrypoint sh backend \
    -c "rm -rf /app/media/* /app/media/.[!.]* 2>/dev/null; tar xzf - -C /app/media"
else
  echo "  (no matching media archive found for this timestamp — skipping media restore)"
fi

echo "4/4 Restore complete. Starting the backend back up..."
docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" start backend

echo ""
echo "Done. Please open the application and confirm everything looks right,"
echo "including that a previously-uploaded onboarding document still downloads."
