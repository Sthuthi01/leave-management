from django.db import models


class AccrualMethod(models.TextChoices):
    ANNUAL = "ANNUAL", "Annual"
    MONTHLY = "MONTHLY", "Monthly"


class LeaveType(models.Model):
    name = models.CharField(max_length=100, unique=True)
    code = models.CharField(max_length=20, unique=True)
    color = models.CharField(max_length=7, default="#16a34a")
    default_days_per_year = models.PositiveIntegerField(default=0)
    requires_approval = models.BooleanField(default=True)
    is_active = models.BooleanField(default=True)
    accrual_method = models.CharField(
        max_length=10, choices=AccrualMethod.choices, default=AccrualMethod.ANNUAL
    )
    carry_forward_limit = models.PositiveIntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name
