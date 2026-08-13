import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from audit.models import AuditLogEntry
from departments.models import Department
from holidays.models import Holiday
from holidays.views import MAX_IMPORT_ROWS


class HolidayImportTest(TestCase):
    """Phase 7: POST /api/holidays/import/. Mirrors EmployeeImportTest's structure — rows are
    already-parsed JSON, re-validated per-row via the same HolidaySerializer a single
    POST /api/holidays/ already uses, so duplicate-date detection (existing-in-DB and
    in-file-repeat) is reused rather than reimplemented."""

    def setUp(self):
        department = Department.objects.create(name="Engineering")
        self.existing_holiday = Holiday.objects.create(
            name="Republic Day", date=datetime.date(2026, 1, 26), optional=False
        )
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=department,
        )
        self.employee = Employee.objects.create_user(
            email="employee@example.com", name="Regular Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=department,
        )
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    def _url(self):
        return "/api/holidays/import/"

    def _row(self, **overrides):
        row = {"name": "Independence Day", "date": "2026-08-15", "optional": False}
        row.update(overrides)
        return row

    # --- happy path ---

    def test_admin_can_import_valid_row(self):
        response = self.admin_client.post(self._url(), {"rows": [self._row()]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 1)
        self.assertTrue(Holiday.objects.filter(date=datetime.date(2026, 8, 15)).exists())

    # --- partial success ---

    def test_partial_success_valid_invalid_valid(self):
        rows = [
            self._row(name="First", date="2026-08-15"),
            self._row(name="A", date="2026-09-01"),  # name too short
            self._row(name="Second", date="2026-10-02"),
        ]
        response = self.admin_client.post(self._url(), {"rows": rows}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 2)
        self.assertEqual(response.data["skipped"], 1)
        self.assertTrue(Holiday.objects.filter(date=datetime.date(2026, 8, 15)).exists())
        self.assertTrue(Holiday.objects.filter(date=datetime.date(2026, 10, 2)).exists())
        self.assertFalse(Holiday.objects.filter(date=datetime.date(2026, 9, 1)).exists())

    # --- duplicate-date validation (condition #2 "duplicate detection") ---

    def test_duplicate_of_existing_holiday_skipped(self):
        response = self.admin_client.post(
            self._url(), {"rows": [self._row(name="Republic Day Again", date="2026-01-26")]}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["skipped"], 1)
        self.assertEqual(Holiday.objects.filter(date=datetime.date(2026, 1, 26)).count(), 1)

    def test_duplicate_within_same_file_second_occurrence_skipped(self):
        rows = [self._row(name="First", date="2026-12-25"), self._row(name="Second", date="2026-12-25")]
        response = self.admin_client.post(self._url(), {"rows": rows}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["skipped"], 1)
        self.assertEqual(Holiday.objects.filter(date=datetime.date(2026, 12, 25)).count(), 1)

    def test_existing_plus_in_file_duplicates_together(self):
        rows = [
            self._row(name="Dupe of existing", date="2026-01-26"),
            self._row(name="New one", date="2026-08-15"),
            self._row(name="Dupe of new one", date="2026-08-15"),
        ]
        response = self.admin_client.post(self._url(), {"rows": rows}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["created"], 1)
        self.assertEqual(response.data["skipped"], 2)

    # --- validation ---

    def test_invalid_date_skipped(self):
        response = self.admin_client.post(self._url(), {"rows": [self._row(date="not-a-date")]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["skipped"], 1)

    def test_missing_name_skipped(self):
        response = self.admin_client.post(self._url(), {"rows": [{"date": "2026-08-15"}]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["skipped"], 1)

    # --- row cap ---

    def test_row_cap_exceeded_rejected_with_400(self):
        rows = [self._row(name=f"Holiday {i}", date=f"2027-{(i % 12) + 1:02d}-01") for i in range(MAX_IMPORT_ROWS + 1)]
        response = self.admin_client.post(self._url(), {"rows": rows}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Holiday.objects.count(), 1)  # only the setUp fixture

    def test_empty_rows_rejected(self):
        response = self.admin_client.post(self._url(), {"rows": []}, format="json")
        self.assertEqual(response.status_code, 400)

    # --- RBAC ---

    def test_non_admin_cannot_import(self):
        response = self.employee_client.post(self._url(), {"rows": [self._row()]}, format="json")
        self.assertEqual(response.status_code, 403)
        self.assertFalse(Holiday.objects.filter(date=datetime.date(2026, 8, 15)).exists())

    def test_unauthenticated_cannot_import(self):
        response = APIClient().post(self._url(), {"rows": [self._row()]}, format="json")
        self.assertIn(response.status_code, (401, 403))

    # --- audit ---

    def test_exactly_one_audit_entry_per_created_row(self):
        before = AuditLogEntry.objects.filter(action="Added holiday").count()
        rows = [self._row(name="First", date="2026-08-15"), self._row(name="Second", date="2026-10-02")]
        self.admin_client.post(self._url(), {"rows": rows}, format="json")
        after = AuditLogEntry.objects.filter(action="Added holiday").count()
        self.assertEqual(after - before, 2)

    def test_no_audit_entry_for_skipped_row(self):
        before = AuditLogEntry.objects.filter(action="Added holiday").count()
        self.admin_client.post(self._url(), {"rows": [self._row(date="not-a-date")]}, format="json")
        after = AuditLogEntry.objects.filter(action="Added holiday").count()
        self.assertEqual(after, before)
