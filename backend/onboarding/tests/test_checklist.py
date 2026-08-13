"""Rule 7: a checklist currently assigned to any employee cannot be deleted. Also covers the
list/detail RBAC split — list is open to any authenticated user (the employee-form picker needs
it), but the single-checklist detail route is admin-only even for GET, matching the source."""

from django.test import TestCase
from rest_framework.test import APIClient

from onboarding.models import Checklist
from onboarding.tests.helpers import make_admin, make_checklist, make_department, make_employee


class ChecklistRbacTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.employee = make_employee(self.dept)
        self.checklist = make_checklist()
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    def test_any_authenticated_user_can_list_checklists(self):
        response = self.employee_client.get("/api/onboarding/checklists/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_unauthenticated_list_rejected(self):
        response = APIClient().get("/api/onboarding/checklists/")
        self.assertIn(response.status_code, (401, 403))

    def test_employee_cannot_create_checklist(self):
        response = self.employee_client.post("/api/onboarding/checklists/", {"name": "x"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_create_checklist(self):
        response = self.admin_client.post("/api/onboarding/checklists/", {"name": "Sales Onboarding"}, format="json")
        self.assertEqual(response.status_code, 201)

    def test_employee_cannot_view_checklist_detail(self):
        # Detail is admin-only even for GET — deliberately stricter than the list route.
        response = self.employee_client.get(f"/api/onboarding/checklists/{self.checklist.id}/")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_view_checklist_detail(self):
        response = self.admin_client.get(f"/api/onboarding/checklists/{self.checklist.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertIn("tasks", response.data)
        self.assertIn("assigned_employee_count", response.data)

    def test_employee_cannot_edit_or_delete(self):
        response = self.employee_client.patch(
            f"/api/onboarding/checklists/{self.checklist.id}/", {"name": "Hacked"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        response = self.employee_client.delete(f"/api/onboarding/checklists/{self.checklist.id}/")
        self.assertEqual(response.status_code, 403)


class ChecklistDeleteGuardTest(TestCase):
    """Rule 7."""

    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_unassigned_checklist_can_be_deleted(self):
        checklist = make_checklist()
        response = self.client.delete(f"/api/onboarding/checklists/{checklist.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Checklist.objects.filter(pk=checklist.id).exists())

    def test_assigned_checklist_cannot_be_deleted(self):
        checklist = make_checklist()
        employee = make_employee(self.dept, email="assigned@example.com")
        employee.onboarding_checklist = checklist
        employee.save(update_fields=["onboarding_checklist"])

        response = self.client.delete(f"/api/onboarding/checklists/{checklist.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("1 employee", response.data["detail"])
        self.assertTrue(Checklist.objects.filter(pk=checklist.id).exists())

    def test_checklist_becomes_deletable_once_unassigned(self):
        checklist = make_checklist()
        employee = make_employee(self.dept, email="was-assigned@example.com")
        employee.onboarding_checklist = checklist
        employee.save(update_fields=["onboarding_checklist"])
        employee.onboarding_checklist = None
        employee.save(update_fields=["onboarding_checklist"])

        response = self.client.delete(f"/api/onboarding/checklists/{checklist.id}/")
        self.assertEqual(response.status_code, 200)

    def test_multiple_assignees_pluralizes_the_message(self):
        checklist = make_checklist()
        for i in range(2):
            employee = make_employee(self.dept, email=f"multi{i}@example.com")
            employee.onboarding_checklist = checklist
            employee.save(update_fields=["onboarding_checklist"])

        response = self.client.delete(f"/api/onboarding/checklists/{checklist.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertIn("2 employees", response.data["detail"])
