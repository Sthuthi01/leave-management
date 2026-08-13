import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from ..models import LeaveRequest, LeaveStatus
from .helpers import make_department, make_employee, make_leave_type, make_manager


def _next_monday(after: datetime.date) -> datetime.date:
    days_ahead = (7 - after.weekday()) % 7 or 7
    return after + datetime.timedelta(days=days_ahead)


class LeaveRequestDetailTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.manager = make_manager(self.dept)
        self.employee = make_employee(self.dept, manager=self.manager)
        self.other_employee = make_employee(self.dept, manager=self.manager, email="other@example.com")
        self.leave_type = make_leave_type(requires_approval=True)
        self.monday = _next_monday(timezone.now().date())
        self.own_request = LeaveRequest.objects.create(
            reference_number="LR-TEST-OWN", employee=self.employee, leave_type=self.leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=LeaveStatus.PENDING,
        )
        self.other_request = LeaveRequest.objects.create(
            reference_number="LR-TEST-OTHER", employee=self.other_employee, leave_type=self.leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=LeaveStatus.PENDING,
        )
        self.client_ = APIClient()
        self.client_.force_authenticate(user=self.employee)

    def test_can_view_own_request(self):
        response = self.client_.get(f"/api/leave-requests/{self.own_request.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["reference_number"], "LR-TEST-OWN")

    def test_cannot_view_another_employees_request(self):
        response = self.client_.get(f"/api/leave-requests/{self.other_request.id}/")
        self.assertEqual(response.status_code, 404)

    def test_list_returns_only_own_requests(self):
        response = self.client_.get("/api/leave-requests/")
        self.assertEqual(response.status_code, 200)
        refs = [row["reference_number"] for row in response.data]
        self.assertEqual(refs, ["LR-TEST-OWN"])

    def test_list_filters_by_status(self):
        LeaveRequest.objects.create(
            reference_number="LR-TEST-APPROVED", employee=self.employee, leave_type=self.leave_type,
            start_date=self.monday + datetime.timedelta(days=7), end_date=self.monday + datetime.timedelta(days=7),
            days=1, status=LeaveStatus.APPROVED,
        )
        response = self.client_.get("/api/leave-requests/?status=APPROVED")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]["status"], "APPROVED")

    def test_anonymous_blocked(self):
        response = APIClient().get(f"/api/leave-requests/{self.own_request.id}/")
        self.assertIn(response.status_code, (401, 403))
