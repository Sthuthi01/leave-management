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


class CancelLeaveRequestTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.manager = make_manager(self.dept)
        self.employee = make_employee(self.dept, manager=self.manager)
        self.other_employee = make_employee(self.dept, manager=self.manager, email="other@example.com")
        self.client_ = APIClient()
        self.client_.force_authenticate(user=self.employee)
        self.monday = _next_monday(timezone.now().date())

    def _create(self, status, leave_type, *, employee=None):
        employee = employee or self.employee
        request = LeaveRequest.objects.create(
            reference_number=f"LR-TEST-{status}", employee=employee, leave_type=leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=status,
        )
        return request

    def test_cancel_pending_does_not_touch_balance(self):
        leave_type = make_leave_type(requires_approval=True, default_days_per_year=10)
        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        balance.used = 0
        balance.save(update_fields=["used"])
        request = self._create(LeaveStatus.PENDING, leave_type)

        response = self.client_.post(f"/api/leave-requests/{request.id}/cancel/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["status"], "CANCELLED")
        balance.refresh_from_db()
        self.assertEqual(balance.used, 0)

    def test_cancel_approved_refunds_balance(self):
        leave_type = make_leave_type(requires_approval=False, default_days_per_year=10)
        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        balance.used = 3
        balance.save(update_fields=["used"])
        request = self._create(LeaveStatus.APPROVED, leave_type)

        response = self.client_.post(f"/api/leave-requests/{request.id}/cancel/")
        self.assertEqual(response.status_code, 200)
        balance.refresh_from_db()
        self.assertEqual(balance.used, 2)  # 3 - 1 day refunded

    def test_cancel_refund_never_goes_negative(self):
        leave_type = make_leave_type(requires_approval=False, default_days_per_year=10)
        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        balance.used = 0  # already 0, refunding would go negative without the clamp
        balance.save(update_fields=["used"])
        request = self._create(LeaveStatus.APPROVED, leave_type)

        response = self.client_.post(f"/api/leave-requests/{request.id}/cancel/")
        self.assertEqual(response.status_code, 200)
        balance.refresh_from_db()
        self.assertEqual(balance.used, 0)

    def test_cancel_uncapped_leave_type_does_not_touch_balance(self):
        leave_type = make_leave_type(requires_approval=False, default_days_per_year=0)
        request = self._create(LeaveStatus.APPROVED, leave_type)
        response = self.client_.post(f"/api/leave-requests/{request.id}/cancel/")
        self.assertEqual(response.status_code, 200)  # no balance row exists at all; must not error

    def test_cancel_already_cancelled_rejected(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._create(LeaveStatus.CANCELLED, leave_type)
        response = self.client_.post(f"/api/leave-requests/{request.id}/cancel/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "INVALID_STATUS")

    def test_cancel_rejected_request_rejected(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._create(LeaveStatus.REJECTED, leave_type)
        response = self.client_.post(f"/api/leave-requests/{request.id}/cancel/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "INVALID_STATUS")

    def test_cancel_someone_elses_request_forbidden(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._create(LeaveStatus.PENDING, leave_type, employee=self.other_employee)
        response = self.client_.post(f"/api/leave-requests/{request.id}/cancel/")
        self.assertEqual(response.status_code, 403)
        request.refresh_from_db()
        self.assertEqual(request.status, LeaveStatus.PENDING)

    def test_cancel_nonexistent_request_404s(self):
        response = self.client_.post("/api/leave-requests/999999/cancel/")
        self.assertEqual(response.status_code, 404)

    def test_anonymous_cannot_cancel(self):
        leave_type = make_leave_type(requires_approval=True)
        request = self._create(LeaveStatus.PENDING, leave_type)
        response = APIClient().post(f"/api/leave-requests/{request.id}/cancel/")
        self.assertIn(response.status_code, (401, 403))
