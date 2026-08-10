#!/bin/sh
# DISASTER RECOVERY — run this ONLY when you actually need to recover lost or corrupted data.
#
# This REPLACES everything currently in the production database with the contents of the backup
# file you choose. Anything created or changed after that backup was taken will be permanently
# lost. It will ask you to type a confirmation word before doing anything, and it will not run at
# all unless you do.
#
# How to use it, from the same folder as docker-compose.prod.yml:
#   1. See what backups are available:
#        docker compose -f docker-compose.prod.yml exec backup ls -lh /backups
#   2. Run this script with the filename you want to restore:
#        ./backup/restore.sh leaflow_2026-08-08_02-00-00.dump
set -eu

COMPOSE_FILE="docker-compose.prod.yml"
DB_USER="leaflow"
DB_NAME="leaflow"

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./backup/restore.sh <backup-filename>"
  echo ""
  echo "See available backups with:"
  echo "  docker compose -f $COMPOSE_FILE exec backup ls -lh /backups"
  exit 1
fi

echo "======================================================================"
echo " WARNING: THIS WILL ERASE THE CURRENT PRODUCTION DATABASE"
echo "======================================================================"
echo ""
echo "You are about to replace everything currently in the database with the"
echo "contents of this backup file:"
echo ""
echo "    $BACKUP_FILE"
echo ""
echo "Anything created or changed since that backup was taken (new leave"
echo "requests, new employees, password changes, everything) will be LOST."
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
echo "1/3 Stopping the app so nobody can use it while data is being restored..."
docker compose -f "$COMPOSE_FILE" stop app

echo "2/3 Restoring $BACKUP_FILE into the database — this can take a few minutes for a large database..."
docker compose -f "$COMPOSE_FILE" exec -T backup \
  pg_restore -h db -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner "/backups/$BACKUP_FILE"

echo "3/3 Restore complete. Starting the app back up..."
docker compose -f "$COMPOSE_FILE" start app

echo ""
echo "Done. Please open the application and confirm everything looks right."
