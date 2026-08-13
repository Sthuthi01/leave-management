from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from departments.models import Department


class DepartmentCrudTest(TestCase):
    """Phase 1.5 P0: Department CRUD. GET is open to any authenticated employee (matches the
    source app); POST/PATCH/DELETE are ADMIN-only."""

    def setUp(self):
        self.department = Department.objects.create(name="Engineering")
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.department,
        )
        self.employee = Employee.objects.create_user(
            email="employee@example.com", name="Regular Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.department,
        )
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    def test_any_authenticated_employee_can_list(self):
        response = self.employee_client.get("/api/departments/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_anonymous_cannot_list(self):
        response = APIClient().get("/api/departments/")
        self.assertIn(response.status_code, (401, 403))

    def test_admin_can_create(self):
        response = self.admin_client.post("/api/departments/", {"name": "Sales"}, format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Department.objects.count(), 2)

    def test_employee_cannot_create(self):
        response = self.employee_client.post("/api/departments/", {"name": "Sales"}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Department.objects.count(), 1)

    def test_duplicate_name_rejected(self):
        response = self.admin_client.post("/api/departments/", {"name": "Engineering"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_duplicate_name_rejected_case_insensitively(self):
        response = self.admin_client.post("/api/departments/", {"name": "engineering"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Department.objects.count(), 1)

    def test_duplicate_name_rejected_case_insensitively_mixed_case(self):
        response = self.admin_client.post("/api/departments/", {"name": "EngineerinG"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Department.objects.count(), 1)

    def test_rename_to_another_departments_name_rejected_case_insensitively(self):
        other = Department.objects.create(name="Marketing")
        response = self.admin_client.patch(f"/api/departments/{other.id}/", {"name": "engineering"}, format="json")
        self.assertEqual(response.status_code, 400)
        other.refresh_from_db()
        self.assertEqual(other.name, "Marketing")

    def test_renaming_a_department_to_its_own_name_with_different_case_is_allowed(self):
        # Excludes self from the duplicate check, so "Engineering" -> "engineering" is a legitimate
        # case-only rename, not a false collision with itself.
        response = self.admin_client.patch(f"/api/departments/{self.department.id}/", {"name": "engineering"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.department.refresh_from_db()
        self.assertEqual(self.department.name, "engineering")

    def test_admin_can_rename(self):
        response = self.admin_client.patch(f"/api/departments/{self.department.id}/", {"name": "Product Engineering"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.department.refresh_from_db()
        self.assertEqual(self.department.name, "Product Engineering")

    def test_employee_cannot_rename(self):
        response = self.employee_client.patch(f"/api/departments/{self.department.id}/", {"name": "Hacked"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_delete_empty_department(self):
        empty = Department.objects.create(name="Marketing")
        response = self.admin_client.delete(f"/api/departments/{empty.id}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Department.objects.filter(id=empty.id).exists())

    def test_deleting_department_with_employees_is_rejected_cleanly(self):
        # self.department has both self.admin and self.employee assigned to it.
        response = self.admin_client.delete(f"/api/departments/{self.department.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Department.objects.filter(id=self.department.id).exists())

    def test_employee_cannot_delete(self):
        response = self.employee_client.delete(f"/api/departments/{self.department.id}/")
        self.assertEqual(response.status_code, 403)
