"""Per-IP rate limiting for the two unauthenticated, credential-guessable endpoints
(login and set-password). Rates are configurable via env — see LOGIN_RATE_LIMIT and
SET_PASSWORD_RATE_LIMIT in config/settings.py — so ops can tune them per environment without a
code change.

Built on DRF's AnonRateThrottle rather than a new dependency (e.g. django-ratelimit): it already
does IP-based bucketing via Django's cache framework, skips throttling entirely once
request.user is authenticated (irrelevant here, both views are AllowAny-only), and needs only a
distinct `scope` per view to get separate buckets. Uses whatever CACHES backend is configured —
the default in-process LocMemCache is fine for a single worker process; a multi-worker/multi-
replica deployment should point CACHES at Redis/Memcached so all processes share one bucket
(documented in DEPLOYMENT.md).
"""
from django.conf import settings
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle


class _ConfigurableRateMixin:
    """THROTTLE_RATES is normally bound to api_settings.DEFAULT_THROTTLE_RATES once, at
    class-definition time (module import) — a well-known DRF gotcha where Django's
    @override_settings(REST_FRAMEWORK=...) in tests has no effect on it afterwards. Overriding
    get_rate() to read settings.REST_FRAMEWORK directly on every request sidesteps that entirely:
    always current, and trivially testable. Shared by both the anonymous- and
    authenticated-caller throttle bases below."""

    def get_rate(self):
        return settings.REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"][self.scope]


class _ConfigurableAnonRateThrottle(_ConfigurableRateMixin, AnonRateThrottle):
    pass


class _ConfigurableUserRateThrottle(_ConfigurableRateMixin, UserRateThrottle):
    """For endpoints that require IsAuthenticated (change-password): AnonRateThrottle.get_cache_key
    returns None — i.e. skips throttling entirely — once request.user is authenticated, so it's
    the wrong base class here. UserRateThrottle keys by user pk instead, which is what we want:
    each account's own rapid-fire attempts count against their own bucket."""


class LoginRateThrottle(_ConfigurableAnonRateThrottle):
    scope = "login"


class SetPasswordRateThrottle(_ConfigurableAnonRateThrottle):
    scope = "set_password"


class ChangePasswordRateThrottle(_ConfigurableUserRateThrottle):
    scope = "change_password"


class ForgotPasswordRateThrottle(_ConfigurableAnonRateThrottle):
    """Keyed by IP+email rather than IP alone — mirrors the source app's design (5 attempts /
    15 min keyed by IP+email): an attacker spraying forgot-password requests across many
    different target emails from one IP would otherwise exhaust a single shared per-IP bucket
    almost immediately, throttling legitimate users behind the same NAT/proxy for accounts they
    never touched. Keying by IP+email instead gives each (attacker IP, target email) pair its own
    budget, so spraying many emails doesn't collaterally lock out anyone else."""

    scope = "forgot_password"

    def get_cache_key(self, request, view):
        ident = self.get_ident(request)
        email = (request.data.get("email") or "").strip().lower()
        return self.cache_format % {"scope": self.scope, "ident": f"{ident}:{email}"}
