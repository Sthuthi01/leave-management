from django.contrib.postgres.fields import ArrayField
from django.core.validators import MinValueValidator
from django.db import models

DEFAULT_WORKING_DAYS = [0, 1, 2, 3, 4]  # Monday-Friday, date.weekday() convention (Monday=0)


class OrganizationSettings(models.Model):
    """Singleton row (pk always 1) of org-wide configuration — mirrors the source app's
    `app_settings` table (src/lib/db/schema.ts). Deliberately omits `upcoming_leave_window_days`:
    confirmed via the feature-parity audit that no route or component in the source app ever
    reads it — porting it forward would replicate dead configuration, not a feature.

    `working_days` uses Django's own `date.weekday()` convention (Monday=0 ... Sunday=6), matching
    every other day-of-week value already in this codebase (see leave_requests.services
    DEFAULT_WORKING_DAYS) — NOT the source app's JS `Date.getUTCDay()` convention (Sunday=0). The
    frontend is responsible for this same translation when rendering day-of-week toggles.
    """

    id = models.PositiveSmallIntegerField(primary_key=True, default=1)
    working_days = ArrayField(
        models.PositiveSmallIntegerField(),
        default=list,
        help_text="Days of the week (0=Monday ... 6=Sunday) that count toward leave-day calculations.",
    )
    pending_approval_urgency_days = models.PositiveIntegerField(
        default=3, validators=[MinValueValidator(1)]
    )
    audit_log_display_limit = models.PositiveIntegerField(default=200, validators=[MinValueValidator(1)])
    session_max_age_days = models.PositiveIntegerField(default=30, validators=[MinValueValidator(1)])

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls) -> "OrganizationSettings":
        obj, _ = cls.objects.get_or_create(pk=1, defaults={"working_days": DEFAULT_WORKING_DAYS})
        return obj

    def __str__(self) -> str:
        return "Organization settings"
