from django.db import models


class LeaveBalance(models.Model):
    """One row per (employee, leave_type, year) — mirrors the source app's composite-PK table
    exactly (see Phase 2C design doc). `allocated` and `used` are stored; `remaining`/
    `accrued_to_date` are always computed (see leave_balances.services), never persisted.

    Deviations from source (all deliberate, documented at design time):
    - Carry-forward is computed via a direct DB lookup of the prior year's row (services.py),
      not a request-scoped snapshot — the source app's snapshot approach silently drops
      carry-forward when the prior year's row hadn't been materialized yet.
    - `employee`/`leave_type` use on_delete=PROTECT (source had no DB-level protection).
    - `used` is a PositiveIntegerField, which Django/Postgres enforces with a DB-level
      CHECK (used >= 0) constraint automatically (Django 4.1+) — the source only clamped this
      in application code (SQL GREATEST(0, ...)).

    ACCEPTANCE CRITERION FOR THE FUTURE APPROVALS PHASE (do not drop this): the decide/approve
    endpoint MUST select_for_update() this row and re-verify
    accrued_to_date(employee, leave_type, balance) - used >= days before approving a PENDING
    request, rejecting the approval otherwise. The source app does not do this — two PENDING
    requests can each pass the apply-time check individually and later both be approved,
    driving `used` above `allocated`/accrued. That is a bug in the source, not a rule to
    preserve, and must be fixed here when Approvals is implemented.
    """

    employee = models.ForeignKey("accounts.Employee", on_delete=models.PROTECT, related_name="leave_balances")
    leave_type = models.ForeignKey("leave_types.LeaveType", on_delete=models.PROTECT, related_name="balances")
    year = models.PositiveIntegerField()
    allocated = models.PositiveIntegerField()
    used = models.PositiveIntegerField(default=0)
    carried_forward = models.PositiveIntegerField(default=0)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["employee", "leave_type", "year"], name="unique_balance_per_employee_type_year"),
        ]
        ordering = ["-year", "leave_type__name"]

    def __str__(self) -> str:
        return f"{self.employee} / {self.leave_type} / {self.year}"
