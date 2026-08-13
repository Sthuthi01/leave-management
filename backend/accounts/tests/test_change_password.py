from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from departments.models import Department


class ChangePasswordTest(TestCase):
    def setUp(self):
        self.department = Department.objects.create(name="Engineering")
        self.employee = Employee.objects.create_user(
            email="employee@example.com", name="Employee", password="OldPass1234",
            role=Role.EMPLOYEE, title="Engineer", department=self.department,
        )

    def _login(self, client, password="OldPass1234"):
        client.get("/api/auth/csrf/")
        csrf_token = client.cookies["csrftoken"].value
        response = client.post(
            "/api/auth/login/", {"email": "employee@example.com", "password": password},
            format="json", HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(response.status_code, 200)
        # Django rotates the CSRF token on login (rotate_token(), fired via the user_logged_in
        # signal) — re-read the cookie so callers get a token valid for requests *after* login,
        # not the one that was only valid for the login POST itself.
        return client.cookies["csrftoken"].value

    def test_requires_authentication(self):
        client = APIClient()
        response = client.post(
            "/api/auth/change-password/", {"current_password": "OldPass1234", "new_password": "NewPass5678"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_happy_path_changes_password_and_keeps_caller_signed_in(self):
        client = APIClient(enforce_csrf_checks=True)
        csrf_token = self._login(client)

        response = client.post(
            "/api/auth/change-password/",
            {"current_password": "OldPass1234", "new_password": "NewPass5678"},
            format="json", HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(response.status_code, 200)

        # The caller is NOT logged out by their own password change — the very next request on
        # this same client should still be authenticated.
        me = client.get("/api/auth/me/")
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data["email"], "employee@example.com")

        # The old password no longer works; the new one does.
        fresh_client = APIClient()
        fresh_client.get("/api/auth/csrf/")
        old_login = fresh_client.post(
            "/api/auth/login/", {"email": "employee@example.com", "password": "OldPass1234"}, format="json",
            HTTP_X_CSRFTOKEN=fresh_client.cookies["csrftoken"].value,
        )
        self.assertEqual(old_login.status_code, 401)

        new_login = fresh_client.post(
            "/api/auth/login/", {"email": "employee@example.com", "password": "NewPass5678"}, format="json",
            HTTP_X_CSRFTOKEN=fresh_client.cookies["csrftoken"].value,
        )
        self.assertEqual(new_login.status_code, 200)

    def test_wrong_current_password_rejected(self):
        client = APIClient(enforce_csrf_checks=True)
        csrf_token = self._login(client)
        response = client.post(
            "/api/auth/change-password/",
            {"current_password": "TotallyWrongPass", "new_password": "NewPass5678"},
            format="json", HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["detail"], "Current password is incorrect.")

        # Password must be unchanged.
        self.employee.refresh_from_db()
        self.assertTrue(self.employee.check_password("OldPass1234"))

    def test_weak_new_password_rejected(self):
        client = APIClient(enforce_csrf_checks=True)
        csrf_token = self._login(client)
        response = client.post(
            "/api/auth/change-password/",
            {"current_password": "OldPass1234", "new_password": "12345678901"},
            format="json", HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(response.status_code, 400)
        self.employee.refresh_from_db()
        self.assertTrue(self.employee.check_password("OldPass1234"))

    def test_other_sessions_invalidated_by_password_change(self):
        # Two independent "browsers" logged in as the same employee.
        client_a = APIClient(enforce_csrf_checks=True)
        csrf_a = self._login(client_a)
        client_b = APIClient(enforce_csrf_checks=True)
        self._login(client_b)

        # client_b confirms it's authenticated before the change.
        self.assertEqual(client_b.get("/api/auth/me/").status_code, 200)

        change = client_a.post(
            "/api/auth/change-password/",
            {"current_password": "OldPass1234", "new_password": "NewPass5678"},
            format="json", HTTP_X_CSRFTOKEN=csrf_a,
        )
        self.assertEqual(change.status_code, 200)

        # client_b's old session is now stale — SessionVersionMiddleware should reject it.
        stale = client_b.get("/api/auth/me/")
        self.assertEqual(stale.status_code, 403)

    def test_csrf_required(self):
        client = APIClient(enforce_csrf_checks=True)
        self._login(client)
        # Deliberately omit X-CSRFToken this time.
        response = client.post(
            "/api/auth/change-password/", {"current_password": "OldPass1234", "new_password": "NewPass5678"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_rate_limited(self):
        from django.core.cache import cache
        cache.clear()
        client = APIClient(enforce_csrf_checks=True)
        csrf_token = self._login(client)

        with self.settings(REST_FRAMEWORK={
            "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
            "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
            "DEFAULT_THROTTLE_RATES": {"login": "10/min", "set_password": "10/min", "change_password": "3/min", "forgot_password": "5/hour"},
        }):
            for _ in range(3):
                client.post(
                    "/api/auth/change-password/", {"current_password": "wrong", "new_password": "NewPass5678"},
                    format="json", HTTP_X_CSRFTOKEN=csrf_token,
                )
            blocked = client.post(
                "/api/auth/change-password/", {"current_password": "wrong", "new_password": "NewPass5678"},
                format="json", HTTP_X_CSRFTOKEN=csrf_token,
            )
            self.assertEqual(blocked.status_code, 429)
