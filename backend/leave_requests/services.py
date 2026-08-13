"""Leave request business logic: day-count calculation, apply, and cancel.

Ported from the source Next.js app's src/lib/business-days.ts (calculateLeaveDays) and
src/lib/db/repo.ts (applyLeaveRequestAtomic, cancelLeaveRequestTx), preserving the exact
validation order and concurrency mechanics described in the Phase 2C design doc:

- Cheap, lock-free checks (date order, backdating, leave-type active, no-manager) run BEFORE
  acquiring any lock, to minimize lock hold time — exactly mirroring the source's route-level
  comment on this same ordering.
- Apply takes a per-employee Postgres transaction-scoped advisory lock
  (pg_advisory_xact_lock) as the first statement inside the transaction, serializing concurrent
  applies for the SAME employee while never blocking different employees against each other.
  Overlap and balance-sufficiency are re-checked fresh, inside the lock.
- Cancel uses select_for_update() on the LeaveRequest row (and, if refunding, the LeaveBalance
  row) instead of a lock — a concurrent cancel attempt on the same row simply blocks until the
  first transaction commits, then observes the now-terminal status and is rejected. This is a
  simplification of the source's CAS-conditional-UPDATE-returning-zero-rows pattern: since
  select_for_update() eliminates the race window that pattern existed to detect, there is no
  separate "you lost a race, HTTP 409" case here — a losing concurrent cancel just sees the
  same "already cancelled" validation error the first caller would have seen if they'd gone
  second. Same business outcome (only one cancel can ever succeed), different mechanism.

Phase 2D adds decide_leave_request (approve/reject), implementing the mandatory acceptance
criterion documented on leave_balances.models.LeaveBalance: approval re-verifies balance
sufficiency fresh, under a row lock, and rejects the approval (never overdrawing) if the balance
has been consumed by something else since the request was submitted. Uses the same
select_for_update() pattern as cancel_leave_request: locking the LeaveRequest row first means a
concurrent decide/cancel on the same row simply blocks until the first transaction commits, then
observes the now-terminal status — no separate "you lost a race" HTTP 409 case, same as cancel.
The LeaveBalance row is additionally locked (only when approving a capped leave type) so two
concurrent approvals against requests sharing the same employee+leave_type+year balance can never
both succeed if only one fits — the second sees the first's committed `used` increment and is
correctly rejected.
"""
from datetime import date, timedelta

from django.db import connection, transaction
from django.utils import timezone

from audit.services import log_audit
from holidays.models import Holiday
from leave_balances.services import accrued_to_date, get_or_create_balance_for_update, preview_balance
from org_settings.models import OrganizationSettings

from .models import LeaveRequest, LeaveStatus
from .transitions import is_valid_transition

# Fallback only for direct calculate_leave_days() callers (e.g. tests) that don't pass
# working_days explicitly — apply_leave_request itself always sources the live, configurable
# value from OrganizationSettings (see its call to calculate_leave_days below). Matches the
# source app's default workingDays ([1,2,3,4,5] in JS Sunday=0 convention) expressed in Python's
# date.weekday() convention (Monday=0 ... Sunday=6).
DEFAULT_WORKING_DAYS = frozenset({0, 1, 2, 3, 4})


class ApplyLeaveError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 400, **extra):
        self.code = code
        self.message = message
        self.http_status = http_status
        self.extra = extra
        super().__init__(message)


class CancelError(Exception):
    def __init__(self, http_status: int, code: str, message: str):
        self.http_status = http_status
        self.code = code
        self.message = message
        super().__init__(message)


class DecideError(Exception):
    def __init__(self, http_status: int, code: str, message: str):
        self.http_status = http_status
        self.code = code
        self.message = message
        super().__init__(message)


def calculate_leave_days(start_date: date, end_date: date, working_days=DEFAULT_WORKING_DAYS) -> int:
    """Excludes weekends (working_days) and ALL holidays, mandatory and optional treated
    identically (confirmed against source's calculateLeaveDays — no filtering on Holiday.optional
    anywhere)."""
    holiday_dates = set(Holiday.objects.filter(date__gte=start_date, date__lte=end_date).values_list("date", flat=True))
    days = 0
    current = start_date
    while current <= end_date:
        if current.weekday() in working_days and current not in holiday_dates:
            days += 1
        current += timedelta(days=1)
    return days


def _next_reference_number(year: int) -> str:
    with connection.cursor() as cursor:
        cursor.execute("SELECT nextval('leave_request_seq')")
        seq = cursor.fetchone()[0]
    return f"LR-{year}-{seq:04d}"


def _validate_basic(*, leave_type, start_date: date, end_date: date) -> None:
    """Date-order, backdating, and active-leave-type checks shared by apply_leave_request and
    preview_leave_request, so the two can never drift apart on these rules."""
    if start_date > end_date:
        raise ApplyLeaveError("INVALID_RANGE", "Start date must be on or before the end date.")
    if start_date < timezone.now().date():
        raise ApplyLeaveError("PAST_DATE", "Leave can't be applied for a date in the past.")
    if not leave_type.is_active:
        raise ApplyLeaveError("INACTIVE_LEAVE_TYPE", "This leave type is not active.")


def _calculate_days_or_raise(start_date: date, end_date: date) -> int:
    """Working-day calculation shared by apply_leave_request and preview_leave_request — the
    single source of truth for day counts, so a preview can never show a different figure than
    what the real submission goes on to charge against the balance."""
    # Fetched once here, not per-day-in-loop inside calculate_leave_days.
    working_days = OrganizationSettings.load().working_days
    days = calculate_leave_days(start_date, end_date, working_days=working_days)
    if days <= 0:
        raise ApplyLeaveError("NO_WORKING_DAYS", "This date range has no working days to apply for.")
    return days


def preview_leave_request(*, employee, leave_type, start_date: date, end_date: date) -> dict:
    """Read-only day-count + balance preview for the Apply Leave form. Runs through the exact
    same date/leave-type/working-day validation apply_leave_request uses (via the shared helpers
    above), so the preview can never diverge from what a real submission would calculate.

    Deliberately does not run the overlap or NO_MANAGER checks apply_leave_request performs —
    those determine whether a submission would be *accepted*, not the day-count/balance figures
    being previewed here — and never creates a LeaveRequest, mutates a LeaveBalance row, or writes
    an audit log entry (see leave_balances.services.preview_balance).
    """
    _validate_basic(leave_type=leave_type, start_date=start_date, end_date=end_date)
    days = _calculate_days_or_raise(start_date, end_date)

    is_capped = leave_type.default_days_per_year > 0
    remaining_balance = None
    balance_after = None
    insufficient = False
    if is_capped:
        balance = preview_balance(employee, leave_type, start_date.year)
        remaining_balance = max(0, accrued_to_date(employee, leave_type, balance) - balance.used)
        balance_after = remaining_balance - days
        insufficient = days > remaining_balance

    return {
        "days": days,
        "is_capped": is_capped,
        "remaining_balance": remaining_balance,
        "balance_after": balance_after,
        "insufficient_balance": insufficient,
    }


def apply_leave_request(*, employee, leave_type, start_date: date, end_date: date, reason: str) -> LeaveRequest:
    _validate_basic(leave_type=leave_type, start_date=start_date, end_date=end_date)
    # Preserves the source app's exact guard (route.ts:73-75) and message — confirmed via
    # research this is existing, enforced source behavior, not a new rule introduced here.
    if leave_type.requires_approval and not employee.manager_id:
        raise ApplyLeaveError("NO_MANAGER", "You have no manager assigned to approve this request. Contact HR.")

    days = _calculate_days_or_raise(start_date, end_date)

    with transaction.atomic():
        with connection.cursor() as cursor:
            cursor.execute("SELECT pg_advisory_xact_lock(%s)", [employee.pk])

        overlap = (
            LeaveRequest.objects.filter(
                employee=employee,
                status__in=[LeaveStatus.PENDING, LeaveStatus.APPROVED],
                start_date__lte=end_date,
                end_date__gte=start_date,
            )
            .select_related("leave_type")
            .first()
        )
        if overlap:
            raise ApplyLeaveError(
                "OVERLAP",
                f"This overlaps with {overlap.reference_number}, which is already "
                f"{overlap.status} for {overlap.start_date} – {overlap.end_date}.",
                overlapping=overlap,
            )

        is_capped = leave_type.default_days_per_year > 0
        year = start_date.year
        balance = None
        if is_capped:
            balance = get_or_create_balance_for_update(employee, leave_type, year)
            available = accrued_to_date(employee, leave_type, balance) - balance.used
            if days > available:
                raise ApplyLeaveError(
                    "INSUFFICIENT_BALANCE",
                    f"Insufficient balance: {max(0, available)} day(s) available.",
                    available=max(0, available),
                )

        auto_approve = not leave_type.requires_approval
        status = LeaveStatus.APPROVED if auto_approve else LeaveStatus.PENDING
        now = timezone.now()

        leave_request = LeaveRequest.objects.create(
            reference_number=_next_reference_number(year),
            employee=employee,
            leave_type=leave_type,
            start_date=start_date,
            end_date=end_date,
            days=days,
            reason=reason or "",
            status=status,
            approver=None if auto_approve else employee.manager,
            approver_comment=None,
            decided_at=now if auto_approve else None,
        )

        if auto_approve and is_capped:
            balance.used = balance.used + days
            balance.save(update_fields=["used"])

        log_audit(
            employee,
            "Applied leave" if leave_type.requires_approval else "Applied leave (auto-approved)",
            "LeaveRequest",
            f"{leave_request.reference_number} — {employee.name}",
        )

        return leave_request


def cancel_leave_request(*, employee, leave_request_id: int) -> LeaveRequest:
    with transaction.atomic():
        try:
            leave_request = LeaveRequest.objects.select_for_update().select_related("leave_type", "employee").get(
                pk=leave_request_id
            )
        except LeaveRequest.DoesNotExist as exc:
            raise CancelError(404, "NOT_FOUND", "Leave request not found.") from exc

        if leave_request.employee_id != employee.pk:
            raise CancelError(403, "FORBIDDEN", "You can only cancel your own leave requests.")
        if not is_valid_transition(leave_request.status, LeaveStatus.CANCELLED):
            raise CancelError(400, "INVALID_STATUS", "Only pending or approved requests can be cancelled.")

        was_approved = leave_request.status == LeaveStatus.APPROVED
        leave_request.status = LeaveStatus.CANCELLED
        leave_request.save(update_fields=["status"])

        if was_approved and leave_request.leave_type.default_days_per_year > 0:
            year = leave_request.start_date.year
            balance = get_or_create_balance_for_update(leave_request.employee, leave_request.leave_type, year)
            balance.used = max(0, balance.used - leave_request.days)
            balance.save(update_fields=["used"])

        log_audit(
            employee, "Cancelled leave", "LeaveRequest", f"{leave_request.reference_number} — {employee.name}"
        )

        return leave_request


def decide_leave_request(*, approver, leave_request_id: int, decision: str, comment: str | None) -> LeaveRequest:
    if decision not in (LeaveStatus.APPROVED, LeaveStatus.REJECTED):
        raise DecideError(400, "INVALID_DECISION", "decision must be APPROVED or REJECTED.")

    comment = (comment or "").strip() or None
    # Preserves the source app's exact rule: a bare rejection with no explanation is disallowed,
    # approval's comment stays optional.
    if decision == LeaveStatus.REJECTED and not comment:
        raise DecideError(400, "COMMENT_REQUIRED", "A comment is required when rejecting a request.")

    with transaction.atomic():
        try:
            # `approver` is deliberately excluded from select_related here: it's a nullable FK,
            # and Postgres refuses SELECT ... FOR UPDATE across an outer join ("FOR UPDATE cannot
            # be applied to the nullable side of an outer join"). Only `approver_id` is ever
            # compared below, so the joined object was never needed.
            leave_request = (
                LeaveRequest.objects.select_for_update()
                .select_related("employee", "leave_type")
                .get(pk=leave_request_id)
            )
        except LeaveRequest.DoesNotExist as exc:
            raise DecideError(404, "NOT_FOUND", "Leave request not found.") from exc

        # Defense-in-depth: structurally unreachable today (EmployeeUpdateSerializer already
        # blocks an employee from being set as their own manager, so employee != approver in
        # practice), but cheap to check explicitly rather than relying on that upstream guard.
        if leave_request.employee_id == approver.pk:
            raise DecideError(403, "SELF_APPROVAL", "You cannot approve or reject your own leave request.")
        # Strict, role-blind equality against the approver frozen on the request at apply-time —
        # matches the source app exactly: no MANAGER-role bypass, no ADMIN bypass. A request
        # whose original approver has since changed or been deactivated has no other route to
        # being decided — a known, deliberately-preserved source limitation (see Phase 2D design
        # doc), not something this endpoint works around.
        if leave_request.approver_id != approver.pk:
            raise DecideError(403, "FORBIDDEN", "You are not the approver for this request.")
        if not is_valid_transition(leave_request.status, decision):
            raise DecideError(400, "ALREADY_DECIDED", "This request has already been decided.")

        if decision == LeaveStatus.APPROVED and leave_request.leave_type.default_days_per_year > 0:
            year = leave_request.start_date.year
            balance = get_or_create_balance_for_update(leave_request.employee, leave_request.leave_type, year)
            available = accrued_to_date(leave_request.employee, leave_request.leave_type, balance) - balance.used
            if leave_request.days > available:
                # The mandatory Phase 2C/2D acceptance criterion: never let an approval overdraw
                # the balance, even though this exact request passed the (non-reserving) check at
                # apply-time — something else may have consumed the balance since then.
                raise DecideError(
                    409,
                    "INSUFFICIENT_BALANCE",
                    f"Approving this would exceed the employee's available balance "
                    f"({max(0, available)} day(s) available). Reject it instead, or ask the "
                    f"employee to adjust the request.",
                )
            balance.used = balance.used + leave_request.days
            balance.save(update_fields=["used"])

        leave_request.status = decision
        leave_request.approver_comment = comment
        leave_request.decided_at = timezone.now()
        leave_request.save(update_fields=["status", "approver_comment", "decided_at"])

        log_audit(
            approver,
            "Approved leave" if decision == LeaveStatus.APPROVED else "Rejected leave",
            "LeaveRequest",
            f"{leave_request.reference_number} — {leave_request.employee.name}",
            comment,
        )

        return leave_request
