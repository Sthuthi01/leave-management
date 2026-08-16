# Leave Management System — Pre-Cleanup Review

**No files were deleted, moved, or renamed. No database was modified or reset. No application functionality was changed.** The one deliberate exception, explicitly authorized in this task's Section 7: two Django **test files** were given a test-only weekend-skip guard, identical in wording and mechanism to a guard already established elsewhere in the same test suite. No application/production code was touched to make this fix.

---

## 1. Review of MIGRATION_AUDIT.md — independent cross-check, not blind trust

Every load-bearing claim was re-verified from scratch this pass, not copied forward:

| Claim in MIGRATION_AUDIT.md | Cross-check result |
|---|---|
| "63 unique frontend API call sites" | **Corrected: actually 68.** Re-extracted from scratch with a fresh grep — 68 distinct call-site lines in `frontend/src` (excluding `.test.` files). The discrepancy is a counting slip in the prior report, not a mapping error: all 68 call sites use the same ~43 endpoint *patterns* already validated against every `urls.py` — no new, previously-unchecked endpoint was found. |
| "All API calls map to real Django endpoints" | **Reconfirmed.** No new endpoint pattern appeared in the fresh 68-call extraction that wasn't already checked. |
| "Zero old-stack code referenced by the new stack" | **Reconfirmed, both directions.** Fresh grep for Next.js/Drizzle signatures in `backend/`+`frontend/` → zero matches. Fresh grep for Django/DRF signatures in `src/` → zero matches. |
| "Migration complete" | **Reconfirmed** — see Section 8 (unchanged from the prior audit; no new gap surfaced this pass). |
| "2 of 509 Django tests failing, date-dependent" | **Reconfirmed the diagnosis, then fixed it** — see Section 7 below. |

## 2–4. Legacy Candidate Review — Backup Scripts

**`backup/backup.sh`, `backup/restore.sh`, `backup/crontab`, `backup/test-restore.sh`** — read in full this pass (not just referenced from memory).

What they actually do:
- `backup.sh`: runs `pg_dump -h db -U "$POSTGRES_USER"` daily via cron, writes `leaflow_<timestamp>.dump`, prunes backups older than `BACKUP_RETENTION_DAYS`. Pure read-only against Postgres (safe by construction, per its own comment).
- `restore.sh`: **disaster recovery** — stops the `app` service, runs `pg_restore --clean --if-exists` against `docker-compose.prod.yml`'s `db`, requires typing `RESTORE` to confirm, restarts `app`.
- `crontab`: schedules `backup.sh` daily at 2 AM via `docker-compose.prod.yml`'s `backup` service.
- `test-restore.sh`: spins up a throwaway Postgres container, restores a chosen backup into *that*, verifies `SELECT count(*) FROM employees;`/`FROM departments;`, tears it down — never touches the real database.

**Hard evidence these are old-stack-only, not generic Postgres tooling:**
- Hostname `db` (the old stack's Postgres service name — the new stack's is `backend-db`)
- Hardcoded DB user/name **`leaflow`** (confirmed in root `docker-compose.yml`; the new stack uses `leaveapp`/`leaveapp_django`)
- Hardcoded `COMPOSE_FILE="docker-compose.prod.yml"` (the old stack's file — the new stack's is `docker-compose.backend.prod.yml`)
- Stops/starts a service named `app` (old stack's name — new stack's are `backend`/`frontend`)
- Queries table names `employees`/`departments` unprefixed, unquoted — matches the old stack's Drizzle schema naming, not Django's app-prefixed table names (e.g. `accounts_employee`)

None of these scripts would work against the current stack's database without rewriting every one of the above.

**Critical finding — the new stack currently has *no* backup mechanism at all.** `docker-compose.backend.prod.yml` has exactly 4 services (`backend-db`, `backend`, `frontend`, `caddy`) — no `backup` service. This isn't my inference: **`DEPLOYMENT.backend.md` §12 already says this explicitly**, in the current stack's own deployment guide:

> "**Not yet automated for this stack.** The Next.js app's `docker-compose.prod.yml` has a dedicated `backup` service...; this Django backend's `backend-db` currently has none. Before a real production launch, either: Add an equivalent bundled backup service...(mirroring the Next.js app's `backup/backup.sh` pattern)..."

**Classification: REPLACE THEN DELETE.** Deleting these scripts before building an equivalent for `backend-db` would leave the target-architecture application with zero backup/restore tooling — a real operational regression the project's own docs already flag as a pre-launch checklist item, not something newly discovered here.

## 4. CI/CD Review

**`.github/workflows/ci.yml`** (186 lines) — re-read in full.

- References `src/app/**`, `drizzle/**`, `Dockerfile`, `docker-compose*.yml`, `package.json`, `tests/**` in its path filters.
- Runs `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm test`, `npx playwright test` — all against the **root** `package.json` (Next.js).
- Starts the stack via `docker compose up -d --build` against the **root** `docker-compose.yml` (Next.js's `app`/`db`/`mailpit`).
- Fresh grep this pass: **zero occurrences** of `backend/`, `frontend/`, `Django`, `django`, `manage.py`, or `pytest` anywhere in the file.

**Verdict: obsolete for the target architecture.** It is 100% valid *for the Next.js app* (nothing broken about it on its own terms) but has **zero awareness of the Django/React stack** — no job builds, type-checks, lints, or tests `backend/` or `frontend/` today.

**What needs to replace it**: a new workflow (or an extended version of this one) with jobs that at minimum: `cd frontend && npm ci && npx tsc -b && npx vite build && npx vitest run`, and `cd backend && pip install -r requirements.txt && python manage.py check && python manage.py test`, plus `docker compose -f docker-compose.backend.yml config` validation. Until that exists, **merging to `main` currently has no automated safety net for the application you're about to keep.**

**Classification: REPLACE THEN DELETE** (or replace in place — either way, do not simply delete).

## 5. AGENTS.md / CLAUDE.md Review

- **`AGENTS.md`** (9 lines): *"This is NOT the Next.js you know... This version has breaking changes... Read the relevant guide in `node_modules/next/dist/docs/`... This block is written and re-added by `next dev`..."* — this is a **tooling-generated artifact**, auto-written by `next dev` itself (confirmed by its own text), not user-authored project guidance. It contains zero information about the Django/React stack.
- **`CLAUDE.md`** (1 line): `@AGENTS.md` — a pure include directive.

Together these form the **repo-wide** Claude Code instruction file (loaded for every session in this repo, including work on `backend/`/`frontend/`), currently containing only Next.js-tooling boilerplate.

**Recommendation: UPDATE (both).** Not delete outright — an empty/missing `CLAUDE.md` just means no repo-wide guidance at all, which is a missed opportunity now that there's a real, more complex two-stack repo to orient a future session in. Replace `AGENTS.md`'s content with actual current-stack guidance (where `backend/`/`frontend/` live, how to run the dev stack, testing commands) and keep `CLAUDE.md`'s `@AGENTS.md` include as-is.

## 6. Documentation Review

- **`README.md`** (234 lines): 100% Next.js instructions — `npm install`, `.env.example`, `localhost:3000`, `docker-compose.yml`, `scripts/bootstrap-admin.ts`, `tests/e2e/`. Exactly one paragraph (lines 3–6) points to `DEPLOYMENT.backend.md` for the current stack; zero actual current-stack content otherwise.
- **`DEPLOYMENT.md`** (289 lines): 100% Next.js deployment guide — its own "Backups and disaster recovery" section documents `backup/restore.sh` directly (see Section 2–4 above), Sentry-for-Next.js setup, `docker-compose.prod.yml`.

Every instruction in both files is outdated *for the goal of running only the current architecture* — not incorrect for the Next.js app itself, but the repo root currently has no README describing the application you're keeping.

**Recommendation: REPLACE (both).** Write a new root `README.md` that documents the Django+React stack (currently only `DEPLOYMENT.backend.md` does, and it's not the file a new contributor opens first), then delete the Next.js-specific versions.

## 7. Fix the 2 Failing Tests

**Root cause reconfirmed**: both `dashboard.tests.test_hr_dashboard.HrDashboardTest.test_on_leave_today_includes_only_approved_spanning_today` and `test_department_stats_employee_count_and_on_leave_today` call `apply_leave_request(..., start_date=self.today, end_date=self.today, ...)` — applying for a *single day of leave on the literal current date* is the entire point of both tests (verifying the "on leave today" dashboard widget). On a day the default working-days setting excludes (Sat/Sun), the application **correctly** rejects a zero-working-day request — this is intended business logic, not a bug, and changing it to "fix" the test would be exactly the kind of behavior-weakening the task instructions prohibited.

**Fix applied** (test files only, `backend/dashboard/tests/test_hr_dashboard.py`): added the identical guard already established in `leave_requests/tests/test_apply.py::test_start_date_today_is_allowed` —

```python
if self.today.weekday() >= 5:
    self.skipTest("today is a weekend in this test run")
```

placed at the top of each of the two tests, before any leave application. No production code, no leave rules, no application behavior was changed.

**Result after the fix** — full suite re-run:

```
Ran 509 tests in 77.844s
OK (skipped=3)
```

3 skips, all identical and legitimate: the same weekend guard now covers all three "applies for leave today" tests (`test_start_date_today_is_allowed`, and the two just fixed). **0 failures, 0 errors.**

**Important precision, per the "do not invent results" instruction**: the target stated was "509/509 passing." What was actually achieved today (Sunday 2026-08-16) is **506 passed / 3 skipped / 0 failed / 0 errors** — not literally 509 green passes, because 3 tests correctly decline to run on a non-working day by design. The suite is now **deterministic**: it will show **509/509 passed, 0 skipped** on any weekday run, and will never again spuriously fail on a weekend. I'm reporting the exact number rather than rounding up to the stated target.

## 8. Final Application Validation

| Check | Command | Result |
|---|---|---|
| TypeScript | `npx tsc -b` (frontend) | **PASS** — 0 errors |
| Build | `npx vite build` (frontend) | **PASS** — built in 9.45s |
| Lint | — | **NOT CONFIGURED** — `frontend/package.json` has no `lint` script (unchanged from the prior audit; not invented here per "do not introduce new tools") |
| Frontend tests | `npx vitest run` | **PASS** — 52/52 |
| Backend tests | `python manage.py test` (post-fix) | **506 passed, 3 skipped, 0 failed, 0 errors — OK** |

## 9. Docker Verification — this repo only, unrelated project excluded

Confirmed via `docker compose -f docker-compose.backend.yml ps` and `docker compose config`'s `name:` field — Compose project name **`leave-django-dev`**:

| Service | Container | Host port | Container port | Status |
|---|---|---|---|---|
| Frontend | `leave-django-dev-frontend-1` | **5180** | 5173 | Up, responds HTTP 200 |
| Backend | `leave-django-dev-backend-1` | **8012** | 8000 | Up, healthy, `/api/health/` → 200 |
| PostgreSQL | `leave-django-dev-backend-db-1` | 5435 | 5432 | Up, healthy |
| Mailpit | `leave-django-dev-mailpit-1` | 8026/1026 | 8025/1025 | Up, healthy |

**Explicitly not this repo**: `leave-management-system-{frontend,backend,db}-1` (project `leave-management-system`, at `/Users/sthuthi/Downloads/leave-management-system/`, on ports 5173/8000) — a separate, unrelated codebase, reconfirmed not touched or referenced anywhere in this review.

**The current repository's application starts successfully and serves traffic correctly on its actual configured ports.**

---

## 10. Final Cleanup Candidate List

| Path | Classification | Reason | References | Replacement Needed | Confidence |
|---|---|---|---|---|---|
| `src/` (157 files) | SAFE TO DELETE | Entire Next.js App Router implementation | Zero references from `backend/`/`frontend/`, either direction | `frontend/` + `backend/` (already exist) | High |
| `drizzle/`, `drizzle.config.ts` | SAFE TO DELETE | Next.js's own ORM/migrations | Only `src/lib/db/*` | Django models/migrations (already exist) | High |
| `tests/`, `playwright.config.ts`, `vitest.config.mts` | SAFE TO DELETE | Next.js's own test suites, exercise `src/app/api/*` directly | Only root `package.json` scripts | `backend/*/tests/`, `frontend/src/**/*.test.tsx` (already exist) | High |
| `scripts/bootstrap-admin.ts` | SAFE TO DELETE | Next.js-specific bootstrap script | Only root `package.json`'s `bootstrap-admin` script | `backend/accounts/management/commands/bootstrap_admin.py` (already exists) | High |
| `vendor/xlsx-0.20.3.tgz` (root) | SAFE TO DELETE | Next.js's own vendored copy | Only root `package.json` | `frontend/vendor/xlsx-0.20.3.tgz` (separate copy, already in place) | High |
| `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml`, `Caddyfile` (root) | SAFE TO DELETE | Next.js Docker stack | Only each other / manual invocation | `backend/Dockerfile`, `frontend/Dockerfile`, `docker-compose.backend*.yml`, `Caddyfile.backend` (already exist) | High |
| `next.config.ts`, `next-env.d.ts`, `components.json`, `eslint.config.mjs`, `postcss.config.mjs`, `sentry.server.config.ts`, `src/instrumentation.ts` | SAFE TO DELETE | Next.js/shadcn/Sentry-for-Next.js build config | Next.js build only | N/A | High |
| `tsconfig.json`, `tsconfig.tsbuildinfo` (root) | SAFE TO DELETE | Next.js TS config + build cache | Next.js build only | `frontend/tsconfig.json` (already exists) | High |
| `package.json`, `package-lock.json` (root) | SAFE TO DELETE | Next.js dependency tree | `npm` commands, old CI | `frontend/package.json`, `backend/requirements.txt` (already exist) | High |
| `.env`, `.env.example`, `.env.production.example` (root) | SAFE TO DELETE | Next.js env templates | Next.js runtime only | `.env.backend*` (already exist) | High |
| `node_modules/` (root, 910MB), `.next/` (225MB) | SAFE TO DELETE | Generated/gitignored build artifacts | N/A | N/A | High |
| `public/` | MANUAL REVIEW | Next.js static assets — but contains `agrileaf-logo.png`, the only asset that might be intentionally reusable rather than pure boilerplate | Only `src/app/layout.tsx` etc. | Copy the logo into `frontend/` first if it should carry forward | Medium |
| `backup/backup.sh`, `restore.sh`, `crontab`, `test-restore.sh` | REPLACE THEN DELETE | Hardcoded to old stack (`db` host, `leaflow` credentials, `docker-compose.prod.yml`, `app` service, old table names) — proven unusable against the new stack as-is; new stack has **no** backup mechanism yet (confirmed via `docker-compose.backend.prod.yml` + `DEPLOYMENT.backend.md` §12's own admission) | `crontab` references `docker-compose.prod.yml`; docs reference all four | A `backend-db`-targeted equivalent, not yet built | High |
| `.github/workflows/ci.yml` | REPLACE THEN DELETE | Zero backend/frontend awareness (confirmed via fresh full-file grep); deleting outright leaves the repo with **no CI at all** | GitHub Actions | A `backend/`+`frontend/`-scoped workflow, not yet built | High |
| `AGENTS.md`, `CLAUDE.md` | REPLACE THEN DELETE | Repo-wide Claude Code instruction file, currently `next dev`-generated Next.js-tooling boilerplate with zero current-stack guidance | Claude Code session loading (repo-wide) | Current-stack-appropriate content, not yet written | High |
| `README.md`, `DEPLOYMENT.md` | REPLACE THEN DELETE | Root README/deployment guide, 100% Next.js instructions; deleting outright leaves the repo root with no top-level README | Human readers, other docs' cross-links | A `backend/`+`frontend/`-scoped README, not yet written (`DEPLOYMENT.backend.md` already exists as the deployment half) | High |
| `.DS_Store` (root) | SAFE TO DELETE | macOS Finder artifact, not part of any app | None | N/A | High |
| `backend/`, `frontend/`, `docker-compose.backend.yml`, `docker-compose.backend.prod.yml`, `Caddyfile.backend`, `frontend/nginx.conf`, `frontend/nginx-proxy-params.conf`, `DEPLOYMENT.backend.md`, `.env.backend*` (all four), `.dockerignore` | KEEP | The current application and its required configuration | Actively running, actively serving traffic (verified Section 9) | N/A | High |

**Proof for every SAFE TO DELETE row above**: each was checked for references from `backend/`, `frontend/`, Docker Compose files for the current stack, and current-stack documentation — none found in any of those directions. The only references any of them have are to *each other* (internal to the old stack) or to old-stack-only tooling (root `package.json` scripts, the old CI workflow).

## 11. Cleanup Readiness

Checking against every stated condition:

| Condition | Met? |
|---|---|
| Migration is complete | ✅ Yes (Section 1, reconfirmed) |
| Current application works | ✅ Yes (Section 9) |
| Frontend build passes | ✅ Yes (Section 8) |
| TypeScript passes | ✅ Yes (Section 8) |
| Lint passes where configured | N/A — not configured, not a failure |
| Backend tests pass | ✅ Yes — 0 failures, 0 errors (Section 7–8) |
| Docker works | ✅ Yes (Section 9) |
| No required legacy code remains needed by the current app | ✅ Yes — zero cross-references found in either direction |
| **Documentation/manual-review items resolved** | ❌ **No** — `backup/*.sh`, `.github/workflows/ci.yml`, `AGENTS.md`/`CLAUDE.md`, `README.md`/`DEPLOYMENT.md` are all classified **REPLACE THEN DELETE**, and none has been replaced yet. `public/agrileaf-logo.png` still needs a decision. |
| No database/data changes required | ✅ Yes — none were needed or made |

# NOT READY FOR CLEANUP

Every condition is met **except one, explicitly required by your own readiness bar**: the manual-review items have not been resolved — they've been classified and proven, but not replaced. The `SAFE TO DELETE` rows (the bulk of the old `src/`/`drizzle/`/`tests/`/Docker/config tree) could be deleted today with no functional risk to the current application. But five items (`backup/*`, CI, `AGENTS.md`/`CLAUDE.md`, `README.md`/`DEPLOYMENT.md`) would leave the *kept* application worse off than it is right now if deleted as-is — no backup tooling, no CI, no repo-wide agent guidance, no root README — even though none of them represent a migration gap.

**What must happen before this becomes READY FOR CLEANUP:**
1. Decide on and build a `backend-db`-targeted backup/restore mechanism (or explicitly accept the gap and document that decision).
2. Write a `backend/`+`frontend/`-scoped CI workflow to replace `.github/workflows/ci.yml`.
3. Write current-stack content for `AGENTS.md` (or accept an empty/minimal one).
4. Write a new root `README.md` describing the Django+React stack.
5. Decide whether `public/agrileaf-logo.png` should be copied into `frontend/` first.

None of these require touching the application itself — they're all new content to write, not application changes. Once they exist, the `SAFE TO DELETE` list can be executed with the same confidence already established here.
