# Leave Management System — Migration Audit

**Audit only. No files were deleted, moved, renamed, or modified. No application code was changed. No database data was modified, and no migrations were reset. Verification commands (TypeScript check, build, tests, `manage.py check`, `manage.py test`) were run as read-only checks — `manage.py test` runs against Django's own auto-created/destroyed throwaway test database, never the real dev database. The only file created by this audit is this report.**

**Important scope note found during this audit:** there is a second, entirely unrelated Docker project also named similarly (`leave-management-system`, containers `leave-management-system-{frontend,backend,db}-1`) running on this machine, located at `/Users/sthuthi/Downloads/leave-management-system/` — a different codebase, different Django app structure, different dependencies, different database. It happens to occupy the default ports `localhost:5173` and `localhost:8000` that this audit's Phase 10 instructions named. **Nothing in this report refers to that project.** This repository's actual Django+React stack is reachable at `localhost:5180` (frontend) and `localhost:8012` (backend) — see Section 13.

---

## 1. Target Architecture

- **Frontend**: React, TypeScript, Ant Design
- **Backend**: Django, Django REST Framework
- **Database**: PostgreSQL
- **Infrastructure**: Docker / Docker Compose

## 2. Current Architecture

Confirmed by reading actual entry points and running code, not by folder names:

- **Frontend**: React 18.3.1, ReactDOM 18.3.1, TypeScript 5.7.2, Ant Design 5.22.5, `@ant-design/icons` 5.5.2, `@ant-design/charts` 2.2.7, Vite 6.0.3, React Router 7.0.2, TanStack Query 5.62.7, `dayjs` 1.11.13. Entry point traced: `frontend/index.html` → `frontend/src/main.tsx` (imports `antd/dist/reset.css`, `ReactDOM.createRoot(...).render(<App />)`).
- **Backend**: Django 5.1.4, djangorestframework 3.15.2, django-cors-headers 4.6.0, psycopg[binary] 3.2.3, django-environ 0.11.2, argon2-cffi 23.1.0, gunicorn 23.0.0, whitenoise 6.8.2. Entry point traced: Docker → `backend/entrypoint.sh` (`manage.py migrate --noinput`) → `gunicorn config.wsgi:application` → `backend/config/urls.py`.
- **Database**: PostgreSQL 16 (`postgres:16-alpine`). `backend/config/settings.py:83` — `DATABASES = {"default": env.db("DJANGO_DATABASE_URL")}`, fed a `postgres://` URL only. Zero `sqlite3` references anywhere in `backend/`.
- **Infrastructure**: `docker-compose.backend.yml` (dev), `docker-compose.backend.prod.yml` (prod), `backend/Dockerfile`, `frontend/Dockerfile`, `Caddyfile.backend`, `frontend/nginx.conf` + `nginx-proxy-params.conf`.

## 3. Repository Structure

Two complete, independent applications coexist in this repository, confirmed by direct inspection:

1. **Current (target architecture)**: `backend/` (234 tracked files, 12 Django apps) + `frontend/` (157 tracked files, React+TS+AntD).
2. **Old (Next.js, pre-migration)**: root-level `src/` (157 files, 100% Next.js App Router — every route is `src/app/api/*/route.ts` or `src/app/(app)/*/page.tsx`), plus its own `drizzle/` ORM, `tests/`, `public/`, and Docker/config files.

No `server/`, `client/`, `old/`, `legacy/`, or versioned-duplicate (`v1/`, `v2/`) directories exist anywhere in the repository (explicitly searched, none found). No `.bak`/`.old`/`.backup`/`*copy*` files exist anywhere (explicitly searched, none found).

Top-level inventory:

| Item | Belongs to | Notes |
|---|---|---|
| `backend/`, `frontend/` | Current | Target architecture |
| `docker-compose.backend.yml`, `docker-compose.backend.prod.yml`, `Caddyfile.backend` | Current | |
| `.env.backend`, `.env.backend.example`, `.env.backend.uat.example`, `.env.backend.production.example` | Current | |
| `DEPLOYMENT.backend.md` | Current | |
| `src/`, `drizzle/`, `drizzle.config.ts` | Old | Next.js app + its ORM |
| `tests/`, `playwright.config.ts`, `vitest.config.mts` | Old | Next.js's own test suites |
| `public/` | Old | Next.js static assets |
| `scripts/bootstrap-admin.ts` | Old | Next.js's own bootstrap script; Django has its own equivalent |
| `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `Caddyfile` | Old | Next.js Docker stack |
| `next.config.ts`, `next-env.d.ts`, `components.json`, `eslint.config.mjs`, `postcss.config.mjs`, `sentry.server.config.ts`, `tsconfig.json`, `tsconfig.tsbuildinfo` | Old | Next.js build config |
| `package.json`, `package-lock.json` (root) | Old | Next.js dependency tree |
| `.env`, `.env.example`, `.env.production.example` | Old | Next.js env templates |
| `README.md`, `DEPLOYMENT.md` | Old (docs) | Document the Next.js app |
| `AGENTS.md`, `CLAUDE.md` | Old (tooling artifact) | Auto-written by `next dev`; repo-wide instruction file |
| `.github/workflows/ci.yml` | Old (config) | Only builds/tests the Next.js app |
| `backup/` (backup.sh, restore.sh, crontab, test-restore.sh) | Uncertain | Needs confirming whether it targets the Next.js `db` container specifically |
| `vendor/xlsx-0.20.3.tgz` (root) | Old | Next.js's own vendored copy; `frontend/vendor/` has its own separate copy |
| `node_modules/` (root), `.next/` | Old (generated) | Gitignored build artifacts |
| `.DS_Store` | Neither | macOS artifact |

## 4. Frontend Audit

- **Files**: 157 tracked files under `frontend/`. Zero `.js`/`.jsx` files anywhere in `frontend/src` — 100% `.ts`/`.tsx`.
- **Components**: `AppLayout.tsx`, `ChangePasswordModal.tsx`, `EmployeeImportDialog.tsx`, `HolidayImportDialog.tsx` + 19 page components under `frontend/src/pages/`.
- **Routing**: `frontend/src/App.tsx`, React Router 7, lazy-loaded per page (`React.lazy` + `Suspense`), `AdminRoute.tsx`/`ProtectedRoute.tsx` guards.
- **API client**: exactly one — `frontend/src/lib/api-client.ts`. No duplicate or competing API client files found.
- **State/data**: TanStack Query for server state (26 files); no separate global client-state library (Redux/Zustand/etc.) — not needed given the app's shape, not a gap.
- **UI framework**: Ant Design confirmed as the *only* UI library — 25 files import `antd` directly, plus the reset CSS import at the actual app entry point (`main.tsx`). No Tailwind, no shadcn/Radix, no Bootstrap, no Material UI found anywhere in `frontend/`.
- **Duplicate/unused components**: none found — every exported component/page name across `frontend/src` is unique (checked by extracting every `export function`/`export const` name and diffing for duplicates: zero matches).
- **Old UI code inside `frontend/`**: none found.

## 5. Backend Audit

- **Django apps** (12): `accounts`, `audit`, `dashboard`, `departments`, `holidays`, `leave_balances`, `leave_requests`, `leave_types`, `onboarding`, `org_settings`, `reports`, `team_calendar`. Each has its own `models.py` (where applicable), `serializers.py`, `views.py`, `urls.py`, `tests/`.
- **Models with migrations**: `accounts` (2), `audit` (1), `departments` (1), `holidays` (1), `leave_balances` (1), `leave_requests` (2), `leave_types` (1), `onboarding` (1), `org_settings` (1) — 11 migration files across 9 apps.
- **Deliberately model-less apps**: `dashboard`, `reports`, `team_calendar` — confirmed these have no `models.py`; they are read-only aggregation views over other apps' data. Correct design, not a gap.

**URL → View trace** (every `urls.py` read in full): 15 top-level includes in `backend/config/urls.py`, covering `admin/`, `api/health/`, `api/health/deep/`, and one `include()` per app.

**Frontend → Backend endpoint mapping (the core evidence for backend completeness)**: every `api.get/post/patch/delete` call site in `frontend/src` was extracted (63 unique call sites, all `.test.` files excluded) and matched against every `urls.py` pattern. **100% of frontend calls resolve to a real, existing Django endpoint.** Full mapping:

| Frontend call | Django endpoint | View |
|---|---|---|
| `GET/POST /auth/csrf/`, `/login/`, `/logout/`, `/me/`, `/set-password/`, `/change-password/`, `/forgot-password/` | `accounts/auth_urls.py` | `CsrfView`, `LoginView`, `LogoutView`, `MeView`, `SetPasswordView`, `ChangePasswordView`, `ForgotPasswordView` |
| `GET/POST /employees/`, `PATCH /employees/{id}/`, `POST /employees/{id}/resend-invitation/`, `/send-password-reset/`, `POST /employees/import/` | `accounts/urls.py` | `EmployeeListCreateView`, `EmployeeDetailView`, `ResendInvitationView`, `AdminSendPasswordResetView`, `EmployeeImportView` |
| `GET/POST /departments/`, `PATCH/DELETE /departments/{id}/` | `departments/urls.py` | `DepartmentListCreateView`, `DepartmentDetailView` |
| `GET/POST /leave-types/`, `PATCH/DELETE /leave-types/{id}/` | `leave_types/urls.py` | `LeaveTypeListCreateView`, `LeaveTypeDetailView` |
| `GET/POST /holidays/`, `PATCH/DELETE /holidays/{id}/`, `POST /holidays/import/` | `holidays/urls.py` | `HolidayListCreateView`, `HolidayDetailView`, `HolidayImportView` |
| `GET /leave-balances/` | `leave_balances/urls.py` | `MyLeaveBalancesView` |
| `GET/POST /leave-requests/`, `POST /leave-requests/preview/`, `POST .../{id}/cancel/`, `.../decide/` | `leave_requests/urls.py` | `LeaveRequestListCreateView`, `PreviewLeaveRequestView`, `CancelLeaveRequestView`, `DecideLeaveRequestView` |
| `GET /dashboard/` | `dashboard/urls.py` | `DashboardView` |
| `GET /audit-log/` | `audit/urls.py` | `AuditLogListView` |
| `GET/PATCH /settings/` | `org_settings/urls.py` | `OrganizationSettingsView` |
| `GET /team-calendar/` | `team_calendar/urls.py` | `TeamCalendarView` |
| `GET /reports/` | `reports/urls.py` | `ReportsView` |
| `GET/POST /onboarding/resources/`, `PATCH/DELETE .../{id}/`, `.../document/`, `.../versions/`, `GET/POST /onboarding/checklists/`, `.../{id}/`, `.../tasks/`, `PATCH/DELETE /onboarding/tasks/{id}/`, `.../move/`, `.../complete/`, `GET /onboarding/my-checklist/`, `/onboarding/progress/` | `onboarding/urls.py` | `ResourceListCreateView`, `ResourceDetailView`, `ResourceDocumentView`, `ResourceVersionsView`, `ChecklistListCreateView`, `ChecklistDetailView`, `ChecklistTasksView`, `TaskDetailView`, `TaskMoveView`, `TaskCompleteView`, `MyChecklistView`, `EmployeeProgressView` |

**Backend endpoint with no frontend consumer**: `GET /api/leave-requests/<id>/` (`LeaveRequestDetailView`, `RetrieveAPIView`). Not a bug — its docstring documents this is intentional, mirroring the original app's "no edit endpoint; cancel + recreate" design. My Leaves and Approvals both use the *list* endpoint with query params instead.

**Duplicate/old backend code**: none found inside `backend/`. No duplicate class names outside Django's normal one-`Command`-per-management-command pattern (expected, not a defect).

## 6. Database Audit

- **Active database**: PostgreSQL 16, confirmed via `docker-compose.backend.yml`'s `backend-db` service and the live `DJANGO_DATABASE_URL` env var.
- **Models**: 9 apps with models, all Postgres-backed via the Django ORM.
- **Migrations**: 11 files across 9 apps. `manage.py check` → 0 issues. `manage.py migrate` on container start → **"No migrations to apply"** (confirmed via live logs — migrations are fully in sync with models).
- **Relationships**: standard FK relationships (e.g. `Employee.department`, `Employee.manager`, `LeaveRequest.employee`/`leave_type`/`approver`, `Task.checklist`, `TaskCompletion.employee`/`task`) — not independently re-verified line-by-line in this pass (already verified in the two prior audit passes this session), no new concerns raised.
- **Legacy database code**: none found — no SQLite file, no local JSON persistence, no `localStorage`/`IndexedDB` usage anywhere in `backend/` or `frontend/` (explicitly grepped, zero matches).
- **No database was modified, reset, or had data changed during this audit.**

## 7. Docker Audit

**Containers actually in use for this repository** (confirmed via `docker compose ps` against `docker-compose.backend.yml`, all healthy at time of audit):

| Service | Image | Host port | Container port | Status |
|---|---|---|---|---|
| `frontend` | `leave-django-dev-frontend` (built from `frontend/Dockerfile`, `target: dev`) | 5180 | 5173 | Up, healthy |
| `backend` | `leave-django-dev-backend` (built from `backend/Dockerfile`) | 8012 | 8000 | Up, healthy |
| `backend-db` | `postgres:16-alpine` | 5435 | 5432 | Up, healthy (4-day-old volume, data preserved) |
| `mailpit` | `axllent/mailpit:latest` | 8026 (web), 1026 (SMTP) | 8025, 1025 | Up, healthy |

**Volumes**: `backend-db-data` (Postgres data, persists across `down`/`up`), `backend-media-data` (onboarding document uploads). Both pre-existed from prior work and were **not** reset by this audit.

**No duplicate or obsolete Docker configuration found *within* `docker-compose.backend.yml`/`docker-compose.backend.prod.yml` themselves** — they are internally clean, single-purpose files. The obsolete Docker configuration in this repository is the *entire separate* old-stack set (`Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `Caddyfile` at root) — see Section 3.

`docker compose -f docker-compose.backend.yml config` → validates clean, no errors.

## 8. Functional Migration Matrix

| Feature | Old Code | React UI | Django API | DB Model | Tests | Status |
|---|---|---|---|---|---|---|
| Authentication / Login | YES (`src/app/api/auth/*`) | YES (`LoginPage.tsx`) | YES (`accounts/auth_urls.py`) | YES (`Employee`) | YES | COMPLETE |
| Dashboard (Employee/Manager) | YES (`EmployeeDashboard` component) | YES (`DashboardPage.tsx`) | YES (`dashboard/views.py`) | N/A (aggregation) | YES | COMPLETE |
| Dashboard (HR/Admin) | YES (`HrDashboard` component) | YES (`DashboardPage.tsx`) | YES (`dashboard/views.py`) | N/A (aggregation) | YES | COMPLETE |
| Employees | YES | YES (`EmployeeListPage.tsx`) | YES (`accounts/views.py`) | YES (`Employee`) | YES | COMPLETE |
| Departments | YES | YES (`DepartmentsPage.tsx`) | YES (`departments/views.py`) | YES (`Department`) | YES | COMPLETE |
| Roles / Permissions | YES (`src/lib/rbac.ts`) | YES (`AdminRoute.tsx`, role-gated nav) | YES (`accounts/permissions.py`, `IsAdminRole`) | YES (`Employee.role`) | YES | COMPLETE |
| Leave Types | YES | YES (`LeaveTypesPage.tsx`) | YES (`leave_types/views.py`) | YES (`LeaveType`) | YES | COMPLETE |
| Leave Balances | YES | YES (balance cards, multiple pages) | YES (`leave_balances/views.py`) | YES (`LeaveBalance`) | YES | COMPLETE |
| Leave Requests / Apply Leave | YES | YES (`ApplyLeavePage.tsx`) | YES (`leave_requests/views.py`) | YES (`LeaveRequest`) | YES | COMPLETE |
| Leave Approval | YES | YES (`ApprovalsPage.tsx`) | YES (`DecideLeaveRequestView`) | YES (`LeaveRequest`) | YES | COMPLETE |
| Rejection | YES | YES (same page, reject action) | YES (same view, comment required) | YES (`LeaveRequest`) | YES | COMPLETE |
| Holidays | YES | YES (`HolidaysPage.tsx`) | YES (`holidays/views.py`) | YES (`Holiday`) | YES | COMPLETE |
| Working Days | YES | YES (Settings page + day-count calc) | YES (`org_settings/views.py`, consumed by `leave_requests/services.py`) | YES (`OrganizationSettings`) | YES | COMPLETE |
| Training | YES (onboarding `TRAINING` category) | YES (Resource Library, filterable by category) | YES (`onboarding/views.py`) | YES (`Resource.category`) | YES | COMPLETE |
| Resources | YES | YES (`ResourceLibraryPage.tsx`, `OnboardingAdminPage.tsx`) | YES (`onboarding/views.py`) | YES (`Resource`, `ResourceDocument`, `ResourceVersion`) | YES | COMPLETE |
| Reports | YES | YES (`ReportsPage.tsx`) | YES (`reports/views.py`) | N/A (aggregation) | YES | COMPLETE |
| Audit History | YES | YES (`AuditLogPage.tsx`) | YES (`audit/views.py`) | YES (`AuditLogEntry`) | YES | COMPLETE |
| Settings | YES | YES (`SettingsPage.tsx`) | YES (`org_settings/views.py`) | YES (`OrganizationSettings`) | YES | COMPLETE |
| My Leave | YES | YES (`MyLeavesPage.tsx`) | YES (list endpoint, `?scope=mine`) | YES (`LeaveRequest`) | YES | COMPLETE |
| My Team | YES (as "Team Calendar") | YES (`TeamCalendarPage.tsx`) | YES (`team_calendar/views.py`) | N/A (aggregation) | YES | COMPLETE |
| Approvals | YES | YES (`ApprovalsPage.tsx`, `?scope=approvals`) | YES (same as Leave Approval above) | YES (`LeaveRequest`) | YES | COMPLETE |

No feature in this list was found to be PARTIAL, MISSING, or a duplicate. "My Team" is not a separately named module in either app — both call it "Team Calendar"; confirmed by direct search (zero results for "My Team"/"MyTeam" as a distinct feature in either codebase). "Notifications" was in neither codebase's product scope — zero references in `src/` either, so there is nothing to migrate.

## 9. Legacy Code Inventory

The entire root-level Next.js implementation. Full itemized list already given in Section 3. In file-count terms: 157 files under `src/`, plus `drizzle/` (21 files), `tests/` (14 files), `public/` (6 files), `scripts/` (1 file), and ~20 root-level config/Docker/doc files.

## 10. Duplicate Code

**Within the current stack (`backend/` + `frontend/`)**: none found. Zero duplicate component names, zero duplicate Django classes (outside the expected one-per-management-command `class Command` pattern), exactly one API client, exactly one Django project.

**Across old vs. new**: every feature in Section 8 is implemented once in each stack — this is expected "two full implementations of the same product" duplication (the entire point of a migration), not accidental/careless duplication. Confirmed zero cross-references between the two: no Next.js API usage anywhere in `backend/`/`frontend/`, no Django/DRF reference anywhere in `src/` (both directions explicitly grepped).

## 11. Unused Code

- **Backend**: `GET /api/leave-requests/<id>/` (`LeaveRequestDetailView`) has no frontend consumer (see Section 5) — intentional per its own docstring, not dead code to remove.
- **Frontend**: no unused components, hooks, pages, or services found.
- **Dependencies**: none found unused — see Section 12.

## 12. Dependencies Audit

**Frontend** (`frontend/package.json`) — every dependency confirmed imported in source (file counts from direct grep):

| Dependency | Version | Used in | Belongs to old implementation? |
|---|---|---|---|
| react, react-dom | 18.3.1 | entire app | No |
| typescript | 5.7.2 | entire app | No |
| antd | 5.22.5 | 25 files | No |
| @ant-design/icons | 5.5.2 | 12 files | No |
| @ant-design/charts | 2.2.7 | 2 files (Reports) | No |
| @tanstack/react-query | 5.62.7 | 26 files | No |
| react-router-dom | 7.0.2 | 11 files | No |
| dayjs | 1.11.13 | 10 files | No |
| xlsx | 0.20.3 (vendored) | 2 files (import dialogs) | No |
| @testing-library/react, jsdom, vitest, @vitejs/plugin-react, vite | dev only | build/test tooling | No |

**Backend** (`backend/requirements.txt`) — every package confirmed referenced:

| Dependency | Version | Purpose | Belongs to old implementation? |
|---|---|---|---|
| Django | 5.1.4 | framework | No |
| djangorestframework | 3.15.2 | API layer | No |
| django-cors-headers | 4.6.0 | CORS (separate frontend origin) | No |
| psycopg[binary] | 3.2.3 | Postgres driver | No |
| django-environ | 0.11.2 | env-var config | No |
| argon2-cffi | 23.1.0 | password hashing | No |
| gunicorn | 23.0.0 | WSGI server | No |
| whitenoise | 6.8.2 | static file serving | No |

**No suspicious, legacy, or unused dependency found in either file.** The old implementation's entire dependency tree lives in the *separate* root-level `package.json` (Next.js, Drizzle, shadcn/Radix, Tailwind, Sentry-for-Next.js, nodemailer, zod, etc.) — none of it is imported by or required for `backend/`/`frontend/` to run.

## 13. Runtime Verification

Verified against the actually-configured ports (the Phase 10 instructions named `localhost:5173`/`:8000`, but — see the scope note at the top of this report — those ports are occupied by a different, unrelated project on this machine; this repo's real host-mapped ports are 5180/8012):

| Check | Result |
|---|---|
| Frontend (`http://localhost:5180/`) | **HTTP 200** |
| Backend shallow health (`http://localhost:8012/api/health/`) | **HTTP 200**, `{"status": "ok"}` |
| Backend deep health (`http://localhost:8012/api/health/deep/`) | **HTTP 200**, `{"status": "ok", "checks": {"database": "ok"}}` |
| Backend container logs | Clean — `gunicorn` started, 1 worker booted, **"No migrations to apply"**, zero errors/tracebacks |
| Frontend container logs | Clean — Vite dev server ready in 669ms, zero errors |
| Docker health checks | All 4 containers report `healthy` (frontend has no explicit healthcheck configured but responds 200) |

No React errors, no TypeScript errors, no API errors, no Django errors, no database errors found in logs. No obviously broken routes found.

## 14. Build / TypeScript / Lint / Test Results

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc -b` (frontend) | **PASS** — 0 errors |
| Build | `npx vite build` (frontend) | **PASS** — built in 6.99s |
| Lint | — | **NOT CONFIGURED** — no `lint` script exists in `frontend/package.json`. Not invented for this audit per instructions. |
| Frontend tests | `npx vitest run` | **PASS** — 52/52 |
| Django check | `manage.py check` | **PASS** — 0 issues |
| Django tests | `manage.py test` | **507/509 PASS**, 2 errors, 1 skip |

**On the 2 Django test errors** (both in `dashboard/tests/test_hr_dashboard.py`): root cause traced precisely — the audit was run on **Sunday 2026-08-16**. Both failing tests call `apply_leave_request(..., start_date=self.today, end_date=self.today, ...)`, i.e. they apply for a single day of leave *today*. Since the default working-days setting is Mon–Fri, applying for a single Sunday correctly raises `ApplyLeaveError("NO_WORKING_DAYS", ...)` — this is the **application behaving correctly**, not a bug. A third, unrelated test in a different file (`leave_requests/tests/test_apply.py::test_start_date_today_is_allowed`) already has a guard for this exact scenario and self-skips with the literal message `'today is a weekend in this test run'` — the two `dashboard` tests are missing that same guard. This is a pre-existing test-fixture gap (inconsistently applied weekend guard), unrelated to the migration and unrelated to Next.js→Django parity. It would pass cleanly on any weekday.

## 15. Missing Functionality

**None found.** Every feature in Section 8's matrix has a complete new implementation. Every frontend API call in Section 5 resolves to a real endpoint.

## 16. Migration Gaps

**None found**, with two minor housekeeping notes (neither is a functional migration gap):

1. `frontend/package.json` has no `lint` script configured.
2. Two Django tests have a date-dependent flakiness gap (Section 14) — a test-fixture quality issue, not a migration or functionality gap.

## 17. Files Safe to Remove

*(Reported for planning only — not executed. Full classification per the 5-category scheme requested.)*

| Path | Classification | Reason | References found | Replacement | Risk | Confidence |
|---|---|---|---|---|---|---|
| `src/` | C — Unused/safe candidate | Entire Next.js App Router implementation | Zero references from `backend/`/`frontend/` (checked both directions) | `frontend/` + `backend/` | Low | High |
| `drizzle/`, `drizzle.config.ts` | C | Next.js's own ORM/migrations | Only referenced by `src/lib/db/*` | Django models/migrations | Low | High |
| `public/` | C | Next.js static assets | Only referenced by `src/app/layout.tsx` etc. | N/A — copy `agrileaf-logo.png` into `frontend/` first if wanted | Low (see note below) | High |
| `tests/`, `playwright.config.ts`, `vitest.config.mts` | C | Next.js's own test suites, exercise `src/app/api/*` directly | Only referenced by root `package.json` scripts | `backend/*/tests/`, `frontend/src/**/*.test.tsx` | Low | High |
| `scripts/bootstrap-admin.ts` | C | Next.js-specific bootstrap script | Only referenced by root `package.json`'s `bootstrap-admin` script | `backend/accounts/management/commands/bootstrap_admin.py` | Low | High |
| `vendor/xlsx-0.20.3.tgz` (root) | C | Next.js's own vendored copy | Only referenced by root `package.json` | `frontend/vendor/xlsx-0.20.3.tgz` (separate copy, already in place) | Low | High |
| `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `Caddyfile` (root) | C | Next.js Docker stack | Only referenced by each other / manual invocation | `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.backend*.yml`, `Caddyfile.backend` | Low | High |
| `next.config.ts`, `next-env.d.ts`, `components.json`, `eslint.config.mjs`, `postcss.config.mjs`, `sentry.server.config.ts`, `src/instrumentation.ts` | C | Next.js/shadcn/Sentry-for-Next.js build config | Next.js build only | N/A | Low | High |
| `tsconfig.json`, `tsconfig.tsbuildinfo` (root) | C | Next.js TS config + build cache | Next.js build only | `frontend/tsconfig.json` | Low | High |
| `package.json`, `package-lock.json` (root) | C | Next.js dependency tree | `npm` commands, old CI | `frontend/package.json`, `backend/requirements.txt` | Low | High |
| `.env`, `.env.example`, `.env.production.example` (root) | C | Next.js env templates | Next.js runtime only | `.env.backend*` | Low | High |
| `node_modules/` (root, 910MB), `.next/` (225MB) | C | Generated/gitignored build artifacts | N/A | N/A | Low | High |

**Note on `public/agrileaf-logo.png`**: confirm whether this logo should be copied into `frontend/` before deleting its parent folder — the React app doesn't currently reference it at all, and it's the only asset in `public/` that might be intentionally reusable rather than pure Next.js boilerplate.

## 18. Files That Must NOT Be Removed

| Path | Reason |
|---|---|
| `backend/`, `frontend/` | The entire current application |
| `docker-compose.backend.yml`, `docker-compose.backend.prod.yml` | Run the current stack |
| `Caddyfile.backend`, `frontend/nginx.conf`, `frontend/nginx-proxy-params.conf` | Current production reverse proxy |
| `DEPLOYMENT.backend.md` | Documents the current deployment |
| `.env.backend`, `.env.backend.example`, `.env.backend.uat.example`, `.env.backend.production.example` | Current env config, including the real local `.env.backend` holding a generated secret key |
| `.dockerignore` | Applies to whichever Dockerfile is active |

## 19. Files Requiring Manual Review

| Path | Why it needs review before any deletion decision |
|---|---|
| `backup/*.sh`, `backup/crontab` | Need to confirm whether these back up the Next.js `db` container specifically (by container name/port) or are generic enough to repoint at the Django `backend-db` — deleting without checking could leave no backup tooling for the current app if nothing equivalent exists yet |
| `.github/workflows/ci.yml` | Currently only builds/tests the Next.js app; **should be replaced with a `backend/`/`frontend/`-scoped workflow, not simply deleted** — deleting it outright leaves the repo with zero CI |
| `AGENTS.md` / `CLAUDE.md` | Repo-wide Claude Code instruction file, currently Next.js-tooling-authored ("This is NOT the Next.js you know"); needs content reflecting the current stack rather than blind deletion |
| `README.md` / `DEPLOYMENT.md` | Recommend rewriting so the repo root has *a* README describing the current app, rather than deleting and leaving none |
| `public/agrileaf-logo.png` | See note in Section 17 |

## 20. Recommended Cleanup Sequence

*(Sequence only — not executed in this audit.)*

1. Resolve the "Files Requiring Manual Review" items first (Section 19) — decide on the backup scripts, write replacement CI/docs content, confirm the logo.
2. Delete the Section 17 items only after step 1's replacements are in place.
3. Re-run `docker compose -f docker-compose.backend.yml config`, the frontend build, and the Django test suite one more time after deletion to confirm nothing broke (expect the same 507/509 pass rate on a non-Sunday run).
4. Remove the root `node_modules/`/`.next/` last, since they're the largest and least risky (pure generated output).

## 21. Migration Completion Score

| Dimension | Score | Basis |
|---|---|---|
| Architecture migration | **100%** | React+TS / Django+DRF / PostgreSQL / Docker all directly confirmed at running entry points, not inferred from folder names |
| Frontend migration | **100%** | Zero `.js` files, zero non-AntD UI library, zero duplicate components, all 19 pages present and building clean |
| Backend migration | **100%** | 100% of 63 unique frontend API calls resolve to real Django endpoints; zero orphaned calls; only 1 harmless unused GET endpoint (intentional, documented) |
| Infrastructure migration | **100%** | Docker Compose validated, all 4 containers healthy, clean logs, migrations fully applied |
| Functional migration | **100%** | 20/20 listed features have complete React UI + Django API + DB model + tests, per the matrix in Section 8 |

These are not rounded defaults — each is backed by the specific evidence cited in its section above (endpoint-by-endpoint trace, direct log/HTTP verification, file-count greps). The two caveats found (missing `lint` script, 2 date-dependent test failures) do not reduce any of the above scores because neither represents missing or broken functionality — see Section 16.

---

## MIGRATION STATUS: 🟢 COMPLETE

No blocking gaps were found. Before deleting any legacy code, the only outstanding items are the four in Section 19 (Files Requiring Manual Review) — none of them represent incomplete migration; they represent old-stack support files (CI, docs, backups) that need a replacement authored for the new stack rather than being deleted outright.

**Stopping here per instructions. No cleanup has been performed. Awaiting explicit separate instruction before any deletion.**
