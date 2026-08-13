from django.db import models


class AuditLogEntry(models.Model):
    """Mirrors the source app's audit_log table (src/lib/db/schema.ts), with one deliberate
    improvement: actor is a real FK (on_delete=SET_NULL) instead of a bare id string, so a
    deleted employee's history stays queryable. actor_name is still denormalized at write time
    (same as the source app's actorId/actorName pair) so the log keeps reading correctly even
    after the actor row itself is gone."""

    timestamp = models.DateTimeField(auto_now_add=True)
    actor = models.ForeignKey(
        "accounts.Employee", null=True, on_delete=models.SET_NULL, related_name="audit_entries"
    )
    actor_name = models.CharField(max_length=255)
    action = models.CharField(max_length=255)
    target_type = models.CharField(max_length=100)
    target_label = models.CharField(max_length=255)
    details = models.TextField(null=True, blank=True)

    class Meta:
        ordering = ["-timestamp"]

    def __str__(self) -> str:
        return f"{self.action} — {self.target_label}"
