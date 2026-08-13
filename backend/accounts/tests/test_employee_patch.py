from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, EmployeeStatus, Role
from departments.models import Department


class EmployeePatchTest(TestCase):
    """Phase 2A: Employee PATCH. ADMIN-only, with self-restriction guards on status/role."""

    def setUp(self):
        self.dept = Department.objects.create(name="Engineering")
        self.other_dept = Department.objects.create(name="Sales")
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept,
        )
        self.manager = Employee.objects.create_user(
            email="manager@example.com", name="Manager", password="ManagerPass123",
            role=Role.MANAGER, title="Eng Manager", department=self.dept,
        )
        self.employee = Employee.objects.create_user(
            email="employee@example.com", name="Regular Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.dept,
        )
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    def _url(self, employee):
        return f"/api/employees/{employee.id}/"

    def test_admin_can_edit_details(self):
        response = self.admin_client.patch(
            self._url(self.employee), {"name": "Renamed Employee", "title": "Senior Engineer"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.name, "Renamed Employee")
        self.assertEqual(self.employee.title, "Senior Engineer")

    def test_admin_can_change_department(self):
        response = self.admin_client.patch(self._url(self.employee), {"department": self.other_dept.id}, format="json")
        self.assertEqual(response.status_code, 200)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.department_id, self.other_dept.id)

    def test_admin_can_assign_manager(self):
        response = self.admin_client.patch(self._url(self.employee), {"manager": self.manager.id}, format="json")
        self.assertEqual(response.status_code, 200)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.manager_id, self.manager.id)

    def test_admin_can_clear_manager(self):
        self.employee.manager = self.manager
        self.employee.save(update_fields=["manager"])
        response = self.admin_client.patch(self._url(self.employee), {"manager": None}, format="json")
        self.assertEqual(response.status_code, 200)
        self.employee.refresh_from_db()
        self.assertIsNone(self.employee.manager_id)

    def test_admin_can_deactivate_employee(self):
        response = self.admin_client.patch(self._url(self.employee), {"status": EmployeeStatus.INACTIVE}, format="json")
        self.assertEqual(response.status_code, 200)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.status, EmployeeStatus.INACTIVE)

    def test_admin_can_reactivate_employee(self):
        self.employee.status = EmployeeStatus.INACTIVE
        self.employee.save(update_fields=["status"])
        response = self.admin_client.patch(self._url(self.employee), {"status": EmployeeStatus.ACTIVE}, format="json")
        self.assertEqual(response.status_code, 200)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.status, EmployeeStatus.ACTIVE)

    def test_admin_can_change_role(self):
        response = self.admin_client.patch(self._url(self.employee), {"role": Role.MANAGER}, format="json")
        self.assertEqual(response.status_code, 200)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.role, Role.MANAGER)

    def test_non_admin_cannot_patch_others(self):
        response = self.employee_client.patch(self._url(self.manager), {"title": "Hacked"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_non_admin_cannot_patch_self(self):
        response = self.employee_client.patch(self._url(self.employee), {"title": "Self Edit"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_anonymous_cannot_patch(self):
        response = APIClient().patch(self._url(self.employee), {"title": "Anon Edit"}, format="json")
        self.assertIn(response.status_code, (401, 403))

    def test_admin_cannot_deactivate_self(self):
        response = self.admin_client.patch(self._url(self.admin), {"status": EmployeeStatus.INACTIVE}, format="json")
        self.assertEqual(response.status_code, 400)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.status, EmployeeStatus.ACTIVE)

    def test_cannot_deactivate_manager_with_active_direct_reports(self):
        self.employee.manager = self.manager
        self.employee.save(update_fields=["manager"])
        response = self.admin_client.patch(self._url(self.manager), {"status": EmployeeStatus.INACTIVE}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("Reassign this person's direct reports", str(response.data))
        self.manager.refresh_from_db()
        self.assertEqual(self.manager.status, EmployeeStatus.ACTIVE)

    def test_can_deactivate_manager_once_direct_reports_are_reassigned(self):
        self.employee.manager = self.manager
        self.employee.save(update_fields=["manager"])
        self.employee.manager = None
        self.employee.save(update_fields=["manager"])
        response = self.admin_client.patch(self._url(self.manager), {"status": EmployeeStatus.INACTIVE}, format="json")
        self.assertEqual(response.status_code, 200)
        self.manager.refresh_from_db()
        self.assertEqual(self.manager.status, EmployeeStatus.INACTIVE)

    def test_can_deactivate_manager_whose_direct_reports_are_already_inactive(self):
        self.employee.manager = self.manager
        self.employee.status = EmployeeStatus.INACTIVE
        self.employee.save(update_fields=["manager", "status"])
        response = self.admin_client.patch(self._url(self.manager), {"status": EmployeeStatus.INACTIVE}, format="json")
        self.assertEqual(response.status_code, 200)
        self.manager.refresh_from_db()
        self.assertEqual(self.manager.status, EmployeeStatus.INACTIVE)

    def test_admin_cannot_change_own_role_away_from_admin(self):
        response = self.admin_client.patch(self._url(self.admin), {"role": Role.EMPLOYEE}, format="json")
        self.assertEqual(response.status_code, 400)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.role, Role.ADMIN)

    def test_admin_can_edit_own_non_restricted_fields(self):
        response = self.admin_client.patch(self._url(self.admin), {"title": "Chief HR Admin"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.admin.refresh_from_db()
        self.assertEqual(self.admin.title, "Chief HR Admin")

    def test_cannot_be_own_manager(self):
        response = self.admin_client.patch(self._url(self.employee), {"manager": self.employee.id}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_invalid_department_rejected(self):
        response = self.admin_client.patch(self._url(self.employee), {"department": 999999}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_invalid_manager_rejected(self):
        response = self.admin_client.patch(self._url(self.employee), {"manager": 999999}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_email_not_editable_via_patch(self):
        response = self.admin_client.patch(
            self._url(self.employee), {"email": "changed@example.com"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.employee.refresh_from_db()
        self.assertEqual(self.employee.email, "employee@example.com")

    def test_patch_response_uses_read_serializer_shape(self):
        response = self.admin_client.patch(self._url(self.employee), {"title": "Engineer II"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertIn("department", response.data)
        self.assertIsInstance(response.data["department"], dict)
        self.assertNotIn("password", response.data)
