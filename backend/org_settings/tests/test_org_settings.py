"""Phase 4 org_settings tests.

Covers: GET/PATCH RBAC, per-field validation, that patching working_days actually changes
leave-day calculation (not just the DB row), that audit_log_display_limit actually limits the
audit log response, and — the case called out explicitly for this phase — that a session's
expiry is fixed at login time: patching session_max_age_days changes what a *new* login gets,
but never retroactively changes an already-issued session's expiry.
"""
import datetime

from django.contrib.sessions.models import Session
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from audit.models import AuditLogEntry
from leave_requests.tests.helpers import make_department, make_employee, make_leave_type, make_manager
from org_settings.models import OrganizationSettings


def _next_monday(after: datetime.date) -> datetime.date:
    days_ahead = (7 - after.weekday()) % 7 or 7
    return after + datetime.timedelta(days=days_ahead)


class SettingsApiTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept,
        )
        self.employee = make_employee(self.dept, email="worker@example.com")
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    # ---- RBAC ----

    def test_any_authenticated_user_can_read_settings(self):
        response = self.employee_client.get("/api/settings/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["working_days"], [0, 1, 2, 3, 4])
        self.assertEqual(response.data["pending_approval_urgency_days"], 3)
        self.assertEqual(response.data["audit_log_display_limit"], 200)
        self.assertEqual(response.data["session_max_age_days"], 30)

    def test_admin_can_read_settings(self):
        response = self.admin_client.get("/api/settings/")
        self.assertEqual(response.status_code, 200)

    def test_unauthenticated_get_rejected(self):
        response = APIClient().get("/api/settings/")
        self.assertIn(response.status_code, (401, 403))

    def test_admin_can_patch_settings(self):
        response = self.admin_client.patch("/api/settings/", {"pending_approval_urgency_days": 5}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["pending_approval_urgency_days"], 5)

    def test_non_admin_cannot_patch_settings(self):
        response = self.employee_client.patch("/api/settings/", {"pending_approval_urgency_days": 5}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_patch_rejected(self):
        response = APIClient().patch("/api/settings/", {"pending_approval_urgency_days": 5}, format="json")
        self.assertIn(response.status_code, (401, 403))

    def test_patch_creates_audit_entry(self):
        self.admin_client.patch("/api/settings/", {"audit_log_display_limit": 50}, format="json")
        entry = AuditLogEntry.objects.order_by("-id").first()
        self.assertEqual(entry.action, "Updated settings")
        self.assertEqual(entry.actor_id, self.admin.id)
        self.assertEqual(entry.target_type, "Settings")

    # ---- validation ----

    def test_working_days_empty_rejected(self):
        response = self.admin_client.patch("/api/settings/", {"working_days": []}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_working_days_out_of_range_rejected(self):
        response = self.admin_client.patch("/api/settings/", {"working_days": [7]}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_working_days_negative_rejected(self):
        response = self.admin_client.patch("/api/settings/", {"working_days": [-1]}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_working_days_deduped_and_sorted(self):
        response = self.admin_client.patch("/api/settings/", {"working_days": [4, 1, 1, 0, 4]}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["working_days"], [0, 1, 4])

    def test_pending_approval_urgency_days_zero_rejected(self):
        response = self.admin_client.patch("/api/settings/", {"pending_approval_urgency_days": 0}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_pending_approval_urgency_days_negative_rejected(self):
        response = self.admin_client.patch("/api/settings/", {"pending_approval_urgency_days": -3}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_audit_log_display_limit_zero_rejected(self):
        response = self.admin_client.patch("/api/settings/", {"audit_log_display_limit": 0}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_session_max_age_days_zero_rejected(self):
        response = self.admin_client.patch("/api/settings/", {"session_max_age_days": 0}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_upcoming_leave_window_days_field_does_not_exist(self):
        # Deliberately omitted (confirmed dead/unused in the source app) — patching it should be
        # silently ignored (unknown field), not accepted as a real setting.
        response = self.admin_client.patch(
            "/api/settings/", {"upcoming_leave_window_days": 15}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertNotIn("upcoming_leave_window_days", response.data)


class WorkingDaysConsumptionTest(TestCase):
    """Proves calculate_leave_days' output actually changes when working_days is patched —
    not just that the settings row updates."""

    def setUp(self):
        self.dept = make_department()
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept,
        )
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)

    def test_default_working_days_unchanged_behavior(self):
        # Regression: default Mon-Fri settings must produce the exact same day count as before
        # Phase 4 (a 5-weekday Mon-Fri range counts all 5 days).
        worker = make_employee(self.dept, email="worker1@example.com")
        lt = make_leave_type(name="Regression Leave", code="REG", requires_approval=False, default_days_per_year=10)
        monday = _next_monday(timezone.now().date())
        friday = monday + datetime.timedelta(days=4)
        client = APIClient()
        client.force_authenticate(user=worker)
        response = client.post(
            "/api/leave-requests/",
            {"leave_type": lt.id, "start_date": monday.isoformat(), "end_date": friday.isoformat(), "reason": "Regression check"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["days"], 5)

    def test_patched_working_days_changes_leave_day_count(self):
        worker = make_employee(self.dept, email="worker2@example.com")
        lt = make_leave_type(name="Patched Leave", code="PAT", requires_approval=False, default_days_per_year=10)
        monday = _next_monday(timezone.now().date())
        friday = monday + datetime.timedelta(days=4)

        # Restrict working days to Monday, Wednesday, Friday only (0, 2, 4).
        patch_response = self.admin_client.patch("/api/settings/", {"working_days": [0, 2, 4]}, format="json")
        self.assertEqual(patch_response.status_code, 200)

        client = APIClient()
        client.force_authenticate(user=worker)
        response = client.post(
            "/api/leave-requests/",
            {"leave_type": lt.id, "start_date": monday.isoformat(), "end_date": friday.isoformat(), "reason": "Patched check"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        # Mon, Wed, Fri only out of a Mon-Fri range = 3 days, not 5.
        self.assertEqual(response.data["days"], 3)


class AuditLogLimitConsumptionTest(TestCase):
    """Proves audit_log_display_limit actually truncates the audit-log response."""

    def setUp(self):
        self.dept = make_department()
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept,
        )
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        for i in range(5):
            AuditLogEntry.objects.create(
                actor=self.admin, actor_name=self.admin.name, action=f"Test action {i}",
                target_type="Test", target_label=f"target-{i}",
            )

    def test_default_limit_returns_all_entries_under_limit(self):
        response = self.admin_client.get("/api/audit-log/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 5)

    def test_patched_limit_actually_truncates_results(self):
        patch_response = self.admin_client.patch("/api/settings/", {"audit_log_display_limit": 2}, format="json")
        self.assertEqual(patch_response.status_code, 200)

        response = self.admin_client.get("/api/audit-log/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 2)
        # Newest-first: the "Updated settings" entry from the PATCH itself, then the last seeded one.
        self.assertEqual(response.data[0]["action"], "Updated settings")
        self.assertEqual(response.data[1]["action"], "Test action 4")


class SessionExpiryTest(TestCase):
    """The case flagged explicitly for this phase: session_max_age_days is applied per-login,
    not dynamically. A new login after the setting changes gets the new duration; a session
    already issued before the change keeps its original expiry untouched."""

    def setUp(self):
        self.dept = make_department()
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept,
        )
        self.employee = make_employee(self.dept, email="worker@example.com")
        self.employee.set_password("WorkerPass123456")
        self.employee.save(update_fields=["password"])

    def _login(self, client: APIClient, email: str, password: str) -> str:
        client.get("/api/auth/csrf/")
        csrf = client.cookies["csrftoken"].value
        response = client.post(
            "/api/auth/login/", {"email": email, "password": password}, format="json", HTTP_X_CSRFTOKEN=csrf
        )
        self.assertEqual(response.status_code, 200)
        return client.cookies["sessionid"].value

    def test_new_login_gets_updated_expiry_existing_session_is_unaffected(self):
        # Login #1, under the default 30-day setting.
        client_a = APIClient(enforce_csrf_checks=True)
        session_key_a = self._login(client_a, self.employee.email, "WorkerPass123456")
        expire_before = Session.objects.get(session_key=session_key_a).expire_date
        expected_30_days = timezone.now() + datetime.timedelta(days=30)
        self.assertAlmostEqual(expire_before.timestamp(), expected_30_days.timestamp(), delta=30)

        # Admin shortens session_max_age_days to 5.
        admin_client = APIClient()
        admin_client.force_authenticate(user=self.admin)
        patch_response = admin_client.patch("/api/settings/", {"session_max_age_days": 5}, format="json")
        self.assertEqual(patch_response.status_code, 200)

        # Session #1's expiry (already issued) is untouched by the settings change.
        expire_after = Session.objects.get(session_key=session_key_a).expire_date
        self.assertEqual(expire_before, expire_after)

        # A fresh login (#2) now gets the new 5-day duration.
        client_b = APIClient(enforce_csrf_checks=True)
        session_key_b = self._login(client_b, self.employee.email, "WorkerPass123456")
        expire_b = Session.objects.get(session_key=session_key_b).expire_date
        expected_5_days = timezone.now() + datetime.timedelta(days=5)
        self.assertAlmostEqual(expire_b.timestamp(), expected_5_days.timestamp(), delta=30)
        # And it's clearly shorter than session #1's still-30-day expiry.
        self.assertLess(expire_b, expire_after)

    def test_change_password_reissue_also_applies_current_session_max_age(self):
        client = APIClient(enforce_csrf_checks=True)
        self._login(client, self.employee.email, "WorkerPass123456")

        admin_client = APIClient()
        admin_client.force_authenticate(user=self.admin)
        admin_client.patch("/api/settings/", {"session_max_age_days": 7}, format="json")

        csrf = client.cookies["csrftoken"].value
        response = client.post(
            "/api/auth/change-password/",
            {"current_password": "WorkerPass123456", "new_password": "BrandNewPass123456"},
            format="json",
            HTTP_X_CSRFTOKEN=csrf,
        )
        self.assertEqual(response.status_code, 200)

        session_key = client.cookies["sessionid"].value
        expire = Session.objects.get(session_key=session_key).expire_date
        expected_7_days = timezone.now() + datetime.timedelta(days=7)
        self.assertAlmostEqual(expire.timestamp(), expected_7_days.timestamp(), delta=30)
