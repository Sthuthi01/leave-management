from django.test import Client, TestCase

from accounts.models import Employee, Role
from departments.models import Department


class SessionVersionSignalTest(TestCase):
    """Phase 1.5 P1: SessionVersionMiddleware used to force-logout any session that didn't set
    session["session_version"] inline — which only the custom LoginView/SetPasswordView did.
    Logging in through Django's OWN /admin/login/ view skipped that, so the very next request
    after a successful admin login got silently logged back out. The fix is a user_logged_in
    signal receiver (signals.py) that sets it for every login path. This test reproduces the
    original bug's exact symptom via the real admin login URL, not just by calling the signal
    handler directly, so it fails if the wiring (signals.py + AppConfig.ready()) breaks again."""

    def setUp(self):
        department = Department.objects.create(name="Engineering")
        self.admin = Employee.objects.create_superuser(
            email="superuser@example.com", name="Super User", password="SuperPass123",
            role=Role.ADMIN, title="HR Administrator", department=department,
        )

    def test_admin_login_survives_the_next_request(self):
        client = Client()
        login_response = client.post(
            "/admin/login/", {"username": "superuser@example.com", "password": "SuperPass123", "next": "/admin/"}
        )
        # A successful admin login redirects to `next`; a rejected one re-renders the login form (200).
        self.assertEqual(login_response.status_code, 302, "admin login itself should have succeeded")

        # This is the request that used to get silently logged out by SessionVersionMiddleware,
        # because session["session_version"] was never set on the admin login path.
        me_response = client.get("/api/auth/me/")
        self.assertEqual(me_response.status_code, 200)
        self.assertEqual(me_response.json()["email"], "superuser@example.com")

    def test_session_version_mismatch_still_correctly_forces_logout(self):
        """Guards against overcorrecting: a genuinely stale session_version (e.g. after a password
        change elsewhere) must still be rejected — the fix must not disable this check entirely."""
        client = Client()
        client.post("/admin/login/", {"username": "superuser@example.com", "password": "SuperPass123", "next": "/admin/"})

        self.admin.session_version += 1
        self.admin.save(update_fields=["session_version"])

        me_response = client.get("/api/auth/me/")
        self.assertEqual(me_response.status_code, 403)
