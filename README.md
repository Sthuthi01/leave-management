This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## First-time local setup

The fastest way to get a working app with your own HR Admin account (not the shared demo password) after cloning this repo:

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Configure `.env`**
   ```bash
   cp .env.example .env
   ```
   Defaults work out of the box, except one: open `.env` and set `SEED_DEMO_DATA=false`. Leaving
   it unset seeds a full set of demo employees (including an admin account with a shared,
   publicly-documented password) — fine for quickly poking around the UI, but not what you want
   if you're about to create your own real HR Admin below.

3. **Start Docker** (app, Postgres, and [Mailpit](https://mailpit.axllent.org/) — a fake SMTP
   server that catches every email the app sends, viewable in a browser)
   ```bash
   docker compose up --build -d
   ```

4. **Database migrations**
   Nothing to run by hand — migrations apply automatically the moment the app handles its first
   request. Confirm the stack is healthy:
   ```bash
   docker compose ps   # `app` should show "healthy" within a few seconds
   ```

5. **Create the first HR Admin**
   ```bash
   npm run bootstrap-admin -- --name "Your Name" --email "you@example.com"
   ```
   (Omit the flags to be prompted interactively instead.) This only works once — it refuses to
   run if an HR Admin already exists, or if `NODE_ENV=production` is set — and it's a plain local
   script, not a page or API route, so it has no effect on UAT or production. See
   `scripts/bootstrap-admin.ts` for details.

6. **Access the application**
   Open [http://localhost:3000](http://localhost:3000).

7. **Set the HR Admin password**
   Open Mailpit at [http://localhost:8025](http://localhost:8025), find the "You're invited to
   Agrileaf" email, and click the link to choose a password. You're signed in automatically once
   it's set — no separate login step.

8. **Verify login**
   You should already be on the dashboard. To double-check later, go to
   [http://localhost:3000/login](http://localhost:3000/login) and sign in with that email/password.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Docker

The app ships with a multi-stage `Dockerfile` built around Next.js's `output: "standalone"` mode, so the image only contains what's needed to run the server — not the full `node_modules` or source tree.

### Local development

```bash
cp .env.example .env   # fill in values if you want, defaults work out of the box
docker compose up --build
```

This starts three containers: `app` on [http://localhost:3000](http://localhost:3000), a Postgres `db` (data persisted in a named volume, exposed on host port `5433`), and [Mailpit](https://mailpit.axllent.org/) — a fake SMTP server that catches every invitation/password-reset email the app sends, viewable at [http://localhost:8025](http://localhost:8025), so nothing gets sent to a real inbox while testing.

A container health check hits `/api/health`; `docker compose ps` will show `app` as `healthy` once the server is accepting requests.

### Production

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for the full guide — required environment variables, configuring a real SMTP provider (SendGrid, SES, Postmark, Mailgun, etc.), using a managed database instead of a bundled one, and secrets management. Quick version:

```bash
cp .env.production.example .env
# fill in every value — docker-compose.prod.yml refuses to start if any required one is missing
docker compose -f docker-compose.prod.yml up -d --build
```

## Creating the first HR Admin

There's no in-app page, API route, or environment variable that creates the first HR Admin —
every employee-creation path (`POST /api/employees`) requires an already-authenticated `ADMIN`,
which a brand-new database doesn't have. The method differs by environment:

### Local development

Use the `bootstrap-admin` script — see [First-time local setup](#first-time-local-setup) above,
step 5. This script exists only in your git checkout: the Docker image (dev and prod both build
the same minimal image) never contains `scripts/`, `src/`, or the dev tooling needed to run it, so
**it cannot be used in UAT or production** — the procedure there is different, below.

### UAT / Test

No automated command exists for this environment. The supported procedure is a one-time,
controlled database step, using the app's existing invitation mechanism — you insert the
*employee row*, never a password.

**Prerequisites:** the UAT app + Postgres containers already running (typically via
`docker-compose.prod.yml`), shell/Docker access to the UAT host, a real reachable email address
for the new admin, and real SMTP already configured in UAT's `.env` (see
[DEPLOYMENT.md](./DEPLOYMENT.md#configuring-a-real-email-provider)). Do not set `SEED_DEMO_DATA`
in UAT.

1. Open a SQL shell on the UAT database:
   ```bash
   docker compose -f docker-compose.prod.yml exec db psql -U leaflow -d leaflow
   ```
2. Insert a department and the admin (replace only the name/email/title — never a password):
   ```sql
   INSERT INTO departments (id, name)
   VALUES ('dept-hr', 'HR');

   INSERT INTO employees (id, name, email, role, title, department_id, joined_at, status)
   VALUES (
     'emp-hr-admin-001',
     'Full Name Here',
     'admin@yourcompany.com',
     'ADMIN',
     'HR Administrator',
     'dept-hr',
     CURRENT_DATE,
     'ACTIVE'
   );
   ```
   `password_hash` is deliberately never mentioned, so it stays `NULL` — that's what tells the app
   this person needs a real invite. Then `\q` to exit.
3. Restart the app so its one-time startup check re-runs against the new row (it only fires once
   per container lifetime):
   ```bash
   docker compose -f docker-compose.prod.yml restart app
   ```
4. Trigger it: open the UAT login page and attempt to log in with any placeholder credentials
   (expected to fail). Even a failed login queries the database and wakes up the check that emails
   the new admin their real invite, within moments.

**Invitation email:** sent automatically by the app's existing `inviteEmployeesMissingPassword`
function — the same code path and template as any other employee invite.

**Password setup:** the admin opens the email, clicks the link, and chooses a password on the real
"Set up your account" page — identical mechanism to local dev, just a real inbox instead of Mailpit.

**Verify the account:**
```sql
SELECT id, name, email, role, status, (password_hash IS NOT NULL) AS has_password
FROM employees WHERE email = 'admin@yourcompany.com';
```
`has_password` is `f` before they set a password, `t` after.

**Verify HR Admin permissions:** have them log in on the UAT site and confirm the
**Administration** nav section appears — that section is gated to `role = 'ADMIN'` only, so seeing
it proves the role is correct, not just that the password worked.

### Production

Identical mechanism and commands to UAT above (substitute your production
`docker compose -f docker-compose.prod.yml` invocation and connection details) — there is no
separate production-only tool. What differs is the care around doing it:

- Treat this as a deliberate, approved one-time change, not routine.
- Confirm a recent, verified backup exists first (see
  [DEPLOYMENT.md](./DEPLOYMENT.md#backups-and-disaster-recovery)).
- Before running the `INSERT`, confirm you're connected to the right database:
  `SELECT current_database();`
- Restart only the `app` service (`restart app`), never the database.
- Don't leave the `psql` session open or the connection string pasted anywhere persistent once done.
- If the invite email doesn't arrive, troubleshoot SMTP (`docker compose -f docker-compose.prod.yml logs app`)
  and re-trigger step 4 — never hand-compute and insert a `password_hash` as a workaround, since
  that reintroduces exactly the "known/assigned password" risk this design avoids.

### Summary

| Environment | First Admin Creation Method | Command/Action | Password Setup | Verification |
|---|---|---|---|---|
| **Local** | `bootstrap-admin` script (git checkout only) | `npm run bootstrap-admin -- --name "..." --email "..."` | Click link in Mailpit (`localhost:8025`) → choose password → auto signed-in | Log in at `localhost:3000/login`; confirm **Administration** nav appears |
| **UAT** | Manual `INSERT` (department + employee, `password_hash` left `NULL`) via `psql`, then restart `app` | `docker compose -f docker-compose.prod.yml exec db psql ...` → run `INSERT` → `docker compose -f docker-compose.prod.yml restart app` → attempt any login | Click link in real invitation email → choose password → auto signed-in | `password_hash IS NOT NULL` in DB, plus **Administration** nav appears after login |
| **Production** | Same manual `INSERT` + restart procedure as UAT, with change-control care (verify DB, backup first, restrict access) | Same as UAT, run against production, with `SELECT current_database();` confirmed first | Same as UAT — real email, real chosen password | Same as UAT, plus confirm follow-on actions appear correctly in the audit log |

## Testing

```bash
npm test            # unit tests (vitest) — pure logic + mocked-auth RBAC checks, no DB/server needed
npm run test:watch  # same, in watch mode
npm run test:e2e    # end-to-end (Playwright) — needs the local dev stack running first:
                     #   docker compose up -d
```

The E2E suite (`tests/e2e/`) drives a real browser against the running `docker-compose.yml` stack and reads generated invitation/reset emails straight out of Mailpit's API — it covers login/logout, invitation → set password → auto sign-in, forgot/reset password, change password, leave application → approval/rejection, and role-based access (an Employee or Manager hitting an HR-Admin-only page or API directly gets blocked). It shares whatever database state the stack currently has — each test creates its own throwaway employee(s) rather than relying on or resetting existing data, so it's safe to run against your everyday local dev database.

**A note on rate limiting during repeated CI/local runs:** `POST /api/auth/set-password` is rate-limited to 10 requests per 15-minute window (see `src/lib/rate-limit.ts`), keyed by client IP. Each full E2E run submits 5 such requests (invitation activation, password reset, change-password setup flows). Behind a real reverse proxy each caller gets a distinct IP-based bucket, so a normal user never comes close to this limit — but the local `docker-compose.yml` stack has no reverse proxy, so every request in that environment falls back to one shared bucket (see the `getClientIp` comment in `src/lib/rate-limit.ts` for why). Running the suite more than twice within the same 15-minute window — e.g. while iterating on a test locally, or a CI job that reruns the suite — can exhaust that shared bucket and cause later, entirely legitimate set-password submissions to receive a real `429`. This is the rate limiter working as designed, not test flakiness. If you hit it:
- Restart the `app` container (`docker compose restart app`) — its rate-limit state is in-memory only, so this clears it instantly without touching the database or any other state, or
- Wait for the 15-minute window to elapse.

Do not raise this limit or special-case test traffic to work around it — it's a deliberate anti-abuse control and applies identically in UAT and production.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
