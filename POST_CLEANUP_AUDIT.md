# Leave Management System — Post-Cleanup Audit

This document records what was actually deleted, what was preserved, and the validation run
immediately after cleanup. Cleanup was performed strictly against `PRE_CLEANUP_DELETE_PLAN.md`
as the deletion authority — only paths explicitly marked `YES` (safe to delete) in that document,
plus `public/agrileaf-logo.png` (resolved below), were removed.

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React + TypeScript + Ant Design (Vite), in `frontend/` |
| Backend | Django + Django REST Framework, in `backend/` |
| Database | PostgreSQL (`backend-db` service) |
| Infrastructure | Docker / Docker Compose (`docker-compose.backend.yml` dev, `docker-compose.backend.prod.yml` UAT/prod) |
| UI library | Ant Design (`antd`) |

This is now the **only** application in the repository. No second frontend, no second backend.

---

## Logo resolution (blocker from the approval message)

`public/agrileaf-logo.png` was traced before any deletion:
- Referenced only by the old Next.js components `src/components/auth/auth-shell.tsx` and
  `src/components/layout/app-shell.tsx`.
- **Zero** references anywhere in `frontend/` — no `<img>`, no import, no favicon link in
  `frontend/index.html`, no CSS `background-image`. The one `grep` hit for "logo" in
  `frontend/src/components/AppLayout.tsx` was `LogoutOutlined`/"Sign out", a false positive.

**Conclusion**: the current application does not need this asset. It was deleted along with the
rest of `public/`. Nothing was copied into `frontend/`, per the instruction not to keep `public/`
"merely for compatibility."

---

## Deleted legacy components

31 top-level paths (157+21+14+... files, ~180 tracked files, plus 2 large gitignored/generated
directories), all classified `YES` in `PRE_CLEANUP_DELETE_PLAN.md`:

| Path | What it was |
|---|---|
| `src/` (157 files) | Next.js App Router — every page/API route of the original app |
| `drizzle/`, `drizzle.config.ts` | Next.js's ORM schema/migrations |
| `public/` (incl. `agrileaf-logo.png`) | Next.js static assets — resolved above |
| `tests/`, `playwright.config.ts`, `vitest.config.mts` | Next.js's own Vitest/Playwright suites |
| `scripts/bootstrap-admin.ts` | Next.js-specific first-admin script |
| `vendor/xlsx-0.20.3.tgz` (root) | Next.js's vendored xlsx copy |
| `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `Caddyfile` (root) | Next.js Docker stack |
| `next.config.ts`, `next-env.d.ts`, `components.json`, `eslint.config.mjs`, `postcss.config.mjs`, `sentry.server.config.ts` | Next.js/shadcn/Sentry-for-Next.js build config |
| `tsconfig.json`, `tsconfig.tsbuildinfo` (root) | Next.js TS config + build cache |
| `package.json`, `package-lock.json` (root) | Next.js dependency tree |
| `.env`, `.env.example`, `.env.production.example` (root) | Next.js env templates |
| `node_modules/` (910MB), `.next/` (225MB) | Generated/gitignored build artifacts |
| `.github/workflows/ci.yml` | CI for the Next.js app only (replaced by `ci-app.yml`) |
| `backup/backup.sh`, `restore.sh`, `crontab`, `test-restore.sh` | Backup tooling hardcoded to `leaflow`/`db`/`docker-compose.prod.yml`/`app` (replaced by `backend-backup/`) |
| `.DS_Store` (root) | macOS Finder artifact |
| `test-results/` | Playwright's own run-output directory (artifact of the deleted `tests/` suite) |

## Preserved components

Everything the current application actually runs on:

- `backend/` — all 12+ Django apps, models, migrations, tests
- `frontend/` — all React/TypeScript source, tests, `nginx.conf`
- `docker-compose.backend.yml`, `docker-compose.backend.prod.yml`
- `Caddyfile.backend`, `frontend/nginx.conf`, `frontend/nginx-proxy-params.conf`
- `.env.backend`, `.env.backend.example`, `.env.backend.uat.example`, `.env.backend.production.example`
- `backend-backup/` (new backup/restore tooling, built and tested in the prior pass)
- `.github/workflows/ci-app.yml` (new CI)
- `README.md`, `DEPLOYMENT.md`, `DEPLOYMENT.backend.md`, `AGENTS.md`, `CLAUDE.md`
- `.dockerignore`
- `MIGRATION_AUDIT.md`, `PRE_CLEANUP_REVIEW.md`, `PRE_CLEANUP_DELETE_PLAN.md` — kept as this
  project's own audit trail (the delete plan marked these "your call"; keeping them since they
  document the migration and no instruction called for removing them)

No file belonging to the current application was touched.

---

## Dependencies

`frontend/package.json` and `backend/requirements.txt` were inspected — neither ever referenced
`next`, `nextjs`, or `drizzle` (they were always scoped to the current stack, independent of the
old root `package.json`). **No dependency removal was needed or performed** — there was nothing
to prune.

Final architecture has no residual requirement on Next.js, Drizzle, or the old frontend/backend
stack.

---

## Legacy scan (post-deletion)

Repository-wide search for `next`/`next.js`/`nextjs`, `drizzle`/`drizzle-orm`/`drizzle-kit`,
`leaflow`, and old service/compose names (excluding `.git`, `node_modules`):

**Result: zero functional references.** Every remaining hit is one of:
1. Root-level documentation (`README.md`, `DEPLOYMENT.md`, `AGENTS.md`, `MIGRATION_AUDIT.md`,
   `PRE_CLEANUP_REVIEW.md`, `PRE_CLEANUP_DELETE_PLAN.md`) — historical/explanatory, expected.
2. Deliberate contrastive comments inside current, required files, e.g.:
   - `backend-backup/backup.sh:2`: *"not the old Next.js app's crontab... targets a different database entirely"*
   - `backend-backup/backup.sh:3,30` / `restore.sh:4` / `docker-compose.backend.prod.yml:135` /
     `DEPLOYMENT.backend.md:254`: contrast against the old `leaflow` database name — never an
     actual credential or connection string
   - `backend/config/urls.py`: *"mirrors the Next.js app's GET /api/health"* (design-rationale comment)
   - `backend/leave_requests/services.py`, `backend/leave_balances/services.py`,
     `backend/onboarding/services.py`: *"Ported from the source Next.js app's..."* (provenance comment)
   - `frontend/src/lib/api-client.ts`, `frontend/src/routes/AdminRoute.tsx`: architectural-contrast comments
   - `.github/workflows/ci-app.yml:3`: *"Replacement for the old ci.yml..."*

No occurrence is an import, a config value, a connection string, or a functional dependency.

---

## Validation

| Check | Result |
|---|---|
| TypeScript (`npx tsc -b`) | ✅ Clean, no errors |
| Frontend build (`npx vite build`) | ✅ Succeeded (pre-existing >500kB chunk-size warning only, unrelated to cleanup) |
| Frontend lint | N/A — no lint script configured in `frontend/package.json` |
| Frontend tests (`npx vitest run`) | ✅ 52/52 passed (5 files) |
| Django checks (`manage.py check`) | ✅ 0 issues |
| Django migrations (`manage.py migrate --check`) | ✅ No pending migrations |
| Django tests (`manage.py test`) | ✅ 509/509 passed, 3 skipped (expected weekend-guard skips — today is Sunday 2026-08-16), 0 failures, 0 errors |
| Docker config, dev (`docker-compose.backend.yml`) | ✅ Valid |
| Docker config, prod (`docker-compose.backend.prod.yml`) | ✅ Valid (confirmed with dummy secrets — the earlier "missing `BACKEND_POSTGRES_PASSWORD`" message is expected on a dev machine with no prod secrets loaded, not a cleanup regression) |
| Docker runtime | ✅ All 4 dev containers remained `Up`/`healthy` throughout (`backend`, `backend-db`, `frontend`, `mailpit`) — never restarted, never rebuilt |

---

## Database

- **Database was NOT deleted.** No `DROP`, `flush`, `migrate zero`, or `docker compose down -v`
  was run at any point.
- **Docker volumes were NOT deleted.** `leave-django-dev_backend-db-data` and
  `leave-django-dev_backend-media-data` are the same volumes from before cleanup (untouched).
- **Existing data was preserved**, confirmed by live read-only row counts after cleanup:
  - `accounts_employee`: 11
  - `departments_department`: 4
  - `leave_requests_leaverequest`: 20

  These match the counts captured during the backup-mechanism test earlier in this project (same
  session, prior to cleanup) — no drift, no data loss.

---

## Pages verified

Direct login verification was not performed in this pass — no plaintext admin credentials are
stored anywhere in this repo or its env files (correctly; passwords are hashed in the database),
and guessing/brute-forcing credentials is out of scope. Instead, verification relied on:

1. **Live connectivity check** (this pass): app loaded at `http://localhost:5180`, login page
   rendered correctly, `GET /api/auth/csrf/` → 200, `GET /api/auth/me/` → 403 (expected —
   correct "not authenticated" response), zero console errors, zero broken asset requests.
2. **Automated coverage** (already passing, re-confirmed this pass): the 509 backend tests and 52
   frontend tests exercise the actual pages/APIs behind Dashboard, My Leave (apply/cancel),
   My Team/Approvals, Employees, Departments, Leave Types, Leave Balances, Holidays, Resources
   (Onboarding), Training, Reports, Audit History, and Settings — including RBAC boundaries for
   each. These are the same suites that back tasks #181–199 (full UAT) and #117–122 (guardrail
   audit) earlier in this project.

No deletion touched any file these tests or pages depend on, and no test that was passing before
cleanup started failing after it.

---

## Remaining open item

None. The one item flagged `MANUAL REVIEW` in `PRE_CLEANUP_DELETE_PLAN.md`
(`public/agrileaf-logo.png`) is resolved above and deleted.
