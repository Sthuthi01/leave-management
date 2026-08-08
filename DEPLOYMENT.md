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
| `EMAIL_FROM` | Sender address for invitation/reset emails. Must be a verified sender/domain with your SMTP provider or it'll be rejected or spam-filtered. |
| `POSTGRES_PASSWORD` | Only required if you keep the bundled `db` service. Must match the password embedded in `DATABASE_URL`. Not needed if you deleted that service to use a managed database. |

## Optional environment variables

| Variable | Default | Purpose |
|---|---|---|
| `SMTP_HOST` | *(unset)* | Your SMTP provider's host. If left unset, invitation/reset emails are printed to the `app` container's logs instead of delivered — see [Configuring a real email provider](#configuring-a-real-email-provider) before relying on real users receiving them. |
| `SMTP_PORT` | `587` | SMTP port. `587` (STARTTLS) is standard for most providers. |
| `SMTP_SECURE` | `false` | Set to `true` only if using port `465` (implicit TLS). Leave `false` for `587`/`25` (STARTTLS is negotiated automatically). |
| `SMTP_USER` / `SMTP_PASS` | *(unset)* | Credentials for the SMTP host above. |

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

The bundled `db` service in `docker-compose.prod.yml` is a plain `postgres:16-alpine` container with a named volume — fine for a single-VM deployment, but you're responsible for backing up that volume yourself. If you'd rather use a managed database:

1. Delete the `db` service block from `docker-compose.prod.yml`, and the `depends_on: db` entry under `app`.
2. Set `DATABASE_URL` in `.env` to your managed database's connection string.
3. Don't set `POSTGRES_PASSWORD` — it's unused once the bundled service is gone.

Migrations run automatically on startup either way (`ensureReady()` in `src/lib/db/client.ts`), so there's no separate migration step to run by hand.

Most managed Postgres providers (RDS, Cloud SQL, Neon, Supabase, etc.) require or strongly recommend an encrypted connection — add `?sslmode=require` to the end of `DATABASE_URL` (check your provider's docs for their exact recommended value; some need `verify-full` with a CA certificate instead). The bundled `db` service above doesn't need this — traffic to it never leaves the Compose-internal network.

Demo/mock data (`src/lib/mock-data/seed.ts`) is never seeded here regardless of database state — that only happens when `SEED_DEMO_DATA=true` is explicitly set, which `docker-compose.prod.yml` deliberately never sets (only `docker-compose.yml`, for local development, does). A fresh production database starts genuinely empty — there's no self-registration, so your very first HR Admin has to be created directly in the database with a `password_hash` of `null` (matching how a normal invited-but-not-yet-activated employee looks); the app's own self-healing startup check (`inviteEmployeesMissingPassword()` in `src/lib/invitation-service.ts`) will then automatically email them a real invitation link to set their password through the normal flow. Every account after that is created normally, through the app's own "Add employee" flow.

## Security features

A few things worth knowing as an operator, all covered by the audit fixes this app has been through:

- **Rate limiting** on login, forgot-password, and set-password is in-memory and per-instance — fine for the single-container deployment this file describes, but each replica would enforce its own independent limit if you ever scale `app` horizontally. Login only counts *failed* attempts (never successful ones), so this can't lock out a legitimate frequently-logging-in user.
- Rate-limit and audit-log IP attribution both read `X-Forwarded-For`, which is a client-supplied header the app has no way to verify on its own. **You must deploy this app behind a reverse proxy or load balancer that overwrites `X-Forwarded-For` with the real client IP** (Caddy, nginx, Traefik, and every major cloud load balancer do this by default). If you instead expose `app` directly to the internet, any caller can set their own `X-Forwarded-For` value on each request to land in a fresh rate-limit bucket every time — a full bypass of login/forgot-password/set-password rate limiting — and audit-log IPs become spoofable too.
- Session cookies are marked `Secure` automatically (via `NODE_ENV=production`, already set in the Docker image), so they're never sent over a plain HTTP connection — another reason TLS termination in front of `app` isn't optional.
- Security headers (CSP, X-Frame-Options, X-Content-Type-Options, HSTS, Referrer-Policy) are sent on every response — see `next.config.ts` if you need to adjust the CSP for something you've added (e.g. a new third-party script or font host).

## Health checks

`GET /api/health` (`src/app/api/health/route.ts`) is unauthenticated on purpose — it's what the Dockerfile's `HEALTHCHECK`, and any load balancer or orchestrator health probe, should poll. It returns `{"status":"ok"}` once the process is up and serving requests. `docker compose -f docker-compose.prod.yml ps` shows `app` as `healthy` once this starts succeeding.

## TLS / reverse proxy

`app` serves plain HTTP on port `3000`. This file doesn't terminate TLS itself — put it behind whatever you already use for that (a reverse proxy like Caddy, nginx, or Traefik on the same host, or your cloud provider's load balancer). Point that layer's backend at `<host>:3000`, and make sure `APP_URL` reflects the public HTTPS URL your users actually hit, not the internal one.

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
