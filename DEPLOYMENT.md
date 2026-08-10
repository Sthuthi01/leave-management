# Deployment guide

This app has two separate Docker Compose configurations:

| | Local development | Production |
|---|---|---|
| File | `docker-compose.yml` | `docker-compose.prod.yml` |
| Env template | `.env.example` | `.env.production.example` |
| Email | [Mailpit](https://mailpit.axllent.org/) — catches every email locally, nothing leaves your machine | Real SMTP provider (SendGrid, SES, Postmark, Mailgun, etc.) |
| Missing secrets | Falls back to insecure defaults with a startup warning, so it still runs | Refuses to start with a clear error — see [Required environment variables](#required-environment-variables) |
| Database port | Published to the host (`5433`) for local tooling | Not published — reachable only from the `app` container |

They're intentionally kept as two separate files rather than one file with an override, so production's fail-fast behavior can't accidentally be loosened by a merge, and so there's no risk of a production deploy accidentally picking up Mailpit.

## Prerequisites

- Docker and Docker Compose v2
- A domain name pointed at the machine/load balancer you're deploying to (needed for `APP_URL` and for a real SMTP sender to be credible)
- Either:
  - A Postgres database you already manage (RDS, Cloud SQL, Neon, Supabase, etc.), **or**
  - Nothing extra — `docker-compose.prod.yml` includes a self-managed Postgres container, good enough for a single-VM deployment
- SMTP credentials from an email provider (see [Configuring a real email provider](#configuring-a-real-email-provider)) — optional for an initial smoke-test deploy, required before real users need invitation/reset emails

## Quick start

```bash
cp .env.production.example .env
# edit .env — fill in every value described below
docker compose -f docker-compose.prod.yml up -d --build
```

`docker compose -f docker-compose.prod.yml ... ` picks up `.env` from the current directory automatically (this is standard Compose behavior, not something specific to this file) — you don't need to pass `--env-file` explicitly as long as it's named `.env` and sits next to `docker-compose.prod.yml`.

Watch it come up:

```bash
docker compose -f docker-compose.prod.yml logs -f app
```

`docker compose -f docker-compose.prod.yml ps` should show `app` as `healthy` once `/api/health` starts responding (see [Health checks](#health-checks)).

## Required environment variables

Set these in `.env` before starting — `docker-compose.prod.yml` will refuse to start and print exactly which one is missing if you skip any of them. None of them have insecure defaults in production (contrast with local dev, where most of these fall back to something that still runs, with a warning).

| Variable | Purpose |
|---|---|
| `SESSION_SECRET` | HMAC-signs the session cookie. Generate with `openssl rand -hex 32`. A forgeable session cookie is a full auth bypass — never reuse the local-dev value. |
| `DATABASE_URL` | Postgres connection string. Point it at the bundled `db` service (`postgres://leaflow:<POSTGRES_PASSWORD>@db:5432/leaflow`) or at your managed database. |
| `APP_URL` | Your real public URL (e.g. `https://leave.yourcompany.com`), no trailing slash. Baked into every invitation/reset-link email — wrong value here means broken links for real users. |
| `APP_DOMAIN` | The bare domain from `APP_URL` with no `https://` (e.g. `leave.yourcompany.com`). Used by the `caddy` service to get its HTTPS certificate — see [TLS / reverse proxy](#tls--reverse-proxy). |
| `EMAIL_FROM` | Sender address for invitation/reset emails. Must be a verified sender/domain with your SMTP provider or it'll be rejected or spam-filtered. |
| `POSTGRES_PASSWORD` | Only required if you keep the bundled `db` service. Must match the password embedded in `DATABASE_URL`. Not needed if you deleted that service to use a managed database. |

## Optional environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SMTP_HOST` | *(unset)* | Your SMTP provider's host. If left unset, invitation/reset emails are printed to the `app` container's logs instead of delivered — see [Configuring a real email provider](#configuring-a-real-email-provider) before relying on real users receiving them. |
| `SMTP_PORT` | `587` | SMTP port. `587` (STARTTLS) is standard for most providers. |
| `SMTP_SECURE` | `false` | Set to `true` only if using port `465` (implicit TLS). Leave `false` for `587`/`25` (STARTTLS is negotiated automatically). |
| `SMTP_USER` / `SMTP_PASS` | *(unset)* | Credentials for the SMTP host above. |
| `SENTRY_DSN` | *(unset)* | Sends backend errors to Sentry. See [Error tracking and uptime monitoring](#error-tracking-and-uptime-monitoring). Nothing is sent anywhere if this is left blank. |
| `BACKUP_RETENTION_DAYS` | `30` | How many days of automated database backups to keep. See [Backups and disaster recovery](#backups-and-disaster-recovery). |

## Configuring a real email provider

The email code (`src/lib/email.ts`) is provider-agnostic SMTP via `nodemailer` — the same code path used for local Mailpit testing. Switching providers is purely environment variables, no code changes. Example values (get real credentials from each provider's dashboard):

| Provider | `SMTP_HOST` | `SMTP_PORT` | Notes |
|---|---|---|---|
| SendGrid | `smtp.sendgrid.net` | `587` | `SMTP_USER=apikey`, `SMTP_PASS=<your API key>` |
| AWS SES | `email-smtp.<region>.amazonaws.com` | `587` | Use SES-specific SMTP credentials, not your AWS access keys |
| Postmark | `smtp.postmarkapp.com` | `587` | `SMTP_USER`/`SMTP_PASS` are both your Postmark server token |
| Mailgun | `smtp.mailgun.org` | `587` | Use the SMTP credentials from your domain's settings, not your API key |

Whichever provider you use, make sure `EMAIL_FROM`'s domain is verified with it (SPF/DKIM configured) — unverified senders are commonly rejected outright or delivered straight to spam.

## Using a managed database instead of the bundled one

The bundled `db` service in `docker-compose.prod.yml` is a plain `postgres:16-alpine` container with a named volume. Automated backups are already configured for it — see [Backups and disaster recovery](#backups-and-disaster-recovery) below. If you'd rather use a managed database instead of the bundled one, your provider (RDS, Cloud SQL, Neon, Supabase, etc.) handles its own backups — check their docs, and the `backup` service described below won't apply to you:

1. Delete the `db` service block from `docker-compose.prod.yml`, and the `depends_on: db` entry under `app`.
2. Set `DATABASE_URL` in `.env` to your managed database's connection string.
3. Don't set `POSTGRES_PASSWORD` — it's unused once the bundled service is gone.

Migrations run automatically on startup either way (`ensureReady()` in `src/lib/db/client.ts`), so there's no separate migration step to run by hand.

Most managed Postgres providers (RDS, Cloud SQL, Neon, Supabase, etc.) require or strongly recommend an encrypted connection — add `?sslmode=require` to the end of `DATABASE_URL` (check your provider's docs for their exact recommended value; some need `verify-full` with a CA certificate instead). The bundled `db` service above doesn't need this — traffic to it never leaves the Compose-internal network.

Demo/mock data (`src/lib/mock-data/seed.ts`) is never seeded here regardless of database state — that only happens when `SEED_DEMO_DATA=true` is explicitly set, which `docker-compose.prod.yml` deliberately never sets (only `docker-compose.yml`, for local development, does). A fresh production database starts genuinely empty — there's no self-registration, so your very first HR Admin has to be created directly in the database with a `password_hash` of `null` (matching how a normal invited-but-not-yet-activated employee looks); the app's own self-healing startup check (`inviteEmployeesMissingPassword()` in `src/lib/invitation-service.ts`) will then automatically email them a real invitation link to set their password through the normal flow. Every account after that is created normally, through the app's own "Add employee" flow.

## Backups and disaster recovery

*This section assumes no database experience — every command here is meant to be copied and pasted exactly as shown.*

**This only applies if you're using the bundled `db` service** (the default). If you switched to a managed database provider (RDS, Cloud SQL, Neon, Supabase, etc.), they handle their own backups — check their dashboard instead.

### What happens automatically

A second container called `backup` runs alongside `app` and `db`. Every day at 2:00 AM it takes a complete backup of the database and stores it separately from the live database, and it automatically deletes backups older than 30 days so disk space doesn't grow forever. It also takes one backup immediately the very first time it starts, so you have a safety net from day one rather than waiting a full day for the first one.

You don't need to do anything for this to work — it starts automatically the same way `app` and `db` do.

### Checking that backups are actually happening

Run this any time you want to check:

```bash
docker compose -f docker-compose.prod.yml exec backup ls -lh /backups
```

You should see a list of files named like `leaflow_2026-08-08_02-00-00.dump`, one per day, each a few hundred kilobytes to a few megabytes depending on how much data you have. If that list is empty or the dates look stale, something is wrong — see [Getting help](#getting-help-with-backups) below.

There's also a simpler, at-a-glance check: run `docker compose -f docker-compose.prod.yml ps`. As long as `backup` shows `healthy` (the same way `app` and `db` do), backups are working. It will show `unhealthy` if no backup has been taken in the last 2 days, which should never happen under normal operation.

### Restoring a backup (disaster recovery)

**Only do this if you actually need to recover from lost or corrupted data.** Restoring replaces everything currently in the database with an older backup — anything added or changed since that backup was taken will be lost.

```bash
# 1. See what backups you have and pick one:
docker compose -f docker-compose.prod.yml exec backup ls -lh /backups

# 2. Run the restore script with that filename:
./backup/restore.sh leaflow_2026-08-08_02-00-00.dump
```

The script will show you exactly what it's about to do, and it will not proceed unless you type `RESTORE` to confirm. It briefly stops the app while it restores, then starts it back up automatically.

### Testing that a backup actually works — do this periodically

An untested backup is not a backup you can rely on. This command proves a backup file can genuinely be restored, **without touching your real production data in any way** — it builds a brand-new, temporary, throwaway database, restores the backup into that instead, checks the result looks right, and then deletes the temporary copy:

```bash
./backup/test-restore.sh leaflow_2026-08-08_02-00-00.dump
```

You'll see `PASS` with some numbers (how many employees/departments were found in that backup) if everything worked. We recommend running this once a month, and always after any major update to the app.

### Two things worth knowing

- **Backups live on the same machine as the database**, just in a separate storage area. This protects you against accidental data deletion, a bad update, or the database container itself breaking — but it would **not** protect you if the entire machine were lost (hardware failure, the server being deleted, etc.). For real peace of mind, periodically copy the contents of the backup folder to a second location — a cloud storage bucket, another server, anywhere physically separate from this machine. This isn't set up automatically today because it requires a cloud storage account we don't have credentials for; if you'd like this added, provide the storage details (e.g. an S3 bucket and access keys) and it can be wired in.
- **30 days of history is kept by default.** If you'd like more or less, set `BACKUP_RETENTION_DAYS` in your `.env` file (e.g. `BACKUP_RETENTION_DAYS=60`) and restart the backup service with `docker compose -f docker-compose.prod.yml up -d backup`.

### Getting help with backups

If `docker compose -f docker-compose.prod.yml exec backup ls -lh /backups` shows no files, or `docker compose -f docker-compose.prod.yml ps` shows `backup` as unhealthy, run this and share the output with whoever supports this deployment for you:

```bash
docker compose -f docker-compose.prod.yml logs backup
```

## Security features

A few things worth knowing as an operator, all covered by the audit fixes this app has been through:

- **Rate limiting** on login, forgot-password, and set-password is in-memory and per-instance — fine for the single-container deployment this file describes, but each replica would enforce its own independent limit if you ever scale `app` horizontally. Login only counts *failed* attempts (never successful ones), so this can't lock out a legitimate frequently-logging-in user.
- Rate-limit and audit-log IP attribution both read `X-Forwarded-For`, which is a client-supplied header the app has no way to verify on its own. **You must deploy this app behind a reverse proxy or load balancer that overwrites `X-Forwarded-For` with the real client IP** (Caddy, nginx, Traefik, and every major cloud load balancer do this by default). If you instead expose `app` directly to the internet, any caller can set their own `X-Forwarded-For` value on each request to land in a fresh rate-limit bucket every time — a full bypass of login/forgot-password/set-password rate limiting — and audit-log IPs become spoofable too.
- Session cookies are marked `Secure` automatically (via `NODE_ENV=production`, already set in the Docker image), so they're never sent over a plain HTTP connection — another reason TLS termination in front of `app` isn't optional.
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy) are sent on every response — see `next.config.ts` if you need to adjust the CSP for something you've added (e.g. a new third-party script or font host).

## Health checks

There are two health-check endpoints, both unauthenticated on purpose, that answer two different questions:

| Endpoint | Answers | Used by |
|---|---|---|
| `GET /api/health` | "Is the app process running at all?" | The Dockerfile's own `HEALTHCHECK` and `docker compose ps`. Deliberately doesn't check the database, so a brief database hiccup doesn't cause Docker to restart a container that isn't actually broken. |
| `GET /api/health/deep` | "Can the app actually reach the database?" | Your external uptime monitor — see [Error tracking and uptime monitoring](#error-tracking-and-uptime-monitoring). This is the one that should page a human, since "the process is up but the database is unreachable" is a real outage even though the first check would still say "ok". |

Both return `{"status":"ok"}` (with `/api/health/deep` including a `checks` breakdown) when healthy, and `docker compose -f docker-compose.prod.yml ps` shows `app` as `healthy` once `/api/health` starts succeeding.

## Error tracking and uptime monitoring

*Also written assuming no prior experience with either tool — every step below is something you do by clicking around each service's own website, not something you need to code.*

Two free external services cover this, and neither requires touching this app's code beyond setting one line in `.env` each:

1. **[Sentry](https://sentry.io)** — tells you the moment a real bug happens in the backend (a crash, a database error, anything unexpected), with enough detail to fix it, instead of you finding out because a customer complained.
2. **[UptimeRobot](https://uptimerobot.com)** — checks every few minutes whether your site is actually reachable from the outside world, and alerts you the moment it isn't (the server crashed, the database is unreachable, the host is down, etc.).

Together these cover "a bug happened" and "the site is down" — the two things you most need to know about immediately for a small SaaS product.

### 1. Set up Sentry (error tracking)

1. Go to [sentry.io](https://sentry.io) and create a free account (the free tier — 5,000 errors/month at the time of writing — is more than enough to start).
2. Create a new project, choosing **Next.js** as the platform.
3. Sentry will show you a **DSN** — a URL that looks like `https://abc123@o000000.ingest.sentry.io/000000`. Copy it.
4. Paste it into your `.env` file on the server:
   ```
   SENTRY_DSN=https://abc123@o000000.ingest.sentry.io/000000
   ```
5. Restart the app to pick it up:
   ```bash
   docker compose -f docker-compose.prod.yml up -d app
   ```

That's it — from then on, unexpected backend errors show up in your Sentry dashboard, and you can turn on email/Slack/SMS alerts for new issues under Sentry's own **Alerts** settings (Sentry's default "alert on every new issue" rule is a good starting point — you can tune it later).

If `SENTRY_DSN` is left blank, nothing changes about how the app runs — it simply doesn't send anything anywhere. Local development is never configured to use this, so nothing from your own testing is ever sent to Sentry either.

### 2. Set up UptimeRobot (availability monitoring)

1. Go to [uptimerobot.com](https://uptimerobot.com) and create a free account (the free tier covers up to 50 monitors checked every 5 minutes — one monitor is all you need here).
2. Click **Add New Monitor**.
3. Set:
   - **Monitor Type:** HTTP(s)
   - **URL:** `https://your-real-domain.example/api/health/deep` (your real public `APP_URL`, with `/api/health/deep` on the end — not `/api/health`, see the table above for why)
   - **Monitoring Interval:** 5 minutes is fine for a small product
4. Under **Alert Contacts**, add your email (and/or SMS, Slack, etc. — UptimeRobot supports quite a few) so you're notified the moment it goes down.
5. Save. UptimeRobot will start checking immediately, and you can see the uptime history and get alerts from its dashboard from now on.

### What data does and doesn't leave this server

Given this app handles employee/customer personal data, both integrations were deliberately kept minimal:

- **Sentry** is configured for error tracking only — no performance monitoring, no session replay (a Sentry feature that can record what a user did on screen, which was deliberately left off). It's told never to attach cookies, request bodies, or a user's IP address to anything it reports (see `sentry.server.config.ts`). What it *does* see is: the error message, a stack trace, and which API route/method failed — the same information already written to this server's own logs, sent to one more place so someone actually notices it.
- **UptimeRobot** only ever calls `GET /api/health/deep`, which itself never returns employee, customer, or leave data — just `{"status": "ok"}` or a generic error. UptimeRobot never sees anything else about your application.
- Neither service receives login credentials, session cookies, employee records, or leave request contents, under any circumstance.

One honest caveat: error *messages* themselves come from whatever the underlying code or database says went wrong, and in rare cases a database error message can include a literal value (e.g. "duplicate key value violates unique constraint... already exists"). The most common case of this (a duplicate employee email) is already intercepted before it's ever logged or reported anywhere (see `src/lib/api-handler.ts`). Treat Sentry issues with the same care you'd apply to your own server logs — don't paste them into a public forum without a glance first.

## Getting help with monitoring

If you're not sure whether either service is working:

```bash
# Confirm the app has SENTRY_DSN set:
docker compose -f docker-compose.prod.yml exec app printenv SENTRY_DSN

# Manually check the deep health endpoint UptimeRobot is polling:
curl -i https://your-real-domain.example/api/health/deep
```

A healthy deep check returns HTTP `200` with `{"status":"ok","checks":{"database":"ok"}}`. Anything else means the database is unreachable — check `docker compose -f docker-compose.prod.yml logs db`.

## TLS / reverse proxy

`docker-compose.prod.yml` includes a `caddy` service that handles this for you — `app` itself has no host port published at all (see the comment on `app` in that file), so it's only reachable through Caddy, never directly. This isn't optional: session cookies, the `X-Forwarded-For`-based rate limiting on login/forgot-password/set-password, and audit-log IP attribution all depend on a properly configured proxy sitting in front of the app — see [Security features](#security-features) above.

### The default: automatic HTTPS with a real public domain

If `APP_DOMAIN` (set in `.env`, alongside `APP_URL`) is a real domain name whose public DNS points at this machine, with ports `80` and `443` reachable from the internet, this is genuinely zero-config: Caddy automatically requests and renews a real HTTPS certificate from Let's Encrypt the first time it starts, and keeps it renewed indefinitely. HTTP requests are automatically redirected to HTTPS. Nothing else to do.

This is the common case even for an internal-only tool — many companies run internal apps on a real subdomain of their public domain (e.g. `leave.yourcompany.com`) and restrict *who can reach it* with a firewall or VPN, rather than by keeping the domain itself out of public DNS.

### The alternative: a pure-internal deployment with no public DNS

If this domain has no public DNS record at all (e.g. `leave.internal.corp`, resolvable only inside your network), Let's Encrypt can't complete its challenge and automatic HTTPS won't work. Use a certificate from your company's own internal CA (or a self-signed one, if your employees' devices are configured to trust it) instead:

1. Get a certificate and private key for `APP_DOMAIN` from your internal CA — `cert.pem` and `key.pem`.
2. Put them in a `certs/` folder next to `docker-compose.prod.yml`.
3. Replace the Caddyfile's site block with:
   ```
   {$APP_DOMAIN} {
   	tls /certs/cert.pem /certs/key.pem
   	reverse_proxy app:3000 {
   		header_up X-Forwarded-For {http.request.remote.host}
   	}
   	encode gzip
   }
   ```
4. Add the certs folder as a read-only mount on the `caddy` service in `docker-compose.prod.yml`:
   ```yaml
   volumes:
     - ./Caddyfile:/etc/caddy/Caddyfile:ro
     - ./certs:/certs:ro
     - caddy-data:/data
     - caddy-config:/config
   ```
5. Restart: `docker compose -f docker-compose.prod.yml up -d --force-recreate caddy`

Either way, keep `header_up X-Forwarded-For {http.request.remote.host}` in the `reverse_proxy` block — without it, Caddy's default behavior is to *append* to any `X-Forwarded-For` a client already sent rather than replace it, which would let a client prepend a fake IP ahead of the real one and land in a fresh rate-limit bucket on every request despite Caddy being in front.

## Updating a running deployment

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

This rebuilds the `app` image and recreates only the containers whose config or image actually changed (Compose diffs this automatically) — `db` and its data volume are left alone unless you explicitly change something about that service.

## Secrets management

- Never commit a filled-in `.env` — both `.env.example` and `.env.production.example` are safe (placeholders only); a real `.env` is not.
- For anything beyond a single trusted VM, prefer injecting these values via your platform's secret manager (Docker secrets, Kubernetes Secrets, your cloud provider's secret manager) rather than a plain `.env` file on disk.
- Rotate `SESSION_SECRET` if you ever suspect it's leaked — this immediately invalidates every existing session cookie (all users are signed out and must log in again), but doesn't affect stored passwords or audit history.
