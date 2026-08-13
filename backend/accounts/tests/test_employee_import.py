from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from accounts.views import MAX_IMPORT_ROWS
from audit.models import AuditLogEntry
from departments.models import Department
from onboarding.models import Checklist


class EmployeeImportTest(TestCase):
    """Phase 7: POST /api/employees/import/. Rows are already-parsed, already-resolved JSON (no
    raw file reaches this endpoint) but are still fully re-validated server-side via the same
    EmployeeCreateSerializer a single POST /api/employees/ already uses — this suite exercises
    that reuse plus the import-specific concerns (row cap, partial success, one audit entry and
    one invitation per created row)."""

    def setUp(self):
        self.department = Department.objects.create(name="Engineering")
        self.other_department = Department.objects.create(name="Sales")
        self.checklist = Checklist.objects.create(name="New Hire Checklist")
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.department,
        )
        self.manager = Employee.objects.create_user(
            email="manager@example.com", name="Manager", password="Pass1234567",
            role=Role.MANAGER, title="Manager", department=self.department,
        )
        self.employee = Employee.objects.create_user(
            email="employee@example.com", name="Regular Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.department,
        )
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    def _url(self):
        return "/api/employees/import/"

    def _row(self, **overrides):
        row = {
            "name": "New Hire",
            "email": "newhire@example.com",
            "title": "Engineer",
            "department": self.department.id,
        }
        row.update(overrides)
        return row

    # --- happy path ---

    def test_admin_can_import_valid_row(self):
        response = self.admin_client.post(self._url(), {"rows": [self._row()]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["skipped"], 0)
        self.assertTrue(Employee.objects.filter(email="newhire@example.com").exists())

    def test_imported_employee_has_unusable_password(self):
        self.admin_client.post(self._url(), {"rows": [self._row()]}, format="json")
        employee = Employee.objects.get(email="newhire@example.com")
        self.assertFalse(employee.has_usable_password())

    def test_role_and_manager_and_checklist_resolved_by_id(self):
        response = self.admin_client.post(
            self._url(),
            {
                "rows": [
                    self._row(
                        role=Role.MANAGER,
                        manager=self.manager.id,
                        onboarding_checklist=self.checklist.id,
                    )
                ]
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        employee = Employee.objects.get(email="newhire@example.com")
        self.assertEqual(employee.role, Role.MANAGER)
        self.assertEqual(employee.manager_id, self.manager.id)
        self.assertEqual(employee.onboarding_checklist_id, self.checklist.id)

    def test_role_defaults_to_employee_when_omitted(self):
        self.admin_client.post(self._url(), {"rows": [self._row()]}, format="json")
        employee = Employee.objects.get(email="newhire@example.com")
        self.assertEqual(employee.role, Role.EMPLOYEE)

    # --- partial success ---

    def test_partial_success_valid_invalid_valid(self):
        rows = [
            self._row(email="first@example.com"),
            self._row(email="not-an-email", name="A"),
            self._row(email="second@example.com"),
        ]
        response = self.admin_client.post(self._url(), {"rows": rows}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["skipped"], 1)
        self.assertTrue(Employee.objects.filter(email="first@example.com").exists())
        self.assertTrue(Employee.objects.filter(email="second@example.com").exists())
        self.assertFalse(Employee.objects.filter(email="not-an-email").exists())
        self.assertEqual(response.data["results"][0]["status"], "created")
        self.assertEqual(response.data["results"][1]["status"], "skipped")
        self.assertEqual(response.data["results"][2]["status"], "created")

    def test_one_bad_row_does_not_roll_back_earlier_created_rows(self):
        rows = [self._row(email="good@example.com"), self._row(email="bad", department=999999)]
        response = self.admin_client.post(self._url(), {"rows": rows}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 1)
        self.assertTrue(Employee.objects.filter(email="good@example.com").exists())

    # --- validation-rejection matrix (each reused from EmployeeCreateSerializer) ---

    def test_missing_required_fields_skipped(self):
        response = self.admin_client.post(self._url(), {"rows": [{"name": "No Email"}]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 0)
        self.assertEqual(response.data["skipped"], 1)

    def test_unknown_department_skipped(self):
        response = self.admin_client.post(self._url(), {"rows": [self._row(department=999999)]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["skipped"], 1)

    def test_unknown_manager_skipped(self):
        response = self.admin_client.post(self._url(), {"rows": [self._row(manager=999999)]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["skipped"], 1)

    def test_unknown_checklist_skipped(self):
        response = self.admin_client.post(
            self._url(), {"rows": [self._row(onboarding_checklist=999999)]}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["skipped"], 1)

    def test_duplicate_email_against_existing_employee_skipped(self):
        response = self.admin_client.post(self._url(), {"rows": [self._row(email="employee@example.com")]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["skipped"], 1)

    def test_duplicate_email_within_same_file_second_occurrence_skipped(self):
        rows = [self._row(email="dupe@example.com"), self._row(email="dupe@example.com")]
        response = self.admin_client.post(self._url(), {"rows": rows}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["skipped"], 1)
        self.assertEqual(Employee.objects.filter(email="dupe@example.com").count(), 1)

    # --- row cap ---

    def test_row_cap_exceeded_rejected_with_400(self):
        rows = [self._row(email=f"person{i}@example.com") for i in range(MAX_IMPORT_ROWS + 1)]
        response = self.admin_client.post(self._url(), {"rows": rows}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Employee.objects.count(), 3)  # only the setUp fixtures

    def test_row_cap_at_exactly_max_is_allowed(self):
        rows = [self._row(email=f"person{i}@example.com") for i in range(MAX_IMPORT_ROWS)]
        response = self.admin_client.post(self._url(), {"rows": rows}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], MAX_IMPORT_ROWS)

    def test_empty_rows_rejected(self):
        response = self.admin_client.post(self._url(), {"rows": []}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_missing_rows_key_rejected(self):
        response = self.admin_client.post(self._url(), {}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_rows_not_a_list_rejected(self):
        response = self.admin_client.post(self._url(), {"rows": "not-a-list"}, format="json")
        self.assertEqual(response.status_code, 400)

    # --- RBAC ---

    def test_non_admin_cannot_import(self):
        response = self.employee_client.post(self._url(), {"rows": [self._row()]}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Employee.objects.filter(email="newhire@example.com").exists())

    def test_unauthenticated_cannot_import(self):
        response = APIClient().post(self._url(), {"rows": [self._row()]}, format="json")
        self.assertIn(response.status_code, (401, 403))

    # --- audit + invitation counts (condition #9) ---

    def test_exactly_one_invitation_per_created_row(self):
        rows = [self._row(email="one@example.com"), self._row(email="two@example.com")]
        self.admin_client.post(self._url(), {"rows": rows}, format="json")
        self.assertEqual(len(mail.outbox), 2)
        recipients = sorted(m.to[0] for m in mail.outbox)
        self.assertEqual(recipients, ["one@example.com", "two@example.com"])

    def test_no_invitation_for_skipped_row(self):
        rows = [self._row(email="ok@example.com"), self._row(email="bad", department=999999)]
        self.admin_client.post(self._url(), {"rows": rows}, format="json")
        self.assertEqual(len(mail.outbox), 1)

    def test_exactly_one_audit_entry_per_created_row(self):
        before = AuditLogEntry.objects.filter(action="Added employee").count()
        rows = [self._row(email="one@example.com"), self._row(email="two@example.com")]
        self.admin_client.post(self._url(), {"rows": rows}, format="json")
        after = AuditLogEntry.objects.filter(action="Added employee").count()
        self.assertEqual(after - before, 2)

    def test_no_audit_entry_for_skipped_row(self):
        before = AuditLogEntry.objects.filter(action="Added employee").count()
        rows = [self._row(email="bad", department=999999)]
        self.admin_client.post(self._url(), {"rows": rows}, format="json")
        after = AuditLogEntry.objects.filter(action="Added employee").count()
        self.assertEqual(after, before)
