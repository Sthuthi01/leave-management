from django.core.cache import cache
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from accounts.models import Employee, EmployeeStatus, Role, TokenPurpose
from accounts.tokens import create_token
from departments.models import Department

# Throttle counters live in Django's cache (see accounts/throttles.py), which is a process-global
# singleton not reset by Django's test-DB rollback — must clear it ourselves between tests, or an
# earlier test's requests would count against a later test's limit.
LOW_THROTTLE_RATES = {
    "login": "3/min",
    "set_password": "3/min",
}


class LoginRateLimitTest(TestCase):
    def setUp(self):
        cache.clear()
        self.department = Department.objects.create(name="Engineering")
        Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.department,
        )
        self.client = APIClient()

    @override_settings(REST_FRAMEWORK={
        "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
        "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
        "DEFAULT_THROTTLE_RATES": LOW_THROTTLE_RATES,
    })
    def test_rapid_failed_logins_are_throttled(self):
        for _ in range(3):
            response = self.client.post(
                "/api/auth/login/", {"email": "admin@example.com", "password": "WrongPassword"}, format="json"
            )
            self.assertEqual(response.status_code, 401)

        blocked = self.client.post(
            "/api/auth/login/", {"email": "admin@example.com", "password": "WrongPassword"}, format="json"
        )
        self.assertEqual(blocked.status_code, 429)
        # Clean response: no account/user-existence info, no internals — just DRF's generic detail.
        self.assertIn("detail", blocked.data)
        self.assertNotIn("admin@example.com", str(blocked.data))

    @override_settings(REST_FRAMEWORK={
        "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
        "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
        "DEFAULT_THROTTLE_RATES": LOW_THROTTLE_RATES,
    })
    def test_throttle_counts_correct_and_incorrect_attempts_together(self):
        # A brute-force attempt mixing right/wrong guesses must still trip the same bucket —
        # the throttle is per-IP, not per-outcome.
        self.client.post("/api/auth/login/", {"email": "admin@example.com", "password": "Wrong1"}, format="json")
        self.client.post("/api/auth/login/", {"email": "admin@example.com", "password": "Wrong2"}, format="json")
        self.client.post("/api/auth/login/", {"email": "admin@example.com", "password": "Wrong3"}, format="json")
        blocked = self.client.post(
            "/api/auth/login/", {"email": "admin@example.com", "password": "AdminPass123"}, format="json"
        )
        self.assertEqual(blocked.status_code, 429)

    def test_legitimate_login_within_limit_is_not_throttled(self):
        # Default production-scale rate (10/min) — a normal user logging in once must never see
        # a 429, even after a couple of earlier requests to other endpoints in the same window.
        response = self.client.post(
            "/api/auth/login/", {"email": "admin@example.com", "password": "AdminPass123"}, format="json"
        )
        self.assertEqual(response.status_code, 200)


class SetPasswordRateLimitTest(TestCase):
    def setUp(self):
        cache.clear()
        department = Department.objects.create(name="Engineering")
        self.employee = Employee.objects.create(
            email="new.hire@example.com", name="New Hire", role=Role.EMPLOYEE,
            title="Engineer", department=department, status=EmployeeStatus.ACTIVE,
        )
        self.employee.set_unusable_password()
        self.employee.save(update_fields=["password"])
        self.client = APIClient()

    @override_settings(REST_FRAMEWORK={
        "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
        "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
        "DEFAULT_THROTTLE_RATES": LOW_THROTTLE_RATES,
    })
    def test_rapid_set_password_guesses_are_throttled(self):
        for _ in range(3):
            response = self.client.post(
                "/api/auth/set-password/", {"token": "not-a-real-token", "password": "Whatever123"}, format="json"
            )
            self.assertEqual(response.status_code, 400)

        blocked = self.client.post(
            "/api/auth/set-password/", {"token": "not-a-real-token", "password": "Whatever123"}, format="json"
        )
        self.assertEqual(blocked.status_code, 429)
        self.assertIn("detail", blocked.data)

    def test_legitimate_set_password_within_limit_is_not_throttled(self):
        raw_token = create_token(self.employee, TokenPurpose.INVITE)
        response = self.client.post(
            "/api/auth/set-password/", {"token": raw_token, "password": "BrandNewPass123"}, format="json"
        )
        self.assertEqual(response.status_code, 200)

    def test_login_and_set_password_have_independent_buckets(self):
        # Exhausting the login throttle must not also block set-password on the same IP.
        with self.settings(REST_FRAMEWORK={
            "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
            "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
            "DEFAULT_THROTTLE_RATES": LOW_THROTTLE_RATES,
        }):
            for _ in range(4):
                self.client.post("/api/auth/login/", {"email": "x@example.com", "password": "x"}, format="json")

            raw_token = create_token(self.employee, TokenPurpose.INVITE)
            response = self.client.post(
                "/api/auth/set-password/", {"token": raw_token, "password": "BrandNewPass123"}, format="json"
            )
            self.assertEqual(response.status_code, 200)
