#!/bin/sh
# Safe backup test for the CURRENT stack — proves a backup file can actually be restored, WITHOUT
# touching the real backend-db database in any way.
#
# It creates a brand-new, temporary, throwaway database, restores your chosen backup into that
# temporary database only, checks the data looks right (querying Django's actual table names —
# accounts_employee / departments_department, not the old app's employees/departments), then
# deletes the temporary database completely. The real database is never connected to or modified
# by this script.
#
# How to use it, from the same folder as docker-compose.backend.prod.yml:
#   1. See what backups are available:
#        docker compose -f docker-compose.backend.prod.yml --env-file .env.backend exec backup ls -lh /backups
#   2. Run this script with the database backup filename you want to test:
#        ./backend-backup/test-restore.sh backend_db_2026-08-08_02-00-00.dump
#
# Run this periodically (e.g. monthly) to confirm your backups are actually good — a backup file
# nobody has ever successfully restored is not a backup you can rely on.
set -eu

BACKUP_VOLUME_NAME="${BACKUP_VOLUME_NAME:?Set BACKUP_VOLUME_NAME to the actual Docker volume name backing the 'backup' service's /backups mount — run 'docker volume ls | grep backend-db-backups' to find it (Compose prefixes it with the project name, e.g. leave-django-prod_backend-db-backups)}"
TEST_CONTAINER="backend-db-restore-test-$$"

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ]; then
  echo "Usage: ./backend-backup/test-restore.sh <database-backup-filename>"
  echo ""
  echo "See available backups with:"
  echo "  docker compose -f docker-compose.backend.prod.yml --env-file .env.backend exec backup ls -lh /backups"
  exit 1
fi

cleanup() {
  echo ""
  echo "Cleaning up the temporary test database..."
  docker rm -f "$TEST_CONTAINER" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "1/4 Starting a temporary, throwaway test database (the real backend-db is never touched)..."
docker run -d --name "$TEST_CONTAINER" \
  -e POSTGRES_USER=restoretest -e POSTGRES_PASSWORD=test-restore-only -e POSTGRES_DB=restoretest \
  -v "${BACKUP_VOLUME_NAME}:/backups:ro" \
  postgres:16-alpine >/dev/null

echo "2/4 Waiting for it to start..."
i=0
until docker exec "$TEST_CONTAINER" pg_isready -U restoretest >/dev/null 2>&1; do
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
  echo "See available backups with: docker compose -f docker-compose.backend.prod.yml --env-file .env.backend exec backup ls -lh /backups"
  exit 1
}
docker exec "$TEST_CONTAINER" pg_restore -U restoretest -d restoretest --no-owner "/backups/$BACKUP_FILE"

echo "4/4 Checking the restored data looks right (Django's actual table names)..."
EMPLOYEES=$(docker exec "$TEST_CONTAINER" psql -U restoretest -d restoretest -tAc "SELECT count(*) FROM accounts_employee;")
DEPARTMENTS=$(docker exec "$TEST_CONTAINER" psql -U restoretest -d restoretest -tAc "SELECT count(*) FROM departments_department;")

echo ""
echo "======================================================================"
echo " PASS — the backup restored successfully."
echo "   Employees in the restored backup:   $EMPLOYEES"
echo "   Departments in the restored backup: $DEPARTMENTS"
echo "======================================================================"
echo ""
echo "The real backend-db database was never touched by this test."
echo "(This checks the database dump only — restore the matching media"
echo " archive separately with restore.sh if you also need to verify"
echo " onboarding-document files.)"
