from django.db import models


class Holiday(models.Model):
    """Mirrors the source app's holidays table (name, date, optional) exactly — no year column
    (derived from date), no is_active flag (the source app has no such concept for holidays).

    Deviation from source: the source app enforced "no two holidays share a date" only in
    application code (no DB constraint), which left a race window between concurrent creates.
    Here that same business rule is enforced with a real unique constraint on `date`, which is
    strictly safer and still expresses the identical rule — not a behavior change a user could
    observe, just a race fixed at the DB layer.
    """

    name = models.CharField(max_length=255)
    date = models.DateField(unique=True)
    optional = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["date"]

    def __str__(self) -> str:
        return f"{self.name} ({self.date})"
