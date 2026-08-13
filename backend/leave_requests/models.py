from django.db import models


class LeaveStatus(models.TextChoices):
    PENDING = "PENDING", "Pending"
    APPROVED = "APPROVED", "Approved"
    REJECTED = "REJECTED", "Rejected"
    CANCELLED = "CANCELLED", "Cancelled"


class LeaveRequest(models.Model):
    """Mirrors the source app's leave_requests table. Status transitions implemented in Phase
    2C: (none)->PENDING, (none)->APPROVED (auto-approve), PENDING->CANCELLED,
    APPROVED->CANCELLED. PENDING->APPROVED/REJECTED (manual decide) is deliberately NOT
    implemented here — see leave_balances.models.LeaveBalance's docstring for the mandatory
    approval-time balance re-check the future Approvals phase must add when it builds that.

    Deviation from source: employee/leave_type FKs use on_delete=PROTECT (source had no DB-level
    protection, only unenforced "no action"); approver uses SET_NULL since an approver's own
    employee record should never be blocked from changes because they approved someone's leave.
    """

    reference_number = models.CharField(max_length=20, unique=True, editable=False)
    employee = models.ForeignKey("accounts.Employee", on_delete=models.PROTECT, related_name="leave_requests")
    leave_type = models.ForeignKey("leave_types.LeaveType", on_delete=models.PROTECT, related_name="requests")
    start_date = models.DateField()
    end_date = models.DateField()
    days = models.PositiveIntegerField()
    reason = models.CharField(max_length=2000, blank=True, default="")
    status = models.CharField(max_length=10, choices=LeaveStatus.choices, default=LeaveStatus.PENDING)
    approver = models.ForeignKey(
        "accounts.Employee", null=True, blank=True, on_delete=models.SET_NULL, related_name="requests_to_approve"
    )
    approver_comment = models.CharField(max_length=2000, null=True, blank=True)
    applied_at = models.DateTimeField(auto_now_add=True)
    decided_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(check=models.Q(start_date__lte=models.F("end_date")), name="request_start_before_end"),
        ]
        indexes = [models.Index(fields=["employee", "status"])]
        ordering = ["-applied_at"]

    def __str__(self) -> str:
        return f"{self.reference_number} ({self.employee} / {self.status})"
