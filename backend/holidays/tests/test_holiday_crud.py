import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from departments.models import Department
from holidays.models import Holiday


class HolidayCrudTest(TestCase):
    """Phase 2B: Holidays. GET is open to any authenticated employee; POST/PATCH/DELETE are
    ADMIN-only, mirroring the departments/leave_types pattern. Business rules preserved from the
    source app: no year column (derived from date), no is_active concept, duplicate = same exact
    date globally (here enforced via a DB unique constraint rather than app-code-only), and delete
    is always unconditionally safe since nothing references a holiday by FK."""

    def setUp(self):
        dept = Department.objects.create(name="Engineering")
        self.holiday = Holiday.objects.create(
            name="Republic Day", date=datetime.date(2026, 1, 26), optional=False
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

    def _url(self, holiday=None):
        return f"/api/holidays/{holiday.id}/" if holiday else "/api/holidays/"

    # --- happy paths ---

    def test_any_authenticated_employee_can_list(self):
        response = self.employee_client.get(self._url())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)

    def test_admin_can_create(self):
        response = self.admin_client.post(
            self._url(), {"name": "Independence Day", "date": "2026-08-15", "optional": False}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(Holiday.objects.count(), 2)

    def test_admin_can_create_optional_holiday(self):
        response = self.admin_client.post(
            self._url(), {"name": "Diwali", "date": "2026-11-08", "optional": True}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.data["optional"])

    def test_optional_defaults_to_false(self):
        response = self.admin_client.post(
            self._url(), {"name": "Independence Day", "date": "2026-08-15"}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.data["optional"])

    def test_admin_can_edit_name(self):
        response = self.admin_client.patch(self._url(self.holiday), {"name": "Republic Day (India)"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.holiday.refresh_from_db()
        self.assertEqual(self.holiday.name, "Republic Day (India)")

    def test_admin_can_edit_date(self):
        response = self.admin_client.patch(self._url(self.holiday), {"date": "2026-01-27"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.holiday.refresh_from_db()
        self.assertEqual(str(self.holiday.date), "2026-01-27")

    def test_admin_can_toggle_optional(self):
        response = self.admin_client.patch(self._url(self.holiday), {"optional": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.holiday.refresh_from_db()
        self.assertTrue(self.holiday.optional)

    def test_admin_can_delete(self):
        response = self.admin_client.delete(self._url(self.holiday))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Holiday.objects.filter(id=self.holiday.id).exists())

    # --- validation failures ---

    def test_name_too_short_rejected(self):
        response = self.admin_client.post(
            self._url(), {"name": "A", "date": "2026-08-15"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_missing_name_rejected(self):
        response = self.admin_client.post(self._url(), {"date": "2026-08-15"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("name", response.data)

    def test_missing_date_rejected(self):
        response = self.admin_client.post(self._url(), {"name": "Some Holiday"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("date", response.data)

    def test_invalid_date_format_rejected(self):
        response = self.admin_client.post(
            self._url(), {"name": "Some Holiday", "date": "26/08/2026"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("date", response.data)

    def test_nonexistent_calendar_date_rejected(self):
        response = self.admin_client.post(
            self._url(), {"name": "Some Holiday", "date": "2026-02-30"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("date", response.data)

    def test_edit_with_invalid_date_rejected(self):
        response = self.admin_client.patch(self._url(self.holiday), {"date": "not-a-date"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.holiday.refresh_from_db()
        self.assertEqual(str(self.holiday.date), "2026-01-26")

    # --- duplicate date validation ---

    def test_duplicate_date_on_create_rejected(self):
        response = self.admin_client.post(
            self._url(), {"name": "Some Other Name", "date": "2026-01-26"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("date", response.data)
        self.assertEqual(Holiday.objects.count(), 1)

    def test_duplicate_date_regardless_of_optional_flag(self):
        # duplicate = same exact date globally, regardless of the optional/type flag
        response = self.admin_client.post(
            self._url(), {"name": "Some Other Name", "date": "2026-01-26", "optional": True}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_duplicate_date_on_edit_rejected(self):
        other = Holiday.objects.create(name="Another Holiday", date=datetime.date(2026, 3, 1))
        response = self.admin_client.patch(self._url(other), {"date": "2026-01-26"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertIn("date", response.data)

    def test_editing_holiday_to_its_own_existing_date_is_allowed(self):
        # Excludes self from the uniqueness check — patching unrelated fields while keeping the
        # same date must not spuriously trip the duplicate-date validator.
        response = self.admin_client.patch(
            self._url(self.holiday), {"name": "Republic Day", "date": "2026-01-26"}, format="json"
        )
        self.assertEqual(response.status_code, 200)

    # --- RBAC / permissions ---

    def test_employee_cannot_create(self):
        response = self.employee_client.post(
            self._url(), {"name": "Some Holiday", "date": "2026-08-15"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(Holiday.objects.count(), 1)

    def test_employee_cannot_edit(self):
        response = self.employee_client.patch(self._url(self.holiday), {"name": "Hacked"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_employee_cannot_delete(self):
        response = self.employee_client.delete(self._url(self.holiday))
        self.assertEqual(response.status_code, 403)
        self.assertTrue(Holiday.objects.filter(id=self.holiday.id).exists())

    def test_anonymous_cannot_list(self):
        response = APIClient().get(self._url())
        self.assertIn(response.status_code, (401, 403))

    def test_anonymous_cannot_create(self):
        response = APIClient().post(
            self._url(), {"name": "Some Holiday", "date": "2026-08-15"}, format="json"
        )
        self.assertIn(response.status_code, (401, 403))

    def test_anonymous_cannot_edit(self):
        response = APIClient().patch(self._url(self.holiday), {"name": "Hacked"}, format="json")
        self.assertIn(response.status_code, (401, 403))

    def test_anonymous_cannot_delete(self):
        response = APIClient().delete(self._url(self.holiday))
        self.assertIn(response.status_code, (401, 403))

    # --- delete / dependency scenarios ---

    def test_delete_always_succeeds_no_dependency_blocking(self):
        # Nothing references a Holiday by FK yet (Leave Requests are out of scope for this
        # phase) — delete must never be blocked, matching the source app's unconditional delete.
        second = Holiday.objects.create(name="Second Holiday", date=datetime.date(2026, 5, 1))
        response = self.admin_client.delete(self._url(second))
        self.assertEqual(response.status_code, 204)
        self.assertEqual(Holiday.objects.count(), 1)

    def test_list_ordered_by_date_ascending(self):
        Holiday.objects.create(name="Earlier Holiday", date=datetime.date(2025, 1, 1))
        Holiday.objects.create(name="Later Holiday", date=datetime.date(2026, 12, 25))
        response = self.employee_client.get(self._url())
        dates = [row["date"] for row in response.data]
        self.assertEqual(dates, sorted(dates))
