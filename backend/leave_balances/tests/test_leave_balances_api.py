import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from departments.models import Department
from leave_types.models import AccrualMethod, LeaveType

from ..models import LeaveBalance


class LeaveBalancesApiTest(TestCase):
    def setUp(self):
        self.dept = Department.objects.create(name="Engineering")
        self.active_type = LeaveType.objects.create(
            name="Annual Leave", code="AL", default_days_per_year=12, is_active=True,
        )
        self.inactive_type = LeaveType.objects.create(
            name="Retired Leave", code="RL", default_days_per_year=5, is_active=False,
        )
        self.employee = Employee.objects.create_user(
            email="employee@example.com", name="Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.dept, joined_at=datetime.date(2020, 1, 1),
        )
        self.other_employee = Employee.objects.create_user(
            email="other@example.com", name="Other", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.dept, joined_at=datetime.date(2020, 1, 1),
        )
        self.client_ = APIClient()
        self.client_.force_authenticate(user=self.employee)

    def test_lists_own_balances_only_for_active_leave_types(self):
        response = self.client_.get("/api/leave-balances/")
        self.assertEqual(response.status_code, 200)
        codes = [row["leave_type"]["code"] for row in response.data]
        self.assertEqual(codes, ["AL"])

    def test_balance_rows_are_lazily_created_on_first_view(self):
        self.assertEqual(LeaveBalance.objects.filter(employee=self.employee).count(), 0)
        self.client_.get("/api/leave-balances/")
        self.assertEqual(LeaveBalance.objects.filter(employee=self.employee).count(), 1)

    def test_response_includes_computed_fields(self):
        response = self.client_.get("/api/leave-balances/")
        row = response.data[0]
        self.assertIn("accrued_to_date", row)
        self.assertIn("remaining", row)
        self.assertEqual(row["allocated"], 12)

    def test_does_not_leak_other_employees_balances(self):
        self.client_.get("/api/leave-balances/")
        other_client = APIClient()
        other_client.force_authenticate(user=self.other_employee)
        other_client.get("/api/leave-balances/")
        response = self.client_.get("/api/leave-balances/")
        self.assertEqual(len(response.data), 1)  # only the caller's own row, not the other employee's

    def test_anonymous_blocked(self):
        response = APIClient().get("/api/leave-balances/")
        self.assertIn(response.status_code, (401, 403))
