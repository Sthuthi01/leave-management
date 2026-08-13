from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from departments.models import Department


class EmployeeCreateRoleManagerTest(TestCase):
    """Prompt 5 item 1: the Add-employee modal gained Role and Manager fields, matching the
    Edit modal (EmployeeCreateSerializer already accepted both — this proves they actually
    persist end-to-end through POST /api/employees/, not just accepted-and-discarded)."""

    def setUp(self):
        self.dept = Department.objects.create(name="Engineering")
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept,
        )
        self.manager = Employee.objects.create_user(
            email="manager@example.com", name="Manager", password="ManagerPass123",
            role=Role.MANAGER, title="Eng Manager", department=self.dept,
        )
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)

    def test_role_and_manager_persist_on_create(self):
        response = self.admin_client.post(
            "/api/employees/",
            {
                "name": "New Hire",
                "email": "new.hire@example.com",
                "title": "Engineer",
                "department": self.dept.id,
                "manager": self.manager.id,
                "role": "MANAGER",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["role"], "MANAGER")
        self.assertEqual(response.data["manager"], self.manager.id)

        created = Employee.objects.get(email="new.hire@example.com")
        self.assertEqual(created.role, Role.MANAGER)
        self.assertEqual(created.manager_id, self.manager.id)

    def test_role_defaults_to_employee_and_manager_defaults_to_none_when_omitted(self):
        response = self.admin_client.post(
            "/api/employees/",
            {"name": "Another Hire", "email": "another.hire@example.com", "title": "Engineer", "department": self.dept.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["role"], "EMPLOYEE")
        self.assertIsNone(response.data["manager"])
