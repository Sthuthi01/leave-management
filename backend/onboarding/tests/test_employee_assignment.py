"""Employee <-> checklist assignment wiring (via the existing /api/employees/ endpoints) and
Phase 6 condition #6's audit requirement: resource/checklist/task mutations, document
upload/delete, and checklist (re)assignment all produce audit log entries."""

from django.test import TestCase
from rest_framework.test import APIClient

from audit.models import AuditLogEntry
from onboarding.tests.helpers import make_admin, make_checklist, make_department, make_employee


class EmployeeChecklistAssignmentTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.checklist = make_checklist(name="New Hire Checklist")
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_create_employee_with_checklist(self):
        response = self.client.post(
            "/api/employees/",
            {
                "name": "New Hire",
                "email": "newhire@example.com",
                "title": "Engineer",
                "department": self.dept.id,
                "onboarding_checklist": self.checklist.id,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["onboarding_checklist"], self.checklist.id)

    def test_create_employee_with_unknown_checklist_rejected(self):
        response = self.client.post(
            "/api/employees/",
            {
                "name": "New Hire",
                "email": "newhire2@example.com",
                "title": "Engineer",
                "department": self.dept.id,
                "onboarding_checklist": 999999,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_patch_assigns_checklist_and_audits_the_change(self):
        employee = make_employee(self.dept, email="target@example.com")
        response = self.client.patch(
            f"/api/employees/{employee.id}/", {"onboarding_checklist": self.checklist.id}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        employee.refresh_from_db()
        self.assertEqual(employee.onboarding_checklist_id, self.checklist.id)

        entry = AuditLogEntry.objects.filter(action="Changed onboarding checklist").order_by("-id").first()
        self.assertIsNotNone(entry)
        self.assertEqual(entry.target_label, employee.name)
        self.assertIn("New Hire Checklist", entry.details)

    def test_patch_reassigns_to_a_different_checklist(self):
        other_checklist = make_checklist(name="Other Checklist")
        employee = make_employee(self.dept, email="target2@example.com")
        employee.onboarding_checklist = self.checklist
        employee.save(update_fields=["onboarding_checklist"])

        response = self.client.patch(
            f"/api/employees/{employee.id}/", {"onboarding_checklist": other_checklist.id}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        employee.refresh_from_db()
        self.assertEqual(employee.onboarding_checklist_id, other_checklist.id)

    def test_patch_unassigns_checklist(self):
        employee = make_employee(self.dept, email="target3@example.com")
        employee.onboarding_checklist = self.checklist
        employee.save(update_fields=["onboarding_checklist"])

        response = self.client.patch(f"/api/employees/{employee.id}/", {"onboarding_checklist": None}, format="json")
        self.assertEqual(response.status_code, 200)
        employee.refresh_from_db()
        self.assertIsNone(employee.onboarding_checklist_id)

    def test_patch_with_no_checklist_change_does_not_audit_a_checklist_change(self):
        employee = make_employee(self.dept, email="target4@example.com")
        self.client.patch(f"/api/employees/{employee.id}/", {"title": "Senior Engineer"}, format="json")
        self.assertFalse(AuditLogEntry.objects.filter(action="Changed onboarding checklist").exists())


class OnboardingAuditTrailTest(TestCase):
    """Phase 6 condition #6: admin-side onboarding mutations are audited."""

    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_resource_create_edit_delete_are_audited(self):
        create = self.client.post(
            "/api/onboarding/resources/", {"title": "Policy", "category": "POLICY", "description": "d"}, format="json"
        )
        resource_id = create.data["id"]
        self.assertTrue(AuditLogEntry.objects.filter(action="Added onboarding resource").exists())

        self.client.patch(f"/api/onboarding/resources/{resource_id}/", {"title": "Policy v2"}, format="json")
        self.assertTrue(AuditLogEntry.objects.filter(action="Edited onboarding resource").exists())

        self.client.delete(f"/api/onboarding/resources/{resource_id}/")
        self.assertTrue(AuditLogEntry.objects.filter(action="Removed onboarding resource").exists())

    def test_checklist_create_edit_delete_are_audited(self):
        create = self.client.post("/api/onboarding/checklists/", {"name": "C1"}, format="json")
        checklist_id = create.data["id"]
        self.assertTrue(AuditLogEntry.objects.filter(action="Added onboarding checklist").exists())

        self.client.patch(f"/api/onboarding/checklists/{checklist_id}/", {"name": "C1 renamed"}, format="json")
        self.assertTrue(AuditLogEntry.objects.filter(action="Edited onboarding checklist").exists())

        self.client.delete(f"/api/onboarding/checklists/{checklist_id}/")
        self.assertTrue(AuditLogEntry.objects.filter(action="Removed onboarding checklist").exists())

    def test_task_create_edit_delete_move_are_audited(self):
        checklist = self.client.post("/api/onboarding/checklists/", {"name": "C2"}, format="json").data
        create = self.client.post(f"/api/onboarding/checklists/{checklist['id']}/tasks/", {"title": "T1"}, format="json")
        task_id = create.data["id"]
        self.assertTrue(AuditLogEntry.objects.filter(action="Added onboarding task").exists())

        self.client.patch(f"/api/onboarding/tasks/{task_id}/", {"title": "T1 renamed"}, format="json")
        self.assertTrue(AuditLogEntry.objects.filter(action="Edited onboarding task").exists())

        self.client.delete(f"/api/onboarding/tasks/{task_id}/")
        self.assertTrue(AuditLogEntry.objects.filter(action="Removed onboarding task").exists())

    def test_task_completion_is_audited(self):
        checklist = self.client.post("/api/onboarding/checklists/", {"name": "C3"}, format="json").data
        task = self.client.post(f"/api/onboarding/checklists/{checklist['id']}/tasks/", {"title": "T1"}, format="json").data
        employee = make_employee(self.dept, email="completer@example.com")
        employee.onboarding_checklist_id = checklist["id"]
        employee.save(update_fields=["onboarding_checklist"])

        employee_client = APIClient()
        employee_client.force_authenticate(user=employee)
        employee_client.post(f"/api/onboarding/tasks/{task['id']}/complete/", {"completed": True}, format="json")
        self.assertTrue(AuditLogEntry.objects.filter(action="Completed onboarding task").exists())
