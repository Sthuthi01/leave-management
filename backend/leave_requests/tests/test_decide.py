import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from leave_balances.services import get_or_create_balance

from ..models import LeaveRequest, LeaveStatus
from .helpers import make_department, make_employee, make_leave_type, make_manager


def _next_monday(after: datetime.date) -> datetime.date:
    days_ahead = (7 - after.weekday()) % 7 or 7
    return after + datetime.timedelta(days=days_ahead)


class DecideLeaveRequestTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.manager = make_manager(self.dept)
        self.other_manager = make_manager(self.dept, email="other-manager@example.com")
        self.employee = make_employee(self.dept, manager=self.manager)
        self.monday = _next_monday(timezone.now().date())
        self.manager_client = APIClient()
        self.manager_client.force_authenticate(user=self.manager)
        self.other_manager_client = APIClient()
        self.other_manager_client.force_authenticate(user=self.other_manager)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    def _pending(self, leave_type, *, employee=None, approver=None, start=None, ref="LR-TEST-D"):
        return LeaveRequest.objects.create(
            reference_number=ref, employee=employee or self.employee, leave_type=leave_type,
            start_date=start or self.monday, end_date=start or self.monday, days=1,
            status=LeaveStatus.PENDING, approver=approver if approver is not None else self.manager,
        )

    def _decide(self, client, request_id, decision, comment=None):
        payload = {"decision": decision}
        if comment is not None:
            payload["comment"] = comment
        return client.post(f"/api/leave-requests/{request_id}/decide/", payload, format="json")

    # --- happy paths ---

    def test_manager_approves_capped_leave_type_increments_balance(self):
        leave_type = make_leave_type(requires_approval=True, default_days_per_year=10)
        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        request = self._pending(leave_type)

        response = self._decide(self.manager_client, request.id, "APPROVED")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "APPROVED")
        balance.refresh_from_db()
        self.assertEqual(balance.used, 1)

    def test_manager_approves_uncapped_leave_type_does_not_touch_balance(self):
        leave_type = make_leave_type(requires_approval=True, default_days_per_year=0)
        request = self._pending(leave_type)
        response = self._decide(self.manager_client, request.id, "APPROVED")
        self.assertEqual(response.status_code, 200)

    def test_manager_rejects_with_comment(self):
        leave_type = make_leave_type(requires_approval=True, default_days_per_year=10)
        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        request = self._pending(leave_type)

        response = self._decide(self.manager_client, request.id, "REJECTED", comment="Team is short-staffed that week.")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "REJECTED")
        self.assertEqual(response.data["approver_comment"], "Team is short-staffed that week.")
        balance.refresh_from_db()
        self.assertEqual(balance.used, 0)  # rejection never touches balance

    def test_approve_response_includes_employee_info(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        response = self._decide(self.manager_client, request.id, "APPROVED")
        self.assertEqual(response.data["employee"]["id"], self.employee.id)

    def test_decided_at_is_set(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        self._decide(self.manager_client, request.id, "APPROVED")
        request.refresh_from_db()
        self.assertIsNotNone(request.decided_at)

    # --- validation failures ---

    def test_reject_without_comment_rejected(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        response = self._decide(self.manager_client, request.id, "REJECTED")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "COMMENT_REQUIRED")
        request.refresh_from_db()
        self.assertEqual(request.status, LeaveStatus.PENDING)

    def test_reject_with_blank_comment_rejected(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        response = self._decide(self.manager_client, request.id, "REJECTED", comment="   ")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "COMMENT_REQUIRED")

    def test_approve_without_comment_is_fine(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        response = self._decide(self.manager_client, request.id, "APPROVED")
        self.assertEqual(response.status_code, 200)

    def test_invalid_decision_value_rejected(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        response = self._decide(self.manager_client, request.id, "MAYBE")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "INVALID_DECISION")

    def test_decide_nonexistent_request_404s(self):
        response = self._decide(self.manager_client, 999999, "APPROVED")
        self.assertEqual(response.status_code, 404)

    # --- RBAC ---

    def test_employee_cannot_approve_own_request(self):
        leave_type = make_leave_type(requires_approval=True)
        # Contrived: assign the employee themself as approver to exercise the defense-in-depth
        # self-approval guard even though this can't happen via normal apply().
        request = self._pending(leave_type, approver=self.employee)
        response = self._decide(self.employee_client, request.id, "APPROVED")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["code"], "SELF_APPROVAL")

    def test_non_assigned_manager_cannot_decide(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)  # approver = self.manager
        response = self._decide(self.other_manager_client, request.id, "APPROVED")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["code"], "FORBIDDEN")
        request.refresh_from_db()
        self.assertEqual(request.status, LeaveStatus.PENDING)

    def test_admin_who_is_not_the_approver_cannot_decide(self):
        # No ADMIN bypass — matches source exactly (confirmed via research).
        from accounts.models import Role
        admin = make_employee(self.dept, manager=self.manager, email="admin@example.com")
        admin.role = Role.ADMIN
        admin.save(update_fields=["role"])
        admin_client = APIClient()
        admin_client.force_authenticate(user=admin)

        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        response = self._decide(admin_client, request.id, "APPROVED")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["code"], "FORBIDDEN")

    def test_employee_cannot_decide_someone_elses_request(self):
        leave_type = make_leave_type(requires_approval=True)
        other_employee = make_employee(self.dept, manager=self.manager, email="other-emp@example.com")
        request = self._pending(leave_type, employee=other_employee)
        response = self._decide(self.employee_client, request.id, "APPROVED")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["code"], "FORBIDDEN")

    def test_anonymous_cannot_decide(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        response = APIClient().post(f"/api/leave-requests/{request.id}/decide/", {"decision": "APPROVED"}, format="json")
        self.assertIn(response.status_code, (401, 403))

    # --- status transitions ---

    def test_cannot_approve_already_approved_request(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        first = self._decide(self.manager_client, request.id, "APPROVED")
        self.assertEqual(first.status_code, 200)
        second = self._decide(self.manager_client, request.id, "APPROVED")
        self.assertEqual(second.status_code, 400)
        self.assertEqual(second.data["code"], "ALREADY_DECIDED")

    def test_cannot_reject_already_rejected_request(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        self._decide(self.manager_client, request.id, "REJECTED", comment="No.")
        response = self._decide(self.manager_client, request.id, "REJECTED", comment="Still no.")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "ALREADY_DECIDED")

    def test_cannot_approve_a_rejected_request(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        self._decide(self.manager_client, request.id, "REJECTED", comment="No.")
        response = self._decide(self.manager_client, request.id, "APPROVED")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "ALREADY_DECIDED")

    def test_cannot_decide_a_cancelled_request(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._pending(leave_type)
        self.employee_client.post(f"/api/leave-requests/{request.id}/cancel/")
        response = self._decide(self.manager_client, request.id, "APPROVED")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "ALREADY_DECIDED")

    # --- approval-time balance protection ---

    def test_approval_rejected_when_balance_insufficient_at_decision_time(self):
        leave_type = make_leave_type(requires_approval=True, default_days_per_year=1)
        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        request = self._pending(leave_type)  # 1 day, exactly matches the 1-day allocation
        # Balance gets consumed by something else between apply and decide.
        balance.used = 1
        balance.save(update_fields=["used"])

        response = self._decide(self.manager_client, request.id, "APPROVED")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data["code"], "INSUFFICIENT_BALANCE")
        request.refresh_from_db()
        self.assertEqual(request.status, LeaveStatus.PENDING)  # left untouched, still decidable
        balance.refresh_from_db()
        self.assertEqual(balance.used, 1)  # unchanged

    def test_rejecting_a_request_never_checks_balance(self):
        leave_type = make_leave_type(requires_approval=True, default_days_per_year=1)
        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        balance.used = 1  # already fully consumed
        balance.save(update_fields=["used"])
        request = self._pending(leave_type)

        response = self._decide(self.manager_client, request.id, "REJECTED", comment="No.")
        self.assertEqual(response.status_code, 200)  # rejection always succeeds regardless of balance

    def test_approval_still_possible_after_a_prior_rejected_sibling_freed_no_balance(self):
        # Sanity check: rejecting one request doesn't affect another's approvability.
        leave_type = make_leave_type(requires_approval=True, default_days_per_year=2)
        get_or_create_balance(self.employee, leave_type, self.monday.year)
        request_a = self._pending(leave_type, start=self.monday, ref="LR-TEST-DA")
        request_b = self._pending(leave_type, start=self.monday + datetime.timedelta(days=1), ref="LR-TEST-DB")

        self._decide(self.manager_client, request_a.id, "REJECTED", comment="No.")
        response = self._decide(self.manager_client, request_b.id, "APPROVED")
        self.assertEqual(response.status_code, 200)

    # --- interaction with cancellation (regression) ---

    def test_cancel_after_approve_still_refunds(self):
        leave_type = make_leave_type(requires_approval=True, default_days_per_year=10)
        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        request = self._pending(leave_type)
        self._decide(self.manager_client, request.id, "APPROVED")
        balance.refresh_from_db()
        self.assertEqual(balance.used, 1)

        cancel_response = self.employee_client.post(f"/api/leave-requests/{request.id}/cancel/")
        self.assertEqual(cancel_response.status_code, 200)
        balance.refresh_from_db()
        self.assertEqual(balance.used, 0)


class ApprovalsScopeListTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.manager = make_manager(self.dept)
        self.other_manager = make_manager(self.dept, email="other-manager@example.com")
        self.employee = make_employee(self.dept, manager=self.manager)
        self.monday = _next_monday(timezone.now().date())
        self.leave_type = make_leave_type(requires_approval=True)
        self.assigned = LeaveRequest.objects.create(
            reference_number="LR-TEST-SCOPE-1", employee=self.employee, leave_type=self.leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=LeaveStatus.PENDING, approver=self.manager,
        )
        self.not_assigned = LeaveRequest.objects.create(
            reference_number="LR-TEST-SCOPE-2", employee=self.employee, leave_type=self.leave_type,
            start_date=self.monday + datetime.timedelta(days=7), end_date=self.monday + datetime.timedelta(days=7),
            days=1, status=LeaveStatus.PENDING, approver=self.other_manager,
        )
        self.manager_client = APIClient()
        self.manager_client.force_authenticate(user=self.manager)

    def test_scope_approvals_returns_only_assigned_requests(self):
        response = self.manager_client.get("/api/leave-requests/?scope=approvals")
        self.assertEqual(response.status_code, 200)
        refs = [row["reference_number"] for row in response.data]
        self.assertEqual(refs, ["LR-TEST-SCOPE-1"])

    def test_scope_approvals_combined_with_status_filter(self):
        self.manager_client.post(f"/api/leave-requests/{self.assigned.id}/decide/", {"decision": "APPROVED"}, format="json")
        response = self.manager_client.get("/api/leave-requests/?scope=approvals&status=PENDING")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 0)

    def test_default_scope_is_unaffected_by_approvals_scope_addition(self):
        # Regression: ?scope=mine (or no scope) must still behave exactly as Phase 2C left it.
        employee_client = APIClient()
        employee_client.force_authenticate(user=self.employee)
        response = employee_client.get("/api/leave-requests/")
        self.assertEqual(response.status_code, 200)
        refs = {row["reference_number"] for row in response.data}
        self.assertEqual(refs, {"LR-TEST-SCOPE-1", "LR-TEST-SCOPE-2"})

    def test_anonymous_cannot_list_approvals(self):
        response = APIClient().get("/api/leave-requests/?scope=approvals")
        self.assertIn(response.status_code, (401, 403))

    def test_approvals_scope_embeds_employee_department(self):
        # The Approvals page's department filter (Phase 8/Prompt 1 restoration) needs the
        # requesting employee's department embedded in each row.
        response = self.manager_client.get("/api/leave-requests/?scope=approvals")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["employee"]["department"]["id"], self.dept.id)
        self.assertEqual(response.data[0]["employee"]["department"]["name"], self.dept.name)
