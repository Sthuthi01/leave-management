"""Leave balance business logic — entitlement, proration, carry-forward, and accrual.

Ported from the source Next.js app's src/lib/db/repo.ts (entitlementStart, getOrCreateBalance,
accruedToDate), preserving the exact formulas. See the Phase 2C design doc for the two
deliberate deviations: carry-forward is looked up directly from the DB (not a request-scoped
snapshot), and this module documents (but does not yet enforce, per Phase 2C scope) the
approval-time balance re-check required in the future Approvals phase.
"""
import math
from datetime import date

from django.utils import timezone

from leave_types.models import AccrualMethod

from .models import LeaveBalance


def _round_half_up(value: float) -> int:
    """Matches JS Math.round for non-negative inputs (all inputs here are non-negative)."""
    return math.floor(value + 0.5)


def entitlement_start(employee, year: int) -> date:
    """The date from which entitlement for `year` starts accruing: the employee's join date if
    they joined in `year`, else Jan 1 of `year`."""
    join_date = employee.joined_at
    if join_date.year == year:
        return join_date
    return date(year, 1, 1)


def _months_available(start: date) -> int:
    """Calendar months from `start`'s month through December, inclusive (Jan start -> 12)."""
    return 13 - start.month


def _previous_year_remaining(employee, leave_type, year: int) -> int:
    """Direct DB lookup of the prior year's balance row (Phase 2C deviation from source, which
    read this from a request-scoped snapshot and silently returned 0 if that year's row hadn't
    been materialized yet in the snapshot)."""
    try:
        prior = LeaveBalance.objects.get(employee=employee, leave_type=leave_type, year=year - 1)
    except LeaveBalance.DoesNotExist:
        return 0
    return max(0, prior.allocated - prior.used)


def _compute_allocation(employee, leave_type, year: int) -> tuple[int, int]:
    """Returns (allocated, carried_forward) for a brand-new balance row."""
    start = entitlement_start(employee, year)
    months_available = _months_available(start)
    prorated_annual = _round_half_up(leave_type.default_days_per_year * months_available / 12)
    carried_forward = min(
        leave_type.carry_forward_limit,
        max(0, _previous_year_remaining(employee, leave_type, year)),
    )
    return prorated_annual + carried_forward, carried_forward


def get_or_create_balance(employee, leave_type, year: int) -> LeaveBalance:
    """Lazily creates the (employee, leave_type, year) balance row if it doesn't exist yet,
    matching the source app's lazy-creation behavior exactly (never created eagerly on
    employee/leave-type creation)."""
    allocated, carried_forward = _compute_allocation(employee, leave_type, year)
    balance, _created = LeaveBalance.objects.get_or_create(
        employee=employee,
        leave_type=leave_type,
        year=year,
        defaults={"allocated": allocated, "used": 0, "carried_forward": carried_forward},
    )
    return balance


def get_or_create_balance_for_update(employee, leave_type, year: int) -> LeaveBalance:
    """Same as get_or_create_balance, but returns the row locked with select_for_update() for
    callers that are about to mutate `used` within an open transaction."""
    get_or_create_balance(employee, leave_type, year)
    return LeaveBalance.objects.select_for_update().get(employee=employee, leave_type=leave_type, year=year)


def preview_balance(employee, leave_type, year: int) -> LeaveBalance:
    """Read-only equivalent of get_or_create_balance for the leave-request preview endpoint:
    returns the existing balance row if one exists, otherwise an unsaved LeaveBalance computed
    with the same allocation formula — never writes to the DB, so previewing a request can never
    create a stray balance row or otherwise mutate state."""
    try:
        return LeaveBalance.objects.get(employee=employee, leave_type=leave_type, year=year)
    except LeaveBalance.DoesNotExist:
        allocated, carried_forward = _compute_allocation(employee, leave_type, year)
        return LeaveBalance(employee=employee, leave_type=leave_type, year=year, allocated=allocated, used=0, carried_forward=carried_forward)


def accrued_to_date(employee, leave_type, balance: LeaveBalance, as_of: date | None = None) -> int:
    """How much of `balance.allocated` has actually accrued as of `as_of` (defaults to today).

    ANNUAL leave types: the full `allocated` amount is available from day one.
    MONTHLY leave types: accrues month-by-month, with the current in-progress month counted as
    fully elapsed (day-of-month granularity doesn't matter — see Phase 2C design doc worked
    examples). A past balance year returns the full `allocated`; a future balance year returns
    only `carried_forward` (nothing fresh has started accruing yet).
    """
    as_of = as_of or timezone.now().date()

    if leave_type.accrual_method == AccrualMethod.ANNUAL:
        return balance.allocated
    if balance.year < as_of.year:
        return balance.allocated
    if balance.year > as_of.year:
        return balance.carried_forward

    start = entitlement_start(employee, balance.year)
    months_available = _months_available(start)
    fresh_annual = balance.allocated - balance.carried_forward
    months_elapsed = min(months_available, max(0, (as_of.month - start.month) + 1))
    accrued_fresh = _round_half_up(fresh_annual * months_elapsed / max(1, months_available))
    return balance.carried_forward + min(fresh_annual, accrued_fresh)


def remaining(employee, leave_type, balance: LeaveBalance, as_of: date | None = None) -> int:
    return accrued_to_date(employee, leave_type, balance, as_of) - balance.used
