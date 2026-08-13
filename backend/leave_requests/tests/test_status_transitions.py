import datetime
import itertools

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from ..models import LeaveRequest, LeaveStatus
from ..transitions import VALID_TRANSITIONS, is_valid_transition
from .helpers import make_department, make_employee, make_leave_type, make_manager


def _next_monday(after: datetime.date) -> datetime.date:
    days_ahead = (7 - after.weekday()) % 7 or 7
    return after + datetime.timedelta(days=days_ahead)


ALL_STATUSES = [LeaveStatus.PENDING, LeaveStatus.APPROVED, LeaveStatus.REJECTED, LeaveStatus.CANCELLED]


class TransitionMatrixTest(TestCase):
    """Exhaustively verifies the exact set of legal transitions per the Phase 2C acceptance
    criteria: only None->PENDING, None->APPROVED, PENDING->APPROVED, PENDING->REJECTED,
    PENDING->CANCELLED, APPROVED->CANCELLED are valid; every other (from, to) pair — including
    all four self-transitions and every transition out of REJECTED/CANCELLED — must be invalid."""

    def test_exactly_six_transitions_are_valid(self):
        self.assertEqual(len(VALID_TRANSITIONS), 6)

    def test_creation_transitions(self):
        self.assertTrue(is_valid_transition(None, LeaveStatus.PENDING))
        self.assertTrue(is_valid_transition(None, LeaveStatus.APPROVED))
        self.assertFalse(is_valid_transition(None, LeaveStatus.REJECTED))
        self.assertFalse(is_valid_transition(None, LeaveStatus.CANCELLED))

    def test_pending_can_move_to_approved_rejected_or_cancelled(self):
        self.assertTrue(is_valid_transition(LeaveStatus.PENDING, LeaveStatus.APPROVED))
        self.assertTrue(is_valid_transition(LeaveStatus.PENDING, LeaveStatus.REJECTED))
        self.assertTrue(is_valid_transition(LeaveStatus.PENDING, LeaveStatus.CANCELLED))

    def test_approved_can_only_move_to_cancelled(self):
        self.assertTrue(is_valid_transition(LeaveStatus.APPROVED, LeaveStatus.CANCELLED))
        self.assertFalse(is_valid_transition(LeaveStatus.APPROVED, LeaveStatus.PENDING))
        self.assertFalse(is_valid_transition(LeaveStatus.APPROVED, LeaveStatus.REJECTED))

    def test_rejected_and_cancelled_are_terminal(self):
        for terminal in (LeaveStatus.REJECTED, LeaveStatus.CANCELLED):
            for target in ALL_STATUSES:
                with self.subTest(terminal=terminal, target=target):
                    self.assertFalse(is_valid_transition(terminal, target))

    def test_no_self_transitions_are_valid(self):
        for status in ALL_STATUSES:
            with self.subTest(status=status):
                self.assertFalse(is_valid_transition(status, status))

    def test_every_combination_not_in_the_named_six_is_invalid(self):
        named = {
            (None, LeaveStatus.PENDING),
            (None, LeaveStatus.APPROVED),
            (LeaveStatus.PENDING, LeaveStatus.APPROVED),
            (LeaveStatus.PENDING, LeaveStatus.REJECTED),
            (LeaveStatus.PENDING, LeaveStatus.CANCELLED),
            (LeaveStatus.APPROVED, LeaveStatus.CANCELLED),
        }
        all_froms = [None] + ALL_STATUSES
        for from_status, to_status in itertools.product(all_froms, ALL_STATUSES):
            with self.subTest(from_status=from_status, to_status=to_status):
                expected = (from_status, to_status) in named
                self.assertEqual(is_valid_transition(from_status, to_status), expected)


class ApiReachableTransitionsTest(TestCase):
    """The subset of the matrix actually reachable through Phase 2C's API surface (apply +
    cancel). PENDING->APPROVED and PENDING->REJECTED are valid in the matrix but have no
    triggering endpoint yet (Approvals phase) — confirmed absent by test_no_decide_endpoint_exists."""

    def setUp(self):
        self.dept = make_department()
        self.manager = make_manager(self.dept)
        self.employee = make_employee(self.dept, manager=self.manager)
        self.client_ = APIClient()
        self.client_.force_authenticate(user=self.employee)
        self.monday = _next_monday(timezone.now().date())

    def test_apply_reaches_none_to_pending(self):
        leave_type = make_leave_type(requires_approval=True)
        response = self.client_.post(
            "/api/leave-requests/",
            {"leave_type": leave_type.id, "start_date": self.monday.isoformat(), "end_date": self.monday.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "PENDING")

    def test_apply_reaches_none_to_approved_via_auto_approve(self):
        leave_type = make_leave_type(requires_approval=False)
        response = self.client_.post(
            "/api/leave-requests/",
            {"leave_type": leave_type.id, "start_date": self.monday.isoformat(), "end_date": self.monday.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "APPROVED")

    def test_cancel_reaches_pending_to_cancelled(self):
        leave_type = make_leave_type(requires_approval=True)
        request = LeaveRequest.objects.create(
            reference_number="LR-TEST-P2C", employee=self.employee, leave_type=leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=LeaveStatus.PENDING,
        )
        response = self.client_.post(f"/api/leave-requests/{request.id}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "CANCELLED")

    def test_cancel_reaches_approved_to_cancelled(self):
        leave_type = make_leave_type(requires_approval=False)
        request = LeaveRequest.objects.create(
            reference_number="LR-TEST-A2C", employee=self.employee, leave_type=leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=LeaveStatus.APPROVED,
        )
        response = self.client_.post(f"/api/leave-requests/{request.id}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "CANCELLED")

    def test_decide_reaches_pending_to_approved_and_pending_to_rejected(self):
        # Phase 2D: PENDING->APPROVED/REJECTED, valid in the matrix since Phase 2C, become
        # reachable via /decide/ for the first time. Full decide coverage lives in test_decide.py;
        # this just confirms the matrix's two remaining transitions are no longer API-unreachable.
        leave_type = make_leave_type(requires_approval=True)
        approved_request = LeaveRequest.objects.create(
            reference_number="LR-TEST-DEC-A", employee=self.employee, leave_type=leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=LeaveStatus.PENDING,
            approver=self.manager,
        )
        rejected_request = LeaveRequest.objects.create(
            reference_number="LR-TEST-DEC-R", employee=self.employee, leave_type=leave_type,
            start_date=self.monday + datetime.timedelta(days=7), end_date=self.monday + datetime.timedelta(days=7),
            days=1, status=LeaveStatus.PENDING, approver=self.manager,
        )
        manager_client = APIClient()
        manager_client.force_authenticate(user=self.manager)

        approve_response = manager_client.post(
            f"/api/leave-requests/{approved_request.id}/decide/", {"decision": "APPROVED"}, format="json"
        )
        self.assertEqual(approve_response.status_code, 200)
        self.assertEqual(approve_response.data["status"], "APPROVED")

        reject_response = manager_client.post(
            f"/api/leave-requests/{rejected_request.id}/decide/",
            {"decision": "REJECTED", "comment": "Not enough coverage that week."},
            format="json",
        )
        self.assertEqual(reject_response.status_code, 200)
        self.assertEqual(reject_response.data["status"], "REJECTED")
