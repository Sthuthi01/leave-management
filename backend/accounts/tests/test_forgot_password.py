from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, EmployeeStatus, Role
from departments.models import Department


class ForgotPasswordTest(TestCase):
    def setUp(self):
        cache.clear()
        self.department = Department.objects.create(name="Engineering")
        self.active_employee = Employee.objects.create_user(
            email="active@example.com", name="Active Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.department,
        )
        self.client = APIClient()

    def test_no_csrf_required(self):
        # Unlike SetPasswordView, this endpoint never logs anyone in, so it doesn't need
        # csrf_protect — confirm a request with enforce_csrf_checks=True and no token still works.
        client = APIClient(enforce_csrf_checks=True)
        response = client.post("/api/auth/forgot-password/", {"email": "active@example.com"}, format="json")
        self.assertEqual(response.status_code, 200)

    def test_existing_active_account_gets_reset_email(self):
        response = self.client.post("/api/auth/forgot-password/", {"email": "active@example.com"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("active@example.com", mail.outbox[0].to)
        self.assertIn("token=", mail.outbox[0].body)

        # HTML alternative part, matching the source app's formatted reset email (Prompt 5 item 5).
        self.assertEqual(len(mail.outbox[0].alternatives), 1)
        html_body, mimetype = mail.outbox[0].alternatives[0]
        self.assertEqual(mimetype, "text/html")
        self.assertIn("AGRILEAF", html_body)

    def test_nonexistent_email_gets_identical_response_and_no_email(self):
        real = self.client.post("/api/auth/forgot-password/", {"email": "active@example.com"}, format="json")
        cache.clear()
        fake = self.client.post("/api/auth/forgot-password/", {"email": "nobody-here@example.com"}, format="json")

        self.assertEqual(real.status_code, fake.status_code)
        self.assertEqual(real.data, fake.data)
        self.assertEqual(len(mail.outbox), 1)  # only the real one actually sent anything

    def test_inactive_account_gets_generic_response_and_no_email(self):
        Employee.objects.create_user(
            email="inactive@example.com", name="Inactive", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.department, status=EmployeeStatus.INACTIVE,
        )
        response = self.client.post("/api/auth/forgot-password/", {"email": "inactive@example.com"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_never_activated_account_gets_generic_response_and_no_email(self):
        # Has no usable password yet (still mid-invite) — resetting a password that doesn't exist
        # yet makes no sense; use resend-invitation for this case instead.
        not_yet_activated = Employee(
            email="pending@example.com", name="Pending", role=Role.EMPLOYEE, title="Engineer",
            department=self.department, status=EmployeeStatus.ACTIVE,
        )
        not_yet_activated.set_unusable_password()
        not_yet_activated.save()

        response = self.client.post("/api/auth/forgot-password/", {"email": "pending@example.com"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_reset_token_actually_works_with_set_password(self):
        self.client.post("/api/auth/forgot-password/", {"email": "active@example.com"}, format="json")
        import re
        match = re.search(r"token=(\S+)", mail.outbox[0].body)
        raw_token = match.group(1)

        check = self.client.get(f"/api/auth/set-password/?token={raw_token}")
        self.assertEqual(check.status_code, 200)
        self.assertTrue(check.data["valid"])
        self.assertEqual(check.data["purpose"], "RESET")

    def test_rate_limited_by_ip_and_email(self):
        with self.settings(REST_FRAMEWORK={
            "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.SessionAuthentication"],
            "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
            "DEFAULT_THROTTLE_RATES": {"login": "10/min", "set_password": "10/min", "change_password": "10/min", "forgot_password": "3/hour"},
        }):
            for _ in range(3):
                self.client.post("/api/auth/forgot-password/", {"email": "active@example.com"}, format="json")
            blocked = self.client.post("/api/auth/forgot-password/", {"email": "active@example.com"}, format="json")
            self.assertEqual(blocked.status_code, 429)

            # A DIFFERENT target email from the same IP must not be blocked by the bucket above —
            # keyed by IP+email, not IP alone.
            other = self.client.post("/api/auth/forgot-password/", {"email": "somebody-else@example.com"}, format="json")
            self.assertEqual(other.status_code, 200)
