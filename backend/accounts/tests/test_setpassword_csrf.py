from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, EmployeeStatus, Role, TokenPurpose
from accounts.tokens import create_token
from departments.models import Department


class SetPasswordCsrfTest(TestCase):
    """UAT readiness P1 fix: SetPasswordView ends in django_login() while being reachable
    pre-auth, the same "login CSRF" exposure LoginView was already hardened against (see
    test_login_csrf.py) — a cross-site POST carrying an attacker's own valid invite/reset token
    plus an attacker-chosen password could otherwise sign the victim's browser into the
    attacker's account. Uses a real APIClient with enforce_csrf_checks=True to exercise the
    actual Django CSRF machinery, not a mock."""

    def setUp(self):
        department = Department.objects.create(name="Engineering")
        self.employee = Employee.objects.create(
            email="new.hire@example.com", name="New Hire", role=Role.EMPLOYEE,
            title="Engineer", department=department, status=EmployeeStatus.ACTIVE,
        )
        self.employee.set_unusable_password()
        self.employee.save(update_fields=["password"])
        self.client = APIClient(enforce_csrf_checks=True)

    def _issue_token(self):
        return create_token(self.employee, TokenPurpose.INVITE)

    def test_set_password_without_csrf_token_is_rejected(self):
        raw_token = self._issue_token()
        self.client.get("/api/auth/csrf/")  # primes the csrftoken cookie, deliberately not sent back
        response = self.client.post(
            "/api/auth/set-password/", {"token": raw_token, "password": "BrandNewPass123"}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        # The token must NOT have been consumed by the rejected request.
        self.employee.refresh_from_db()
        self.assertFalse(self.employee.has_usable_password())

    def test_set_password_with_valid_csrf_token_succeeds(self):
        raw_token = self._issue_token()
        self.client.get("/api/auth/csrf/")
        csrf_token = self.client.cookies["csrftoken"].value
        response = self.client.post(
            "/api/auth/set-password/",
            {"token": raw_token, "password": "BrandNewPass123"},
            format="json",
            HTTP_X_CSRFTOKEN=csrf_token,
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("sessionid", response.cookies)

    def test_set_password_with_no_csrf_cookie_at_all_is_rejected(self):
        raw_token = self._issue_token()
        # No prior GET /auth/csrf/ — simulates hitting the endpoint cold.
        response = APIClient(enforce_csrf_checks=True).post(
            "/api/auth/set-password/", {"token": raw_token, "password": "BrandNewPass123"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_get_token_check_does_not_require_csrf(self):
        # GET is a safe method — csrf_protect must not block the page-load token-validity check.
        raw_token = self._issue_token()
        response = self.client.get(f"/api/auth/set-password/?token={raw_token}")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["valid"])
