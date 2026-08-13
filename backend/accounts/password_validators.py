import re

from django.core.exceptions import ValidationError


class RequireLetterValidator:
    """Mirrors the source app's shared password_schema (src/lib/password-rules.ts), which requires
    at least one letter in addition to Django's built-in length/common-password/all-numeric checks."""

    def validate(self, password, user=None):
        if not re.search(r"[a-zA-Z]", password):
            raise ValidationError("Password must include at least one letter.", code="password_no_letter")

    def get_help_text(self):
        return "Your password must include at least one letter."


class RequireDigitValidator:
    """Mirrors the source app's shared password_schema (src/lib/password-rules.ts), which requires
    `.regex(/[0-9]/, ...)` — at least one digit — enforced by both its client-side form and its
    set-password/change-password routes. Missed in the earlier letter-only restoration; confirmed
    here by reading that file directly (Prompt 5 item 6), not assumed."""

    def validate(self, password, user=None):
        if not re.search(r"[0-9]", password):
            raise ValidationError("Password must include at least one number.", code="password_no_digit")

    def get_help_text(self):
        return "Your password must include at least one number."
