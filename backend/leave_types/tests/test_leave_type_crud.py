from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from departments.models import Department
from leave_types.models import AccrualMethod, LeaveType


class LeaveTypeCrudTest(TestCase):
    """Phase 2A: Leave Types. GET is open to any authenticated employee; POST/PATCH/DELETE are
    ADMIN-only, mirroring the departments app pattern."""

    def setUp(self):
        dept = Department.objects.create(name="Engineering")
        self.leave_type = LeaveType.objects.create(
            name="Annual Leave", code="AL", default_days_per_year=20, carry_forward_limit=5
        )
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=dept,
        )
        self.employee = Employee.objects.create_user(
            email="employee@example.com", name="Regular Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=dept,
        )
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    def _url(self, leave_type=None):
        return f"/api/leave-types/{leave_type.id}/" if leave_type else "/api/leave-types/"

    def test_any_authenticated_employee_can_list(self):
        response = self.employee_client.get(self._url())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_anonymous_cannot_list(self):
        response = APIClient().get(self._url())
        self.assertIn(response.status_code, (401, 403))

    def test_admin_can_create(self):
        response = self.admin_client.post(
            self._url(),
            {"name": "Sick Leave", "code": "SL", "default_days_per_year": 10, "carry_forward_limit": 0},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(LeaveType.objects.count(), 2)

    def test_employee_cannot_create(self):
        response = self.employee_client.post(
            self._url(), {"name": "Sick Leave", "code": "SL", "default_days_per_year": 10}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(LeaveType.objects.count(), 1)

    def test_duplicate_name_rejected(self):
        response = self.admin_client.post(
            self._url(), {"name": "Annual Leave", "code": "AL2", "default_days_per_year": 10}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_duplicate_code_rejected(self):
        response = self.admin_client.post(
            self._url(), {"name": "Other Leave", "code": "AL", "default_days_per_year": 10}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_carry_forward_exceeding_default_days_rejected(self):
        response = self.admin_client.post(
            self._url(),
            {"name": "Casual Leave", "code": "CL", "default_days_per_year": 5, "carry_forward_limit": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_invalid_color_rejected(self):
        response = self.admin_client.post(
            self._url(),
            {"name": "Casual Leave", "code": "CL", "default_days_per_year": 5, "color": "not-a-color"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_code_normalized_to_uppercase(self):
        response = self.admin_client.post(
            self._url(), {"name": "Casual Leave", "code": "cl", "default_days_per_year": 5}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["code"], "CL")

    def test_accrual_method_choice(self):
        response = self.admin_client.post(
            self._url(),
            {"name": "Casual Leave", "code": "CL", "default_days_per_year": 5, "accrual_method": AccrualMethod.MONTHLY},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["accrual_method"], AccrualMethod.MONTHLY)

    def test_admin_can_edit(self):
        response = self.admin_client.patch(self._url(self.leave_type), {"default_days_per_year": 25}, format="json")
        self.assertEqual(response.status_code, 200)
        self.leave_type.refresh_from_db()
        self.assertEqual(self.leave_type.default_days_per_year, 25)

    def test_employee_cannot_edit(self):
        response = self.employee_client.patch(self._url(self.leave_type), {"default_days_per_year": 25}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_deactivate(self):
        response = self.admin_client.patch(self._url(self.leave_type), {"is_active": False}, format="json")
        self.assertEqual(response.status_code, 200)
        self.leave_type.refresh_from_db()
        self.assertFalse(self.leave_type.is_active)

    def test_admin_can_reactivate(self):
        self.leave_type.is_active = False
        self.leave_type.save(update_fields=["is_active"])
        response = self.admin_client.patch(self._url(self.leave_type), {"is_active": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.leave_type.refresh_from_db()
        self.assertTrue(self.leave_type.is_active)

    def test_admin_can_delete_when_unreferenced(self):
        response = self.admin_client.delete(self._url(self.leave_type))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(LeaveType.objects.filter(id=self.leave_type.id).exists())

    def test_employee_cannot_delete(self):
        response = self.employee_client.delete(self._url(self.leave_type))
        self.assertEqual(response.status_code, 403)
        self.assertTrue(LeaveType.objects.filter(id=self.leave_type.id).exists())

    def test_anonymous_cannot_create_edit_or_delete(self):
        anon = APIClient()
        self.assertIn(
            anon.post(self._url(), {"name": "X", "code": "X", "default_days_per_year": 1}, format="json").status_code,
            (401, 403),
        )
        self.assertIn(anon.patch(self._url(self.leave_type), {"name": "X"}, format="json").status_code, (401, 403))
        self.assertIn(anon.delete(self._url(self.leave_type)).status_code, (401, 403))
