"""The leave request status state machine, as a pure, independently-testable data structure.

Encodes every transition implemented in Phase 2C (None->PENDING, None->APPROVED via
auto-approve, PENDING->CANCELLED, APPROVED->CANCELLED) plus the two transitions that are valid
states in the schema but whose triggering endpoint (manual approve/reject) is deliberately
deferred to the Approvals phase (PENDING->APPROVED, PENDING->REJECTED) — see
leave_balances.models.LeaveBalance's docstring for that phase's mandatory balance re-check
requirement. `None` represents "request does not exist yet" (creation).

cancel_leave_request (services.py) consults this matrix directly rather than an ad hoc status
check, so this is the single source of truth for "which transitions are legal" — the Approvals
phase's future decide endpoint should consult it too rather than re-deriving its own rules.
"""
from .models import LeaveStatus

VALID_TRANSITIONS: frozenset[tuple[str | None, str]] = frozenset(
    {
        (None, LeaveStatus.PENDING),
        (None, LeaveStatus.APPROVED),
        (LeaveStatus.PENDING, LeaveStatus.APPROVED),
        (LeaveStatus.PENDING, LeaveStatus.REJECTED),
        (LeaveStatus.PENDING, LeaveStatus.CANCELLED),
        (LeaveStatus.APPROVED, LeaveStatus.CANCELLED),
    }
)


def is_valid_transition(from_status: str | None, to_status: str) -> bool:
    return (from_status, to_status) in VALID_TRANSITIONS
