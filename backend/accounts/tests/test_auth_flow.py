import re

from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from departments.models import Department


class AuthFlowTest(TestCase):
    """End-to-end: ADMIN creates an employee -> invitation email sent -> recipient sets password
    via the emailed link -> logs in -> can see the employee directory. Mirrors what
    tests/e2e/invitation.spec.ts verifies against the source Next.js app, just via Django's test
    client instead of a real browser + Mailpit, since backend tests shouldn't depend on a running
    SMTP catcher."""

    def setUp(self):
        self.department = Department.objects.create(name="Engineering")
        self.admin = Employee.objects.create_user(
            email="admin@example.com",
            name="Admin User",
            password="AdminPass123",
            role=Role.ADMIN,
            title="HR Administrator",
            department=self.department,
        )
        self.client = APIClient()

    def test_full_invite_set_password_login_flow(self):
        self.client.force_authenticate(user=self.admin)
        # force_authenticate bypasses session/login entirely for the create-employee step (DRF
        # test convenience); the actual session-based login below is exercised for real.

        response = self.client.post(
            "/api/employees/",
            {"name": "New Hire", "email": "new.hire@example.com", "title": "Engineer", "department": self.department.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertFalse(response.data["has_password"])

        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("new.hire@example.com", mail.outbox[0].to)
        match = re.search(r"token=([\w\-]+)", mail.outbox[0].body)
        self.assertIsNotNone(match, "invitation email should contain a set-password link")
        raw_token = match.group(1)

        # HTML alternative part, matching the source app's formatted invite email (Prompt 5 item 5).
        self.assertEqual(len(mail.outbox[0].alternatives), 1)
        html_body, mimetype = mail.outbox[0].alternatives[0]
        self.assertEqual(mimetype, "text/html")
        self.assertIn("AGRILEAF", html_body)
        self.assertIn(f"token={raw_token}", html_body)

        self.client.force_authenticate(user=None)  # act as the anonymous invitee from here on

        check = self.client.get(f"/api/auth/set-password/?token={raw_token}")
        self.assertEqual(check.status_code, 200)
        self.assertTrue(check.data["valid"])
        self.assertEqual(check.data["purpose"], "INVITE")

        set_password = self.client.post(
            "/api/auth/set-password/", {"token": raw_token, "password": "BrandNewPass123"}, format="json"
        )
        self.assertEqual(set_password.status_code, 200)
        self.assertIn("sessionid", set_password.cookies)

        # A used invite link cannot be reused (mirrors invitation.spec.ts's second assertion).
        reused = self.client.get(f"/api/auth/set-password/?token={raw_token}")
        self.assertFalse(reused.data["valid"])
        self.assertEqual(reused.data["reason"], "USED")

        fresh_client = APIClient()
        login = fresh_client.post(
            "/api/auth/login/", {"email": "new.hire@example.com", "password": "BrandNewPass123"}, format="json"
        )
        self.assertEqual(login.status_code, 200)
        self.assertEqual(login.data["email"], "new.hire@example.com")

        directory = fresh_client.get("/api/employees/")
        self.assertEqual(directory.status_code, 403)  # the new hire is role=EMPLOYEE, not ADMIN

    def test_wrong_password_rejected_with_generic_message(self):
        response = self.client.post(
            "/api/auth/login/", {"email": "admin@example.com", "password": "WrongPassword"}, format="json"
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.data["detail"], "Invalid email or password.")

    def test_employee_directory_is_admin_only(self):
        employee = Employee.objects.create_user(
            email="regular@example.com", name="Regular Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.department,
        )
        client = APIClient()
        client.force_authenticate(user=employee)
        response = client.get("/api/employees/")
        self.assertEqual(response.status_code, 403)
