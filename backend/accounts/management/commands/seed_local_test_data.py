"""Populates the LOCAL database with a realistic, fixed set of test users, leave types, a
holiday, and leave requests in every status — purely for manual/local testing of the
React + Django stack. Never intended for UAT or production: refuses to run unless DEBUG=True.

Unlike the normal employee-creation path (EmployeeListCreateView, bootstrap_admin), this command
sets REAL, KNOWN passwords directly via create_user() rather than an unusable password + invite
email — a deliberate local-only shortcut so a human tester can log in immediately without
extracting tokens from Mailpit. Every real employee-creation path in the app still goes through
the invite flow unchanged; this command doesn't touch or bypass that machinery for anyone else.

Idempotent: safe to run more than once. Departments/leave types/the holiday are get_or_create'd;
employees are matched by email and left alone if they already exist; leave requests are only
created if a matching one (same employee/leave_type/date range) doesn't already exist. Use
--flush to remove just this command's own test employees (and their leave data) first, or wipe
the whole local database for a guaranteed-clean slate (see DEPLOYMENT.backend.md's "Database
reset" note).

Usage:
  python manage.py seed_local_test_data
  python manage.py seed_local_test_data --flush   (removes prior test employees/data first)
"""
from datetime import date, timedelta

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError

from accounts.models import Employee, EmployeeStatus, Role
from departments.models import Department
from holidays.models import Holiday
from leave_balances.models import LeaveBalance
from leave_balances.services import get_or_create_balance
from leave_requests.models import LeaveRequest
from leave_requests.services import ApplyLeaveError, apply_leave_request, decide_leave_request
from leave_types.models import AccrualMethod, LeaveType

TEST_PASSWORD = "TestPass123"

TEST_USERS = [
    # key, name, email, role, department, manager_key
    ("hr_admin", "HR Admin", "hradmin@test.local", Role.ADMIN, "HR", None),
    ("manager1", "Manager One", "manager1@test.local", Role.MANAGER, "Department A", None),
    ("employee1", "Employee One", "employee1@test.local", Role.EMPLOYEE, "Department A", "manager1"),
    ("employee2", "Employee Two", "employee2@test.local", Role.EMPLOYEE, "Department A", "manager1"),
    ("manager2", "Manager Two", "manager2@test.local", Role.MANAGER, "Department B", None),
    ("employee3", "Employee Three", "employee3@test.local", Role.EMPLOYEE, "Department B", "manager2"),
]
TEST_EMAILS = [u[2] for u in TEST_USERS]


def _next_weekday(d: date) -> date:
    while d.weekday() >= 5:  # Sat=5, Sun=6
        d += timedelta(days=1)
    return d


class Command(BaseCommand):
    help = "Seeds a fixed set of local test users, leave types, a holiday, and leave requests. Local/DEBUG only."

    def add_arguments(self, parser):
        parser.add_argument("--flush", action="store_true", help="Remove this command's own test employees/data first.")

    def handle(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError(
                "Refusing to run: DJANGO_DEBUG is not true. This command creates known test "
                "passwords and is for local development only — never run it against UAT or "
                "production."
            )

        if options["flush"]:
            self._flush()

        today = date.today()
        last_year = today.year - 1

        # ---- Departments ----
        departments = {}
        for name in ("HR", "Department A", "Department B"):
            dept, created = Department.objects.get_or_create(name=name)
            departments[name] = dept
            self.stdout.write(f'{"Created" if created else "Reused"} department "{name}".')

        # ---- Leave types: one requires approval, one auto-approves — both ANNUAL accrual so
        # balances are simple whole numbers (no monthly proration) for predictable manual testing.
        annual_leave, created = LeaveType.objects.get_or_create(
            code="AL",
            defaults={
                "name": "Annual Leave", "color": "#16a34a", "default_days_per_year": 20,
                "requires_approval": True, "is_active": True,
                "accrual_method": AccrualMethod.ANNUAL, "carry_forward_limit": 5,
            },
        )
        self.stdout.write(f'{"Created" if created else "Reused"} leave type "Annual Leave" (AL, requires approval).')

        casual_leave, created = LeaveType.objects.get_or_create(
            code="CL",
            defaults={
                "name": "Casual Leave", "color": "#f59e0b", "default_days_per_year": 12,
                "requires_approval": False, "is_active": True,
                "accrual_method": AccrualMethod.ANNUAL, "carry_forward_limit": 0,
            },
        )
        self.stdout.write(f'{"Created" if created else "Reused"} leave type "Casual Leave" (CL, auto-approved).')

        # ---- Holiday: a weekday roughly 2 weeks out, so it's visible and usable in a manual
        # "apply leave spanning a holiday" test regardless of when this command is run.
        holiday_date = _next_weekday(today + timedelta(days=14))
        holiday, created = Holiday.objects.get_or_create(
            date=holiday_date, defaults={"name": "Founders Day (Test Holiday)", "optional": False}
        )
        self.stdout.write(f'{"Created" if created else "Reused"} holiday "{holiday.name}" on {holiday_date}.')

        # ---- Working-day configuration now lives in OrganizationSettings (Phase 4) — defaults to
        # Mon-Fri via OrganizationSettings.load(), nothing to seed explicitly here.
        from org_settings.models import OrganizationSettings

        org_settings = OrganizationSettings.load()
        self.stdout.write(f"Working days: {sorted(org_settings.working_days)} (0=Mon...6=Sun, from OrganizationSettings).")

        # ---- Employees ----
        employees = {}
        for key, name, email, role, dept_name, manager_key in TEST_USERS:
            existing = Employee.objects.filter(email=email).first()
            if existing:
                employees[key] = existing
                self.stdout.write(f'Reused employee "{name}" <{email}> (already exists).')
                continue
            employee = Employee.objects.create_user(
                email=email, name=name, password=TEST_PASSWORD, role=role, title=self._title_for(role),
                department=departments[dept_name], joined_at=date(last_year, 1, 1), status=EmployeeStatus.ACTIVE,
            )
            employees[key] = employee
            self.stdout.write(self.style.SUCCESS(f'Created employee "{name}" <{email}> (role={role}).'))

        # Wire up manager FKs now that every employee exists (managers are created before their
        # reports in TEST_USERS, but re-running with some already existing needs this pass anyway).
        for key, _name, _email, _role, _dept_name, manager_key in TEST_USERS:
            if manager_key and employees[key].manager_id != employees[manager_key].id:
                employees[key].manager = employees[manager_key]
                employees[key].save(update_fields=["manager"])

        # ---- Leave balances: ensure every employee has a visible balance row for both leave
        # types even before any request is applied. Requests below reuse these same rows.
        for key in ("employee1", "employee2", "employee3"):
            for leave_type in (annual_leave, casual_leave):
                get_or_create_balance(employees[key], leave_type, today.year)
        self.stdout.write("Ensured Annual/Casual Leave balances exist for Employee One/Two/Three.")

        # ---- Leave requests: 2 pending (one per manager), 1 approved, 1 rejected, 1 auto-approved.
        self._seed_request(
            employees["employee1"], annual_leave, today + timedelta(days=7), today + timedelta(days=9),
            "Family visit", decide=None,
        )
        self._seed_request(
            employees["employee3"], annual_leave, today + timedelta(days=10), today + timedelta(days=12),
            "Personal trip", decide=None,
        )
        self._seed_request(
            employees["employee2"], annual_leave, today + timedelta(days=3), today + timedelta(days=5),
            "Wedding", decide=("APPROVED", employees["manager1"], None),
        )
        self._seed_request(
            employees["employee2"], annual_leave, today + timedelta(days=16), today + timedelta(days=18),
            "Extended travel", decide=("REJECTED", employees["manager1"], "Team is short-staffed that week — please pick different dates."),
        )
        self._seed_request(
            employees["employee1"], casual_leave, today + timedelta(days=20), today + timedelta(days=21),
            "Appointment", decide=None,  # auto-approved at apply time, nothing to decide
        )

        self.stdout.write(self.style.SUCCESS("Local test data seed complete."))

    def _title_for(self, role: str) -> str:
        return {Role.ADMIN: "HR Administrator", Role.MANAGER: "Manager", Role.EMPLOYEE: "Employee"}[role]

    def _seed_request(self, employee, leave_type, start_date, end_date, reason, decide):
        if LeaveRequest.objects.filter(employee=employee, leave_type=leave_type, start_date=start_date, end_date=end_date).exists():
            self.stdout.write(f"Reused existing leave request for {employee.name} ({start_date}..{end_date}).")
            return
        try:
            leave_request = apply_leave_request(
                employee=employee, leave_type=leave_type, start_date=start_date, end_date=end_date, reason=reason
            )
        except ApplyLeaveError as exc:
            self.stdout.write(self.style.WARNING(f"Skipped a seed request for {employee.name}: {exc.message}"))
            return

        if decide:
            decision, approver, comment = decide
            decide_leave_request(approver=approver, leave_request_id=leave_request.id, decision=decision, comment=comment)
            self.stdout.write(self.style.SUCCESS(
                f"Created {decision} leave request {leave_request.reference_number} for {employee.name}."
            ))
        else:
            leave_request.refresh_from_db()
            self.stdout.write(self.style.SUCCESS(
                f"Created {leave_request.status} leave request {leave_request.reference_number} for {employee.name}."
            ))

    def _flush(self):
        test_employees = Employee.objects.filter(email__in=TEST_EMAILS)
        if not test_employees.exists():
            self.stdout.write("--flush: no existing test employees found, nothing to remove.")
            return
        deleted_requests, _ = LeaveRequest.objects.filter(employee__in=test_employees).delete()
        deleted_balances, _ = LeaveBalance.objects.filter(employee__in=test_employees).delete()
        deleted_employees, _ = test_employees.delete()
        self.stdout.write(
            f"--flush: removed {deleted_employees} test employee(s), {deleted_requests} leave "
            f"request(s), {deleted_balances} balance row(s)."
        )
