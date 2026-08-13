from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from departments.models import Department


class LoginCsrfTest(TestCase):
    """Phase 1.5 P1: closes the "login CSRF" gap — DRF's SessionAuthentication only enforces CSRF
    once request.user already resolves to an authenticated user, which is never true for the login
    request itself, so it was previously skipped entirely for LoginView. Uses a real APIClient
    with enforce_csrf_checks=True (off by default in DRF's test client specifically so most tests
    don't need to deal with it) to exercise the actual Django CSRF machinery, not a mock."""

    def setUp(self):
        department = Department.objects.create(name="Engineering")
        Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=department,
        )
        self.client = APIClient(enforce_csrf_checks=True)

    def test_login_without_csrf_token_is_rejected(self):
        self.client.get("/api/auth/csrf/")  # primes the csrftoken cookie, deliberately not sent back
        response = self.client.post("/api/auth/login/", {"email": "admin@example.com", "password": "AdminPass123"}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_login_with_valid_csrf_token_succeeds(self):
        self.client.get("/api/auth/csrf/")
        csrf_token = self.client.cookies["csrftoken"].value
        response = self.client.post(
            "/api/auth/login/",
            {"email": "admin@example.com", "password": "AdminPass123"},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(response.status_code, 200)

    def test_login_with_no_csrf_cookie_at_all_is_rejected(self):
        # No prior GET /auth/csrf/ — simulates hitting the login endpoint cold.
        response = APIClient(enforce_csrf_checks=True).post(
            "/api/auth/login/", {"email": "admin@example.com", "password": "AdminPass123"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
