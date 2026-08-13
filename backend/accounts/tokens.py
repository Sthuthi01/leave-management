"""Password-setup token scheme — mirrors src/lib/invitation-token.ts and the relevant parts of
src/lib/db/invitation-repo.ts exactly: a random 256-bit token, only its SHA-256 hash ever
persisted, purpose-scoped TTLs, single-use, and issuing a new token invalidates prior unused ones.

Phase 1.5 RESET-plumbing decision: TokenPurpose.RESET, RESET_TOKEN_TTL_HOURS, and check_token/
consume_token below are already fully purpose-agnostic and support RESET today — nothing here is
broken or half-written. What's deliberately NOT built yet is any endpoint that MINTS a RESET token
(a self-service "forgot password" route, or an admin-triggered "send reset link" action) — those
are real, new user-facing features (the source app's forgot-password page + POST
/api/employees/[id]/send-password-reset), out of scope for Phase 1.5's hardening-only mandate.
This module is intentionally left ready for Phase 2 to wire up without any changes needed here.
"""

import hashlib
import secrets
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

from .models import Employee, EmployeeStatus, PasswordSetupToken, TokenPurpose

INVITE_TOKEN_TTL_HOURS = 48
RESET_TOKEN_TTL_HOURS = 1


def _hash_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()


def create_token(employee: Employee, purpose: str) -> str:
    """Returns the RAW token (only this call site ever sees it — put it straight into an email
    link, never persist it). Invalidates any prior unused token of the same purpose for this
    employee first, so "resend invitation" can't leave two valid links live at once."""
    ttl_hours = INVITE_TOKEN_TTL_HOURS if purpose == TokenPurpose.INVITE else RESET_TOKEN_TTL_HOURS
    raw_token = secrets.token_urlsafe(32)

    with transaction.atomic():
        PasswordSetupToken.objects.filter(employee=employee, purpose=purpose, used_at__isnull=True).update(
            used_at=timezone.now()
        )
        PasswordSetupToken.objects.create(
            employee=employee,
            token_hash=_hash_token(raw_token),
            purpose=purpose,
            expires_at=timezone.now() + timedelta(hours=ttl_hours),
        )

    return raw_token


def check_token(raw_token: str) -> tuple[PasswordSetupToken | None, str | None]:
    """Read-only validity check (does NOT consume) — used by the frontend's page-load check before
    the user has typed anything. Returns (token_row_or_None, reason_if_invalid)."""
    token_hash = _hash_token(raw_token)
    try:
        token = PasswordSetupToken.objects.select_related("employee").get(token_hash=token_hash)
    except PasswordSetupToken.DoesNotExist:
        return None, "INVALID"

    if token.employee.status == EmployeeStatus.INACTIVE:
        return None, "INVALID"
    if token.used_at is not None:
        return None, "USED"
    if token.expires_at < timezone.now():
        return None, "EXPIRED"
    return token, None


def consume_token(raw_token: str) -> Employee | None:
    """Atomically marks the token used and returns the employee, or None if it was already
    invalid/used/expired — the UPDATE...WHERE used_at IS NULL pattern (mirrored here via a
    conditional queryset update inside a transaction) is what makes double-submission race-safe,
    exactly like consumeToken() in the source app's invitation-repo.ts."""
    token, reason = check_token(raw_token)
    if token is None:
        return None

    with transaction.atomic():
        updated = PasswordSetupToken.objects.filter(pk=token.pk, used_at__isnull=True).update(used_at=timezone.now())
        if updated == 0:
            return None  # lost a race with a concurrent consume attempt
        return token.employee
