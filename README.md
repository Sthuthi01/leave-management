# Agrileaf Leave Management System

A leave/HR management application: employee and department management, leave types and balances,
leave requests with a manager-approval workflow, holidays, an onboarding resource library and
checklists, reports, an audit trail, and org-wide settings.

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Ant Design, Vite |
| Backend | Django, Django REST Framework |
| Database | PostgreSQL |
| Infrastructure | Docker / Docker Compose |

This repository previously contained a Next.js/Drizzle implementation of the same product at the
repository root. That implementation has been fully replaced by the stack described in this
README — see [`PRE_CLEANUP_REVIEW.md`](./PRE_CLEANUP_REVIEW.md) and
[`MIGRATION_AUDIT.md`](./MIGRATION_AUDIT.md) for the evidence.

## Frontend

- **React** 18.3.1 + **TypeScript** 5.7.2
- **Ant Design** 5.22.5 (`@ant-design/icons`, `@ant-design/charts` for Reports)
- **Vite** 6.0.3 — dev server and production build
- **React Router** 7 — client-side routing
- **TanStack Query** — server state / data fetching
- Source: `frontend/src/`

## Backend

- **Django** 5.1.4 + **Django REST Framework** 3.15.2
- 12 apps, one per domain area: `accounts`, `departments`, `leave_types`, `holidays`,
  `leave_balances`, `leave_requests`, `dashboard`, `audit`, `org_settings`, `team_calendar`,
  `reports`, `onboarding`
- Session-based authentication (Django sessions + CSRF), Argon2 password hashing
- Source: `backend/`

## Database

**PostgreSQL 16.** Connected via `DJANGO_DATABASE_URL` (a `postgres://` URL — see
`backend/config/settings.py`). No SQLite, no other database engine, anywhere in this stack.

## Infrastructure

Two Docker Compose files, matching the local-dev/production split already established for this
stack:

| | Local development | UAT / Production |
|---|---|---|
| File | `docker-compose.backend.yml` | `docker-compose.backend.prod.yml` |
| Env template | `.env.backend.example` | `.env.backend.uat.example` / `.env.backend.production.example` |
| Frontend serving | Vite dev server (hot reload) | nginx serving a static production build |
| Reverse proxy / TLS | None (direct ports) | Caddy (automatic HTTPS) |
| Backend URL exposure | Published to host, for local tooling | Not published — reachable only inside the Docker network |

Full production deployment guide: [`DEPLOYMENT.backend.md`](./DEPLOYMENT.backend.md).

## Repository structure

```
backend/            Django project — 12 apps, each with models/serializers/views/urls/tests
frontend/            React + TypeScript + Ant Design app (Vite)
backend-backup/       Backup/restore scripts for backend-db (see Backup and restore, below)
docker-compose.backend.yml         Local development stack
docker-compose.backend.prod.yml    UAT/production stack
Caddyfile.backend                  Production reverse proxy / TLS config
frontend/nginx.conf                 Production static-file + API-proxy config
.env.backend*                      Environment templates (dev/UAT/production)
DEPLOYMENT.backend.md              Full deployment guide
```

## How to start the application (local development)

```bash
cp .env.backend.example .env.backend   # fill in values if you want — defaults work out of the box
docker compose -f docker-compose.backend.yml up -d --build
```

This starts four containers:

| Service | URL | Purpose |
|---|---|---|
| **frontend** | **http://localhost:5180** | React app (Vite dev server) |
| **backend** | **http://localhost:8012** | Django API (gunicorn) |
| backend-db | (internal only, host port 5435) | PostgreSQL 16 |
| mailpit | http://localhost:8026 | Catches invitation/reset emails sent locally |

Confirm everything is healthy:

```bash
docker compose -f docker-compose.backend.yml ps
```

## Database / migrations

Nothing to run by hand in normal operation — `backend/entrypoint.sh` runs
`python manage.py migrate --noinput` automatically on every container start, in every
environment. This is additive/idempotent; it never resets or drops anything.

To run migration commands manually (e.g. after adding a new one during development):

```bash
docker compose -f docker-compose.backend.yml exec backend python manage.py makemigrations
docker compose -f docker-compose.backend.yml exec backend python manage.py migrate
docker compose -f docker-compose.backend.yml exec backend python manage.py showmigrations
```

## Creating the first HR Admin

There's no page, API route, or environment variable that creates the first HR Admin — every
employee-creation path requires an already-authenticated `ADMIN`. Use the `bootstrap_admin`
management command instead, a one-shot, explicitly-gated operation:

```bash
docker compose -f docker-compose.backend.yml exec -e ALLOW_BOOTSTRAP_ADMIN=true backend \
  python manage.py bootstrap_admin --name "Your Name" --email "you@example.com"
```

It refuses to run if an HR Admin already exists. `ALLOW_BOOTSTRAP_ADMIN=true` is a one-shot
override for this single command — never leave it set in the environment's normal running
configuration. This sends a real invitation email through the same code path as any other
employee invite; check Mailpit (http://localhost:8026) locally, or the real inbox in UAT/prod.

## API structure

All backend endpoints are under `/api/`, one prefix per Django app:

```
/api/auth/            login, logout, me, set-password, change-password, forgot-password, csrf
/api/employees/       employee CRUD, import, resend-invitation, send-password-reset
/api/departments/     department CRUD
/api/leave-types/     leave type CRUD
/api/holidays/        holiday CRUD, import
/api/leave-balances/  own leave balances
/api/leave-requests/  apply/list/cancel/decide, preview
/api/dashboard/       role-branched dashboard data (EMPLOYEE/MANAGER vs HR/ADMIN)
/api/audit-log/       audit trail (admin only)
/api/settings/        org-wide settings (read: any user, write: admin only)
/api/team-calendar/   team/company leave calendar
/api/reports/         admin-only reports
/api/onboarding/      resources, checklists, tasks, documents, progress
/api/health/          shallow liveness check
/api/health/deep/     deep health check (verifies database connectivity)
```

Full endpoint definitions: each app's `urls.py` under `backend/*/urls.py`, wired together in
`backend/config/urls.py`.

## Frontend: typecheck, build, lint, tests

Exactly the commands defined in `frontend/package.json` — nothing invented:

```bash
cd frontend
npx tsc -b        # TypeScript check (also run as part of `npm run build`)
npm run build     # tsc -b && vite build
npm test          # vitest run
```

**Note:** `frontend/package.json` has no `lint` script configured at this time.

## Backend: checks and tests

```bash
docker compose -f docker-compose.backend.yml exec backend python manage.py check
docker compose -f docker-compose.backend.yml exec backend python manage.py test
```

The test suite creates and destroys its own throwaway test database automatically — it never
touches your real development data.

## Backup and restore

`backend-db` (this stack's PostgreSQL) has its own backup mechanism, independent of anything
from the old Next.js app — see `backend-backup/` and
[`DEPLOYMENT.backend.md` §12](./DEPLOYMENT.backend.md#12-backup-considerations) for the full
restore/disaster-recovery procedure. In short:

- **Automatic**: a `backup` service in `docker-compose.backend.prod.yml` runs `backend-backup/backup.sh`
  daily, dumping both the database and the onboarding-document media volume together (they must
  never be restored from mismatched points in time).
- **Manual test restore** (never touches the real database): `./backend-backup/test-restore.sh <backup-filename>`
- **Disaster recovery** (replaces the real database — requires typing a confirmation word):
  `./backend-backup/restore.sh <backup-filename>`

## Environment configuration

| File | Used for |
|---|---|
| `.env.backend.example` | Local development template |
| `.env.backend.uat.example` | UAT template |
| `.env.backend.production.example` | Production template |
| `.env.backend` | Your real, filled-in, git-ignored file — copy from one of the above |

Copy the appropriate template to `.env.backend` and fill in real values. Production/UAT refuse to
start if any required variable is missing (`${VAR:?message}` syntax in
`docker-compose.backend.prod.yml`) rather than silently falling back to something insecure.

## Development workflow

1. `docker compose -f docker-compose.backend.yml up -d --build`
2. Edit `backend/` or `frontend/` — both are built with `COPY . .` at image-build time (no bind
   mount), so **rebuild the relevant image after each source change**:
   ```bash
   docker compose -f docker-compose.backend.yml build backend   # or frontend
   docker compose -f docker-compose.backend.yml up -d backend   # or frontend
   ```
3. Run the relevant checks (see above) before considering a change done.
4. For production/UAT deployment, see [`DEPLOYMENT.backend.md`](./DEPLOYMENT.backend.md).
