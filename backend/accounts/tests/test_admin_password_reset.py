import re

from django.core import mail
from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, EmployeeStatus, Role
from departments.models import Department


class AdminSendPasswordResetTest(TestCase):
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
        self.active_employee = Employee.objects.create_user(
            email="active@example.com", name="Active", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.department,
        )
        self.client = APIClient()

    def test_admin_can_send_password_reset(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f"/api/employees/{self.active_employee.id}/send-password-reset/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("active@example.com", mail.outbox[0].to)

    def test_reset_token_purpose_is_reset_not_invite(self):
        self.client.force_authenticate(user=self.admin)
        self.client.post(f"/api/employees/{self.active_employee.id}/send-password-reset/")
        raw_token = re.search(r"token=(\S+)", mail.outbox[0].body).group(1)
        check = self.client.get(f"/api/auth/set-password/?token={raw_token}")
        self.assertEqual(check.data["purpose"], "RESET")

    def test_non_admin_cannot_trigger_reset(self):
        self.client.force_authenticate(user=self.non_admin)
        response = self.client.post(f"/api/employees/{self.active_employee.id}/send-password-reset/")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(len(mail.outbox), 0)

    def test_unauthenticated_cannot_trigger_reset(self):
        response = self.client.post(f"/api/employees/{self.active_employee.id}/send-password-reset/")
        self.assertEqual(response.status_code, 403)

    def test_never_activated_employee_rejected(self):
        pending = Employee(
            email="pending@example.com", name="Pending", role=Role.EMPLOYEE,
            title="Engineer", department=self.department, status=EmployeeStatus.ACTIVE,
        )
        pending.set_unusable_password()
        pending.save()
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f"/api/employees/{pending.id}/send-password-reset/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)

    def test_deactivated_employee_rejected(self):
        self.active_employee.status = EmployeeStatus.INACTIVE
        self.active_employee.save(update_fields=["status"])
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(f"/api/employees/{self.active_employee.id}/send-password-reset/")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(mail.outbox), 0)

    def test_nonexistent_employee_404s(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post("/api/employees/999999/send-password-reset/")
        self.assertEqual(response.status_code, 404)
