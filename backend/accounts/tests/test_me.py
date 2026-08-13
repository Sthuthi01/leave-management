import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from departments.models import Department


class MeEndpointManagerNameTest(TestCase):
    """GET /api/auth/me/ must include manager_name (used by the Apply Leave Summary panel to
    show the assigned approver without a second employee lookup) — via EmployeeSerializer's
    existing manager_name field, not a new endpoint."""

    def setUp(self):
        self.department = Department.objects.create(name="Engineering")
        self.manager = Employee.objects.create_user(
            email="manager@example.com", name="Manager One", password="Pass1234567",
            role=Role.MANAGER, title="Engineering Manager", department=self.department,
            joined_at=datetime.date(2015, 1, 1),
        )
        self.client_ = APIClient()

    def test_me_includes_manager_name_when_manager_assigned(self):
        employee = Employee.objects.create_user(
            email="employee@example.com", name="Employee One", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.department, manager=self.manager,
            joined_at=datetime.date(2020, 1, 1),
        )
        self.client_.force_authenticate(user=employee)
        response = self.client_.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["manager"], self.manager.id)
        self.assertEqual(response.data["manager_name"], "Manager One")

    def test_me_manager_name_is_none_when_no_manager_assigned(self):
        lone_employee = Employee.objects.create_user(
            email="lone@example.com", name="Lone Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.department, manager=None,
            joined_at=datetime.date(2020, 1, 1),
        )
        self.client_.force_authenticate(user=lone_employee)
        response = self.client_.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data["manager"])
        self.assertIsNone(response.data["manager_name"])
