"""
Django settings for the leave-management Phase 1 backend.

This is an ADDITIVE, separate backend living in backend/ alongside the existing Next.js app —
it has its own Postgres database (backend-db, see docker-compose.backend.yml) and does not touch
the Next.js app's `db` service/data in any way.
"""

from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env()

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env.bool("DJANGO_DEBUG", default=False)
ALLOWED_HOSTS = env.list("DJANGO_ALLOWED_HOSTS", default=["localhost", "127.0.0.1"])

INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.admin",
    "rest_framework",
    "corsheaders",
    "departments",
    "accounts",
    "leave_types",
    "holidays",
    "leave_balances",
    "leave_requests",
    "dashboard",
    "audit",
    "org_settings",
    "team_calendar",
    "reports",
    "onboarding",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # Serves STATIC_ROOT directly from gunicorn — needed only for Django admin's own CSS/JS
    # (admin/ isn't reachable by normal app users: no code path grants is_staff, see nginx.conf's
    # comment on the /admin/ proxy location). Must sit immediately after SecurityMiddleware, before
    # everything else, per WhiteNoise's own placement requirement.
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    # Must come after AuthenticationMiddleware — it needs request.user to already be resolved.
    "accounts.middleware.SessionVersionMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {"default": env.db("DJANGO_DATABASE_URL")}

AUTH_USER_MODEL = "accounts.Employee"

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator", "OPTIONS": {"min_length": 10}},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
    {"NAME": "accounts.password_validators.RequireLetterValidator"},
    {"NAME": "accounts.password_validators.RequireDigitValidator"},
]

# Argon2 first so Django uses it for all newly-set passwords (this is a fresh-start database —
# no old scrypt-format hashes to stay compatible with, see the migration plan's Context section).
PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.Argon2PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
# Populated by `collectstatic` at image-build time (see backend/Dockerfile) so Django admin's own
# CSS/JS resolve — previously missing entirely, so /admin/ rendered unstyled in every environment
# (found during Prompt 4 production verification; fixed here per Prompt 5 item 7).
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
}
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ---- Onboarding document storage (Phase 6) ----
# MEDIA_ROOT is a plain filesystem path backed by a Docker named volume (see
# docker-compose.backend.yml / docker-compose.backend.prod.yml) — NOT served by nginx/Caddy at
# MEDIA_URL. Uploaded onboarding documents aren't public: every download goes through
# onboarding.views.ResourceDocumentDownloadView, which re-runs the same visibility check
# (onboarding.services.resource_visible_to_employee) the resource itself uses, then streams the
# file from disk with FileResponse. MEDIA_URL is set for Django's own FileField bookkeeping only;
# no web server config should ever expose this path directly. See DEPLOYMENT.backend.md.
MEDIA_ROOT = env("DJANGO_MEDIA_ROOT", default=str(BASE_DIR / "media"))
MEDIA_URL = "/media/"
# 10MB, matching the source app's onboarding document upload cap exactly — enforced again,
# explicitly, in onboarding.serializers (never trust this alone: DATA_UPLOAD_MAX_MEMORY_SIZE only
# governs how large a request body Django will parse before rejecting it outright).
DATA_UPLOAD_MAX_MEMORY_SIZE = 10 * 1024 * 1024

# ---- CORS / CSRF: the React frontend is a separate origin (localhost:5173) ----
FRONTEND_URL = env("FRONTEND_URL", default="http://localhost:5173")
CORS_ALLOWED_ORIGINS = env.list("DJANGO_CORS_ALLOWED_ORIGINS", default=[FRONTEND_URL])
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = env.list("DJANGO_CSRF_TRUSTED_ORIGINS", default=[FRONTEND_URL])
CSRF_COOKIE_HTTPONLY = False  # the SPA must be able to read it and echo it back as X-CSRFToken
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG

# Behind Caddy/nginx (docker-compose.backend.prod.yml), the connection Django itself sees is
# always plain HTTP over the Docker network — without this, request.is_secure() is always False,
# which silently skips Django's HTTPS-Referer cross-check on CSRF validation (the token check
# still applies either way, but this restores the full defense-in-depth). nginx-proxy-params.conf
# already forwards X-Forwarded-Proto correctly; this just tells Django to trust it.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# ---- Session length — mirrors the source app's app-settings-configurable sessionMaxAgeDays;
# hardcoded to 30 days for Phase 1 since there's no Settings model/page yet (Phase 2+ roadmap). ----
SESSION_COOKIE_AGE = 60 * 60 * 24 * 30
SESSION_SAVE_EVERY_REQUEST = False

# ---- Email — reuses the SAME Mailpit container the Next.js app already uses locally ----
EMAIL_HOST = env("SMTP_HOST", default="mailpit")
EMAIL_PORT = env.int("SMTP_PORT", default=1025)
EMAIL_HOST_USER = env("SMTP_USER", default="")
EMAIL_HOST_PASSWORD = env("SMTP_PASS", default="")
EMAIL_USE_TLS = env.bool("SMTP_SECURE", default=False)
DEFAULT_FROM_EMAIL = env("EMAIL_FROM", default="Agrileaf <no-reply@agrileaf.in>")
# No SMTP_HOST in some local setups is a real, supported case for the Next.js app (it prints to
# console instead of failing) — same fallback here, backend="django.core.mail.backends.console".
EMAIL_BACKEND = "django.core.mail.backends.smtp.EmailBackend" if EMAIL_HOST else "django.core.mail.backends.console.EmailBackend"

# APP_URL is used to build the set-password link — this points at the FRONTEND (the React app
# renders /set-password), not the Django backend.
APP_URL = FRONTEND_URL.rstrip("/")

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    # Only login/ and set-password/ opt into throttling (via their own throttle_classes — see
    # accounts/throttles.py), not a DEFAULT_THROTTLE_CLASSES applied everywhere, so these are the
    # only two rates needed. Configurable per environment without a code change; format is DRF's
    # own "<count>/<period>" (period one of s/min/hour/day) — see DRF's SimpleRateThrottle docs.
    "DEFAULT_THROTTLE_RATES": {
        "login": env("LOGIN_RATE_LIMIT", default="10/min"),
        "set_password": env("SET_PASSWORD_RATE_LIMIT", default="10/min"),
        "change_password": env("CHANGE_PASSWORD_RATE_LIMIT", default="10/min"),
        # DRF's rate-string format only carries a single-unit period (s/m/h/d, no arbitrary
        # multiples — "15m" would parse as "1 minute", not "15 minutes"), so this is the closest
        # native expression of the source app's "5 attempts / 15 min" — slightly more
        # conservative (5/hour is stricter than 5/15min), not a weaker substitute.
        "forgot_password": env("FORGOT_PASSWORD_RATE_LIMIT", default="5/hour"),
    },
}

# Uses Django's default cache (LocMemCache, in-process) to back the throttle counters above — fine
# for a single gunicorn worker (the current setup has no --workers flag, i.e. one worker). Running
# multiple workers or replicas in UAT/production would give each process its own counter, which
# under-throttles proportionally to the worker count — point CACHES at Redis/Memcached before
# scaling out, so all processes share one bucket. See DEPLOYMENT.md.

# ---- First-admin bootstrap (see accounts/management/commands/bootstrap_admin.py) ----
# Deliberately NOT tied to DEBUG: DEBUG only controls whether stack traces are shown to clients,
# and a DEBUG=False UAT/production environment still needs a documented way to create the first
# HR Admin. This is a separate, explicit opt-in an operator sets only for the single command
# invocation (e.g. `docker compose run -e ALLOW_BOOTSTRAP_ADMIN=true backend python manage.py
# bootstrap_admin ...`) — never left set in the environment's normal running configuration. The
# command's other guard (refuses if an ADMIN already exists) is unchanged and still applies.
ALLOW_BOOTSTRAP_ADMIN = env.bool("ALLOW_BOOTSTRAP_ADMIN", default=False)
