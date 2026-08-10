#!/bin/sh
# Safe backup test — proves a backup file can actually be restored, WITHOUT touching your real
# production database in any way.
#
# It creates a brand-new, temporary, throwaway database, restores your chosen backup into that
# temporary database only, checks the data looks right, then deletes the temporary database
# completely. Your real database is never connected to or modified by this script.
#
# How to use it, from the same folder as docker-compose.prod.yml:
#   1. See what backups are available:
#        docker compose -f docker-compose.prod.yml exec backup ls -lh /backups
#   2. Run this script with the filename you want to test:
#        ./backup/test-restore.sh leaflow_2026-08-08_02-00-00.dump
#
# Run this periodically (e.g. monthly) to confirm your backups are actually good — a backup file
# nobody has ever successfully restored is not a backup you can rely on.
set -eu

BACKUP_VOLUME="leaflow-db-backups"
TEST_CONTAINER="leaflow-restore-test-$$"

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./backup/test-restore.sh <backup-filename>"
  echo ""
  echo "See available backups with:"
  echo "  docker compose -f docker-compose.prod.yml exec backup ls -lh /backups"
  exit 1
fi

cleanup() {
  echo ""
  echo "Cleaning up the temporary test database..."
  docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "1/4 Starting a temporary, throwaway test database (your real database is never touched)..."
docker run -d --name "$TEST_CONTAINER" \
  -e POSTGRES_USER=leaflow -e POSTGRES_PASSWORD=test-restore-only -e POSTGRES_DB=leaflow \
  -v "${BACKUP_VOLUME}:/backups:ro" \
  postgres:16-alpine >/dev/null

echo "2/4 Waiting for it to start..."
i=0
until docker exec "$TEST_CONTAINER" pg_isready -U leaflow >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 30 ]; then
    echo "FAIL — the temporary test database never started."
    exit 1
  fi
  sleep 1
done

echo "3/4 Restoring $BACKUP_FILE into the temporary database..."
docker exec "$TEST_CONTAINER" test -f "/backups/$BACKUP_FILE" || {
  echo "FAIL — no backup file named '$BACKUP_FILE' was found."
  echo "See available backups with: docker compose -f docker-compose.prod.yml exec backup ls -lh /backups"
  exit 1
}
docker exec "$TEST_CONTAINER" pg_restore -U leaflow -d leaflow --no-owner "/backups/$BACKUP_FILE"

echo "4/4 Checking the restored data looks right..."
EMPLOYEES=$(docker exec "$TEST_CONTAINER" psql -U leaflow -d leaflow -tAc "SELECT count(*) FROM employees;")
DEPARTMENTS=$(docker exec "$TEST_CONTAINER" psql -U leaflow -d leaflow -tAc "SELECT count(*) FROM departments;")

echo ""
echo "======================================================================"
echo " PASS — the backup restored successfully."
echo "   Employees in the restored backup:   $EMPLOYEES"
echo "   Departments in the restored backup: $DEPARTMENTS"
echo "======================================================================"
echo ""
echo "Your real production database was never touched by this test."
