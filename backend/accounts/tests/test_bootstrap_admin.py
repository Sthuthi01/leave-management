from io import StringIO

from django.core import mail
from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase, override_settings

from accounts.models import Employee, Role
from departments.models import Department


@override_settings(ALLOW_BOOTSTRAP_ADMIN=True)  # the command's own opt-in guard is tested
# explicitly below with its own override — everything else here exercises the "operator has
# deliberately opted in for this invocation" path.
class BootstrapAdminCommandTest(TestCase):
    def test_refuses_when_admin_already_exists(self):
        department = Department.objects.create(name="Engineering")
        Employee.objects.create_user(
            email="existing.admin@example.com", name="Existing Admin", password="Pass1234567",
            role=Role.ADMIN, title="HR Administrator", department=department,
        )
        with self.assertRaisesMessage(CommandError, "an HR Admin already exists"):
            call_command("bootstrap_admin", name="New Admin", email="new.admin@example.com", stdout=StringIO())

    @override_settings(ALLOW_BOOTSTRAP_ADMIN=False)
    def test_refuses_without_explicit_opt_in(self):
        with self.assertRaisesMessage(CommandError, "ALLOW_BOOTSTRAP_ADMIN"):
            call_command("bootstrap_admin", name="New Admin", email="new.admin@example.com", stdout=StringIO())

    @override_settings(ALLOW_BOOTSTRAP_ADMIN=False, DEBUG=False)
    def test_refuses_without_opt_in_even_with_debug_false(self):
        # The whole point of this redesign: DEBUG=False alone must not be treated as sufficient
        # to block or allow this command — only ALLOW_BOOTSTRAP_ADMIN decides.
        with self.assertRaisesMessage(CommandError, "ALLOW_BOOTSTRAP_ADMIN"):
            call_command("bootstrap_admin", name="New Admin", email="new.admin@example.com", stdout=StringIO())

    @override_settings(ALLOW_BOOTSTRAP_ADMIN=True, DEBUG=False)
    def test_succeeds_with_opt_in_even_with_debug_false(self):
        # The core requirement: the first HR Admin must be creatable in a hardened, DEBUG=False
        # environment without weakening DEBUG or any other security setting.
        call_command("bootstrap_admin", name="Priya Sharma", email="priya@example.com", stdout=StringIO())
        employee = Employee.objects.get(email="priya@example.com")
        self.assertEqual(employee.role, Role.ADMIN)
        self.assertFalse(employee.has_usable_password())

    def test_creates_admin_with_no_password_and_sends_invite(self):
        out = StringIO()
        call_command("bootstrap_admin", name="Priya Sharma", email="priya@example.com", stdout=out)

        employee = Employee.objects.get(email="priya@example.com")
        self.assertEqual(employee.role, Role.ADMIN)
        self.assertFalse(employee.has_usable_password())
        self.assertEqual(Department.objects.count(), 1)
        self.assertEqual(Department.objects.first().name, "General")

        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("priya@example.com", mail.outbox[0].to)
        self.assertIn("Created HR Admin", out.getvalue())

    def test_reuses_existing_department_instead_of_creating_another(self):
        Department.objects.create(name="People Ops")
        call_command("bootstrap_admin", name="Priya Sharma", email="priya@example.com", stdout=StringIO())
        self.assertEqual(Department.objects.count(), 1)
