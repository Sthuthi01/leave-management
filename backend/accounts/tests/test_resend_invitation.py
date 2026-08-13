import re

from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, EmployeeStatus, Role
from accounts.tokens import create_token
from departments.models import Department


class ResendInvitationTest(TestCase):
    def setUp(self):
        self.department = Department.objects.create(name="Engineering")
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.department,
        )
        self.non_admin = Employee.objects.create_user(
            email="manager@example.com", name="Manager", password="Pass1234567",
            role=Role.MANAGER, title="Manager", department=self.department,
        )
        self.pending_employee = Employee(
            email="pending@example.com", name="Pending Hire", role=Role.EMPLOYEE,
            title="Engineer", department=self.department, status=EmployeeStatus.ACTIVE,
        )
        self.pending_employee.set_unusable_password()
        self.pending_employee.save()

        self.client = APIClient()

    def test_admin_can_resend_invitation(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f"/api/employees/{self.pending_employee.id}/resend-invitation/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("pending@example.com", mail.outbox[0].to)

    def test_resending_invalidates_prior_unused_token(self):
        old_raw_token = create_token(self.pending_employee, "INVITE")
        self.client.force_authenticate(user=self.admin)
        self.client.post(f"/api/employees/{self.pending_employee.id}/resend-invitation/")

        new_raw_token = re.search(r"token=(\S+)", mail.outbox[0].body).group(1)
        self.assertNotEqual(old_raw_token, new_raw_token)

        old_check = self.client.get(f"/api/auth/set-password/?token={old_raw_token}")
        self.assertFalse(old_check.data["valid"])
        new_check = self.client.get(f"/api/auth/set-password/?token={new_raw_token}")
        self.assertTrue(new_check.data["valid"])

    def test_non_admin_cannot_resend_invitation(self):
        self.client.force_authenticate(user=self.non_admin)
        response = self.client.post(f"/api/employees/{self.pending_employee.id}/resend-invitation/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(mail.outbox), 0)

    def test_unauthenticated_cannot_resend_invitation(self):
        response = self.client.post(f"/api/employees/{self.pending_employee.id}/resend-invitation/")
        self.assertEqual(response.status_code, 403)

    def test_already_activated_employee_rejected(self):
        active = Employee.objects.create_user(
            email="active@example.com", name="Active", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.department,
        )
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f"/api/employees/{active.id}/resend-invitation/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)

    def test_deactivated_employee_rejected(self):
        self.pending_employee.status = EmployeeStatus.INACTIVE
        self.pending_employee.save(update_fields=["status"])
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f"/api/employees/{self.pending_employee.id}/resend-invitation/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)

    def test_nonexistent_employee_404s(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/employees/999999/resend-invitation/")
        self.assertEqual(response.status_code, 404)
