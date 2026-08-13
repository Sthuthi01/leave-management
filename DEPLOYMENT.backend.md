# Deploying the Django + React stack

This covers the **new** Django backend / React frontend rewrite (`backend/`, `frontend/`,
`docker-compose.backend.yml`, `docker-compose.backend.prod.yml`) — a separate, independently
deployable product from the original Next.js app, which has its own [README.md](./README.md) and
[DEPLOYMENT.md](./DEPLOYMENT.md). This stack is fully standalone at every layer, including local
development: its own Postgres, its own Mailpit, its own Django backend, its own React frontend,
all under their own Compose project (`name: leave-django-dev` in `docker-compose.backend.yml`).
**The old Next.js app's `docker-compose.yml` is never required** to start, test, or develop this
application — nothing in this guide touches the Next.js app's containers, database, or Caddy
instance, and nothing in its guide applies to this stack.

## 1. Prerequisites

- Docker and Docker Compose v2 (`docker compose version`)
- A git checkout of this repository — **the entire stack must be committed** for a deployment
  host to have anything to build from. If `git status` shows `backend/`, `frontend/`, or
  `docker-compose.backend.yml` as untracked, commit them first (see the repo's top-level
  `.gitignore`, `backend/.gitignore`, and `frontend/.gitignore` for what's deliberately excluded —
  `node_modules/`, Python caches/venvs, `.env*` files, build output).
- For UAT/production only: a real domain name (or subdomain) with public DNS pointing at the
  deployment host, and ports 80/443 reachable from the internet (for Caddy's automatic HTTPS —
  see [§11 Troubleshooting](#11-troubleshooting) if that's not your situation).
- **At least ~2GB of memory available to the build process** for `frontend`'s `npm run build`
  step (`tsc -b && vite build`). Measured directly (Phase 6 investigation, see git history for the
  full methodology): peak RSS is ~765MB for an unconstrained build on bare Node; inside a
  memory-cgroup-limited container, 1GB and 1.5GB both fail with Node's `FATAL ERROR: Reached heap
  limit — JavaScript heap out of memory` (not an app bug — Node/V8 sizes its heap ceiling off the
  cgroup's memory limit, and Rollup holding this bundle's full module graph plus minification
  needs more room than that), while 2GB succeeds reliably. `docker compose -f
  docker-compose.backend.prod.yml build frontend` (the real deployment build path) has been
  verified to succeed end-to-end (~37s for the `vite build` step) when this much memory is
  available. On a host or CI runner already running many other containers, confirm actual free
  memory at build time (`docker run --rm alpine cat /proc/meminfo` inside the same Docker context)
  rather than assuming the daemon's configured total is free — contention from unrelated
  containers, not a hard app-side ceiling, is what causes intermittent OOM kills (exit 137) on
  memory-constrained hosts. A secondary contributor worth knowing about if this ever needs
  trimming: `@ant-design/charts` pulls in the `@antv/*` package family (~96MB on disk, larger
  than `antd` itself), including graph-visualization engines (`g6`, `graphin`) this app never
  uses — only `@antv/g2`'s `Area`/`Pie`/`Column` components are actually imported (Reports page).
  Not changed as part of this investigation (no code/config changes were made to force the build
  to pass — the build already succeeds given enough memory), but flagged here as the most direct
  lever if a future memory-constrained CI environment needs the requirement lowered.

## 2. Local setup

```bash
git clone <this repo> && cd leave-management
docker compose -f docker-compose.backend.yml up -d --build
```

That's the complete command — no other compose file is needed. This starts four services, all
defined in `docker-compose.backend.yml` itself: `backend-db` (Postgres, isolated from the Next.js
app's own database), `mailpit` (this stack's own local email catcher, on
`http://localhost:8026` — a separate container from the Next.js app's Mailpit, on different
ports, so the two never conflict even if both happen to be running), `backend` (Django, on
`http://localhost:8010`), `frontend` (Vite dev server, on `http://localhost:5180`). Optional
overrides live in `.env.backend.example` — copy relevant lines into your `.env` if you need to
change a default; every value already has a working fallback baked into
`docker-compose.backend.yml` itself.

Migrations run automatically on every container start (see [§6](#6-database-migrations)).

Create your first HR Admin (see [§7](#7-first-hr-admin-creation)):
```bash
docker compose -f docker-compose.backend.yml exec \
  -e ALLOW_BOOTSTRAP_ADMIN=true backend python manage.py bootstrap_admin --name "Your Name" --email "you@example.com"
```

Open [http://localhost:5180](http://localhost:5180), check Mailpit at
[http://localhost:8026](http://localhost:8026) for the invitation email, click through, set a
password, and confirm you land on the Employees page.

## 3. UAT deployment

```bash
cp .env.backend.uat.example .env.backend
# fill in real values — see .env.backend.uat.example and §5 below
docker compose -f docker-compose.backend.prod.yml --env-file .env.backend up -d --build
```

This is the **same compose file used for production** (`docker-compose.backend.prod.yml`) — the
only difference between UAT and production is which `.env.backend` you copied in and which domain
you point at. It builds the frontend as a production static bundle served by nginx (not Vite's
dev server — see `frontend/Dockerfile`), runs Django with `DEBUG=false` hardcoded (not
overridable from the env file), and terminates HTTPS via Caddy (`Caddyfile.backend`), which
automatically obtains a Let's Encrypt certificate for `BACKEND_APP_DOMAIN`. Neither Postgres nor
the Django app container exposes a host port — only Caddy (80/443) does; see
[§4](#4-production-deployment) and the compose file's own comments.

Once containers are healthy (`docker compose -f docker-compose.backend.prod.yml ps`), run
migrations check and create the first HR Admin — see [§6](#6-database-migrations) and
[§7](#7-first-hr-admin-creation) — then create the [UAT test users](#8-creating-uat-test-users).

## 4. Production deployment

Identical procedure to UAT above, using `.env.backend.production.example` instead and a
production domain/secrets. Before going live:

- [ ] `DJANGO_SECRET_KEY` is a real, unique value (`openssl rand -hex 32`), different from UAT's.
- [ ] `BACKEND_POSTGRES_PASSWORD` is a real, unique value, different from UAT's.
- [ ] `EMAIL_FROM` is a verified sender for your real SMTP provider — test that an invitation
      email actually arrives before relying on it for real employees.
- [ ] `BACKEND_APP_DOMAIN`'s DNS record is live and ports 80/443 are reachable, so Caddy can
      complete the Let's Encrypt HTTPS challenge on first start (`docker compose -f
      docker-compose.backend.prod.yml logs caddy` to confirm the certificate was issued).
- [ ] A database backup plan is in place — **this stack does not yet include an automated backup
      service** (unlike the Next.js app's `docker-compose.prod.yml`, which has a dedicated
      `backup` service). See [§12](#12-backup-considerations).
- [ ] The `backend-media-prod-data` volume (onboarding document uploads, Phase 6) is included in
      that same backup plan, taken in the same run as the database backup — see
      [§12](#12-backup-considerations) for why the two must never be restored from mismatched
      points in time.
- [ ] `ALLOW_BOOTSTRAP_ADMIN` is left at its default (`false`/unset) in the standing `.env.backend`
      — only ever passed as a one-shot `-e` override, per [§7](#7-first-hr-admin-creation).

## 5. Environment variables

Full reference — see `.env.backend.uat.example` / `.env.backend.production.example` for the
copy-paste templates with inline explanations. **No real values are shown here.**

| Variable | Required? | Purpose |
|---|---|---|
| `DJANGO_SECRET_KEY` | Yes (UAT/prod) | Signs sessions/CSRF. No code-level fallback — Django refuses to start without it. |
| `DJANGO_DEBUG` | — | Hardcoded `false` in `docker-compose.backend.prod.yml`, not overridable there. Defaults `true` in local-dev's compose file. |
| `BACKEND_APP_DOMAIN` | Yes (UAT/prod) | Feeds both `DJANGO_ALLOWED_HOSTS` and Caddy's TLS cert request. |
| `DJANGO_ALLOWED_HOSTS` | — (local only) | Local dev only; UAT/prod derive it from `BACKEND_APP_DOMAIN`. |
| `FRONTEND_URL` | Yes (UAT/prod) | The public frontend origin; feeds `DJANGO_CORS_ALLOWED_ORIGINS` and `DJANGO_CSRF_TRUSTED_ORIGINS`, and builds invite/reset links. |
| `DJANGO_CORS_ALLOWED_ORIGINS` / `DJANGO_CSRF_TRUSTED_ORIGINS` | — | Local dev only; UAT/prod derive both from `FRONTEND_URL`. Never wildcarded. |
| `BACKEND_POSTGRES_USER` / `_PASSWORD` / `_DB` | Yes (UAT/prod) | Credentials for the bundled `backend-db` Postgres service. |
| `DJANGO_DATABASE_URL` | — | Assembled automatically from the three vars above; not set directly. |
| `ALLOW_BOOTSTRAP_ADMIN` | No, default `false` | One-shot opt-in for the first-admin command — see [§7](#7-first-hr-admin-creation). |
| `LOGIN_RATE_LIMIT` / `SET_PASSWORD_RATE_LIMIT` | No, default `10/min` each | Per-IP throttle rate for the two credential-guessable endpoints — see `accounts/throttles.py`. |
| `SMTP_HOST` / `_PORT` / `_SECURE` / `_USER` / `_PASS` | No (see note) | Real email provider settings. If `SMTP_HOST` is unset, emails are logged to the container's own logs instead of delivered. |
| `EMAIL_FROM` | Yes (UAT/prod) | Sender address for invitation/reset emails — must be verified with your SMTP provider. |
| `VITE_API_BASE_URL` | No, default `/api` | Baked into the frontend's static build at image-build time (Vite convention — not a runtime var in UAT/prod). Same-origin by default via nginx's reverse proxy. |
| `GUNICORN_WORKERS` | No, default `1` | Gunicorn worker process count. **Do not raise without also switching `CACHES` to a shared backend** — see the note below. |
| `DJANGO_MEDIA_ROOT` | No, default `<BASE_DIR>/media` (`/app/media` in-container) | Onboarding document storage path (Phase 6). Only override if you're not using the bundled `backend-media-data`/`backend-media-prod-data` volume — see [§12](#12-backup-considerations). |
| Sentry (`SENTRY_DSN`) | Not applicable | Not yet integrated for this backend — see the note at the bottom of `.env.backend.production.example`. The Next.js app has it; this one doesn't yet. |

## 6. Database migrations

`backend/entrypoint.sh` runs `python manage.py migrate --noinput` as the **only** thing it does
before starting gunicorn — on every container start, in every environment, local through
production. This is additive/idempotent (Django tracks which migrations have already applied and
skips them), not destructive — there is no seed data, no reset, no drop anywhere in the startup
path. To check migration status manually at any time:
```bash
docker compose -f docker-compose.backend.prod.yml exec backend python manage.py showmigrations
```
All 7 migration files across the 6 apps were audited for destructive operations during UAT
readiness review — the only non-`CreateModel` operation is a `CREATE SEQUENCE IF NOT EXISTS` (with
a guarded `DROP SEQUENCE IF EXISTS` only in its *reverse*/rollback direction), nothing that can
lose data in the forward direction that's actually run on deploy.

## 7. First HR Admin creation

There's no in-app way to do this — every employee-creation path (`EmployeeListCreateView`)
requires an already-authenticated `ADMIN`, which a brand-new database doesn't have. Unlike the
Next.js app's manual-SQL-INSERT approach, this backend uses its own `bootstrap_admin` management
command in every environment, gated by an explicit opt-in rather than by `DEBUG` — see
`backend/accounts/management/commands/bootstrap_admin.py` for the full guard logic.

**Local:**
```bash
docker compose -f docker-compose.backend.yml exec \
  -e ALLOW_BOOTSTRAP_ADMIN=true backend python manage.py bootstrap_admin --name "Your Name" --email "you@example.com"
```
Expected result: `Created HR Admin "Your Name" <you@example.com>.` printed to stdout, and an
invitation email appears in this stack's own Mailpit (`http://localhost:8026`) within moments.

**UAT (works with `DJANGO_DEBUG=false`, no security setting is weakened):**
```bash
docker compose -f docker-compose.backend.prod.yml run --rm \
  -e ALLOW_BOOTSTRAP_ADMIN=true backend python manage.py bootstrap_admin --name "Full Name" --email "admin@your-uat-domain.example"
```
`run --rm` (rather than `exec` on the long-running container) starts a fresh, disposable
container using the same image and config — `ALLOW_BOOTSTRAP_ADMIN=true` exists only for this one
process's lifetime and is never written into the standing `.env.backend` or the long-running
`backend` container's environment. No password is generated, printed, or logged — the command
sets an unusable password and sends a real invitation email through the same code path a normal
HR-created employee uses; the recipient chooses their own password via that link. If an ADMIN
already exists, the command refuses with a clear error naming them — it cannot accidentally
create a second one.

**Production (identical procedure to UAT, with change-control care):**
```bash
docker compose -f docker-compose.backend.prod.yml run --rm \
  -e ALLOW_BOOTSTRAP_ADMIN=true backend python manage.py bootstrap_admin --name "Full Name" --email "admin@your-domain.example"
```
- Treat this as a deliberate, approved, one-time action — run once ever per production database.
- Confirm you're pointed at the right database/host before running it.
- Do not leave `ALLOW_BOOTSTRAP_ADMIN=true` set anywhere persistent afterward.
- If the invite email doesn't arrive, check `docker compose -f docker-compose.backend.prod.yml
  logs backend` for SMTP errors and re-run the same command — since no admin was created if the
  command didn't print success, it's safe to simply try again.

| Environment | Command | Gate | Password exposure | Duplicate-admin protection |
|---|---|---|---|---|
| Local | `exec -e ALLOW_BOOTSTRAP_ADMIN=true ... bootstrap_admin` | Explicit opt-in flag | None — invite-only | Refuses if an ADMIN exists |
| UAT | `run --rm -e ALLOW_BOOTSTRAP_ADMIN=true ... bootstrap_admin` | Same, works with `DEBUG=false` | None — invite-only | Same |
| Production | Same as UAT, with change-control discipline | Same | None — invite-only | Same |

## 8. Creating UAT test users

Once the HR Admin above has set their password and logged in, create the rest through the app's
own UI (Employees page → Add employee) or `POST /api/employees/` — both send a real invitation
email exactly like the bootstrap admin did. Recommended minimum set:

| User | Role | Department | Manager | Purpose |
|---|---|---|---|---|
| HR Admin | ADMIN | — | — | Already created above; manages employees/departments/leave types/holidays |
| Manager 1 | MANAGER | Dept A | HR Admin (or none) | Approves Employee 1 & 2's requests |
| Employee 1 | EMPLOYEE | Dept A | Manager 1 | Apply/cancel flows, approval-required leave |
| Employee 2 | EMPLOYEE | Dept A | Manager 1 | Second employee under the same manager — overlap/queue testing |
| Manager 2 | MANAGER | Dept B | HR Admin (or none) | Verifies cross-department isolation |
| Employee 3 | EMPLOYEE | Dept B | Manager 2 | Verifies Manager 1 cannot act on Dept B's requests, and vice versa |

## 9. Email configuration

`docker-compose.backend.yml` runs its own Mailpit container (a separate instance from the Next.js
app's own Mailpit, on its own ports) — every invitation/reset email lands at
`http://localhost:8026`, nothing is actually sent anywhere. UAT/production have no Mailpit; set the `SMTP_*`/`EMAIL_FROM` variables
in `.env.backend` to a real provider (see the example values in
`.env.backend.uat.example`/`.env.backend.production.example`). If `SMTP_HOST` is left blank,
`backend/config/settings.py` falls back to Django's console email backend — emails are written to
`docker compose ... logs backend` instead of delivered. Useful for a first smoke-test, not
something to leave in place once real users are involved.

## 10. Health checks

`GET /api/health/` (unauthenticated, no DB query) — `backend/config/urls.py`. The Dockerfile's own
`HEALTHCHECK` curls this every 30s; `docker compose ... ps` shows `healthy`/`unhealthy` directly.
The `frontend` (nginx, prod build) container has its own `HEALTHCHECK` against `http://localhost/`.
`backend-db` uses Postgres's own `pg_isready`.

## 11. Rollback procedure

This stack has no automated migration-rollback tooling (matching the Next.js app's own approach —
migrations are additive by design, see [§6](#6-database-migrations)). To roll back a bad
deployment:

1. **Code rollback:** redeploy the previous known-good commit/image —
   `docker compose -f docker-compose.backend.prod.yml up -d --build` after checking out the prior
   revision. Since migrations only ever add, a newer schema is still readable by older code as
   long as the rollback doesn't cross a migration that removed/renamed a column the old code
   needs — check `git log -- backend/*/migrations/` for what changed between the two revisions
   before rolling back across a migration boundary.
2. **Data rollback:** restore from a database backup (see [§12](#12-backup-considerations)) if the
   bad deployment wrote incorrect data, not just bad code.
3. Verify with [§10](#10-health-checks) and a manual login before considering the rollback
   complete.

## 12. Backup considerations

**Not yet automated for this stack.** The Next.js app's `docker-compose.prod.yml` has a dedicated
`backup` service (daily `pg_dump`, retained 30 days by default, restore-tested); this Django
backend's `backend-db` currently has none. Before a real production launch, either:

- Add an equivalent bundled backup service (a `pg_dump` cron container, mirroring the Next.js
  app's `backup/backup.sh` pattern, pointed at `backend-db`'s own credentials/database name), or
- Use a managed Postgres provider with built-in automated snapshots instead of the bundled
  `backend-db` container (see the note in `.env.backend.production.example`).

Either way, test an actual restore before relying on it — an untested backup is not a backup.

**Onboarding document volume (Phase 6) — must be backed up together with the database, not
separately.** Uploaded onboarding documents (policy PDFs, etc.) live on the `backend-media-prod-data`
named volume (`/app/media` inside the `backend` container — see `docker-compose.backend.prod.yml`),
not in Postgres. A `Resource` row and its uploaded file are two halves of the same fact:

- A Postgres-only backup restores every `Resource`/`ResourceDocument` row, but `ResourceDocument.file`
  will point at a path that no longer exists on disk — the resource "has a document" according to
  the database, and downloading it 404s.
- A media-volume-only backup has the files, but nothing to serve them under (no `ResourceDocument`
  rows to resolve a resource id to a file path, and no visibility metadata to authorize a download).

**Take both backups in the same run, restore both together.** For a `pg_dump`-and-volume-tar
approach: `docker run --rm -v backend-media-prod-data:/media -v $(pwd):/backup alpine tar czf
/backup/media-$(date +%F).tar.gz -C /media .` alongside the `pg_dump` step, both written with the
same timestamp/run id so a restore always pairs a database snapshot with the media snapshot taken
at the same moment — restoring a DB backup from Tuesday against Monday's media tarball reintroduces
exactly the "row exists, file doesn't" (or vice versa) mismatch above.

## 13. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker compose ... up` fails immediately with "Set DJANGO_SECRET_KEY" (or similar) | A required variable is missing from `.env.backend` | Fill it in per [§5](#5-environment-variables); this is deliberate fail-fast behavior, not a bug |
| Caddy never gets a certificate / site unreachable over HTTPS | `BACKEND_APP_DOMAIN`'s DNS doesn't point here yet, or ports 80/443 aren't reachable from the internet | Confirm DNS with `dig BACKEND_APP_DOMAIN`; check `docker compose -f docker-compose.backend.prod.yml logs caddy`. For a pure-internal deployment with no public DNS, edit `Caddyfile.backend` to use a manually-provided/internal-CA certificate instead of automatic HTTPS — same alternative documented in the original `Caddyfile`/`DEPLOYMENT.md` for the Next.js app |
| Invitation emails never arrive in UAT/production | `SMTP_HOST` unset or wrong credentials | Check `docker compose ... logs backend` — with `SMTP_HOST` unset, emails are logged there, not lost; with it set incorrectly, you'll see an SMTP error |
| Edited backend code doesn't seem to take effect | No bind mount — the running container is a snapshot from the last `--build`. Gunicorn does not hot-reload | `docker compose -f docker-compose.backend.prod.yml up -d --build backend` (or the local-dev equivalent) |
| 429 responses on login/set-password during legitimate testing | Rate limiting working as designed (default 10/min per IP) — see [§Security requirements](#14-security-requirements) | Wait a minute, or raise `LOGIN_RATE_LIMIT`/`SET_PASSWORD_RATE_LIMIT` temporarily in `.env.backend` for a load-testing session |
| `bootstrap_admin` refuses with "an HR Admin already exists" | Working as designed — see [§7](#7-first-hr-admin-creation) | If you genuinely need to replace them, do it through the app's own Employees UI as that admin, not this command |
| Onboarding document upload 500s with `PermissionError: [Errno 13] Permission denied: '/app/media/...'` | Found and fixed during Phase 6 live UAT: `backend/Dockerfile` now creates `/app/media` with the right ownership before switching to the non-root `django` user, so any *newly created* named volume inherits correct permissions automatically. This only bites a volume that was already created by an *older* image build (before this fix) — Docker only populates a volume's ownership from the image on first creation, not on every restart | `docker run --rm -v <volume-name>:/app/media alpine chown -R 100:101 /app/media` (100:101 is the `django` user/group id — confirm with `docker exec <backend-container> id django`), then recreate the `backend` container. Verify with `docker exec <backend-container> touch /app/media/test && rm /app/media/test` |

## 14. Security requirements

Non-negotiable before real users touch UAT or production:

- `DJANGO_DEBUG` must be `false` — hardcoded in `docker-compose.backend.prod.yml`, cannot be
  overridden by `.env.backend`. Prevents stack traces/settings from leaking to end users on an
  unhandled error.
- `DJANGO_SECRET_KEY` and `BACKEND_POSTGRES_PASSWORD` must be real, unique, high-entropy values —
  no insecure fallback exists in this profile (both fail the deployment fast if unset).
- Neither Postgres (`backend-db`) nor the Django app (`backend`) exposes a host port in
  `docker-compose.backend.prod.yml` — all traffic flows through Caddy → `frontend` (nginx) →
  `backend`, over the Docker-internal network only.
- The frontend serves a production static build via nginx, never Vite's development server —
  see `frontend/Dockerfile`'s `dev`/`build`/`prod` stages.
- Login and set-password are rate-limited per IP (`accounts/throttles.py`); set-password is
  CSRF-protected identically to login (`accounts/views.py`).
- `GUNICORN_WORKERS` must stay at `1` (its default) unless `CACHES` is also pointed at a shared
  backend (Redis/Memcached) — the rate limiter's counters live in Django's default in-process
  cache, which is per-worker-process, not shared. Verified live during UAT readiness testing:
  running 3 workers against a configured 10/min limit let more than 10 requests through before
  any 429, because each worker kept its own separate count.
- `ALLOW_BOOTSTRAP_ADMIN` must never be left `true` in a standing `.env.backend` — only ever a
  one-shot `-e` override for a single command invocation, per [§7](#7-first-hr-admin-creation).
- CORS/CSRF trusted origins must be the real deployment domain, never a wildcard.
