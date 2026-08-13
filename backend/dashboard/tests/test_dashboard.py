import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Role
from holidays.models import Holiday
from leave_requests.services import apply_leave_request, decide_leave_request
from leave_requests.tests.helpers import make_department, make_employee, make_leave_type, make_manager


def _next_monday(after: datetime.date) -> datetime.date:
    days_ahead = (7 - after.weekday()) % 7 or 7
    return after + datetime.timedelta(days=days_ahead)


class DashboardTest(TestCase):
    def setUp(self):
        self.department = make_department()
        self.manager = make_manager(self.department)
        self.employee = make_employee(self.department, manager=self.manager)
        self.leave_type = make_leave_type()
        self.client = APIClient()

    def test_requires_authentication(self):
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.status_code, 403)

    def test_authenticated_employee_gets_full_payload_shape(self):
        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.status_code, 200)
        for key in ("balances", "recent_requests", "upcoming_leave", "upcoming_holidays", "pending_approvals_count"):
            self.assertIn(key, response.data)

    def test_manager_gets_the_same_shape_as_employee(self):
        # MANAGER is not ADMIN, so it still gets the employee/EMPLOYEE-branch payload — only
        # ADMIN gets the distinct HR branch added in Phase 5 (see dashboard.tests.test_hr_dashboard).
        for user in (self.manager, self.employee):
            self.client.force_authenticate(user=user)
            response = self.client.get("/api/dashboard/")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(
                set(response.data.keys()),
                {
                    "kind",
                    "balances",
                    "recent_requests",
                    "upcoming_leave",
                    "upcoming_holidays",
                    "pending_approvals_count",
                },
            )
            self.assertEqual(response.data["kind"], "EMPLOYEE")

    def test_own_balance_visible_for_active_leave_types(self):
        make_leave_type(name="Casual Leave", code="CL", default_days_per_year=12)
        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/dashboard/")
        codes = {b["leave_type"]["code"] for b in response.data["balances"]}
        self.assertEqual(codes, {"AL", "CL"})

    def test_inactive_leave_type_excluded_from_balances(self):
        make_leave_type(name="Retired Leave", code="RL", is_active=False)
        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/dashboard/")
        codes = {b["leave_type"]["code"] for b in response.data["balances"]}
        self.assertNotIn("RL", codes)

    def test_recent_requests_are_own_only_not_another_employees(self):
        other = make_employee(self.department, manager=self.manager, email="other@example.com")
        apply_leave_request(
            employee=other, leave_type=self.leave_type,
            start_date=datetime.date.today() + datetime.timedelta(days=5),
            end_date=datetime.date.today() + datetime.timedelta(days=7), reason="",
        )
        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.data["recent_requests"], [])

    def test_recent_requests_limited_to_five_most_recent(self):
        # 3-day windows spaced 5 days apart — wide enough that every window guarantees at least
        # one weekday (avoids apply_leave_request's NO_WORKING_DAYS error on an all-weekend range)
        # and spaced out to avoid the overlap guard rejecting a later request.
        for i in range(7):
            offset = 30 + i * 5
            apply_leave_request(
                employee=self.employee, leave_type=self.leave_type,
                start_date=datetime.date.today() + datetime.timedelta(days=offset),
                end_date=datetime.date.today() + datetime.timedelta(days=offset + 2), reason="",
            )
        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/dashboard/")
        self.assertEqual(len(response.data["recent_requests"]), 5)

    def test_upcoming_leave_only_includes_future_approved_requests(self):
        # Mon-Tue windows anchored off the next Monday, rather than fixed +10/+20-day offsets —
        # a fixed 2-day offset can land entirely on a weekend (0 working days), which made this
        # test's own apply_leave_request calls flaky depending on which day the suite runs
        # (confirmed: today+10/+11 landed on a Sat/Sun in the run that first surfaced this).
        near_monday = _next_monday(datetime.date.today() + datetime.timedelta(days=7))
        far_monday = _next_monday(near_monday + datetime.timedelta(days=8))
        auto_approve_type = make_leave_type(name="Casual Leave", code="CL", requires_approval=False)
        apply_leave_request(
            employee=self.employee, leave_type=auto_approve_type,
            start_date=near_monday,
            end_date=near_monday + datetime.timedelta(days=1), reason="",
        )
        pending = apply_leave_request(
            employee=self.employee, leave_type=self.leave_type,
            start_date=far_monday,
            end_date=far_monday + datetime.timedelta(days=1), reason="",
        )
        self.assertEqual(pending.status, "PENDING")

        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/dashboard/")
        self.assertEqual(len(response.data["upcoming_leave"]), 1)
        self.assertEqual(response.data["upcoming_leave"][0]["status"], "APPROVED")

    def test_upcoming_holidays_ordered_and_excludes_past(self):
        Holiday.objects.create(name="Past Holiday", date=datetime.date.today() - datetime.timedelta(days=5))
        later = Holiday.objects.create(name="Later Holiday", date=datetime.date.today() + datetime.timedelta(days=20))
        sooner = Holiday.objects.create(name="Sooner Holiday", date=datetime.date.today() + datetime.timedelta(days=5))
        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/dashboard/")
        names = [h["name"] for h in response.data["upcoming_holidays"]]
        self.assertEqual(names, [sooner.name, later.name])
        self.assertNotIn("Past Holiday", names)

    def test_pending_approvals_count_reflects_requests_assigned_to_caller(self):
        apply_leave_request(
            employee=self.employee, leave_type=self.leave_type,
            start_date=datetime.date.today() + datetime.timedelta(days=8),
            end_date=datetime.date.today() + datetime.timedelta(days=10), reason="",
        )
        self.client.force_authenticate(user=self.manager)
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.data["pending_approvals_count"], 1)

        self.client.force_authenticate(user=self.employee)
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.data["pending_approvals_count"], 0)

    def test_pending_approvals_count_excludes_already_decided_requests(self):
        request = apply_leave_request(
            employee=self.employee, leave_type=self.leave_type,
            start_date=datetime.date.today() + datetime.timedelta(days=8),
            end_date=datetime.date.today() + datetime.timedelta(days=10), reason="",
        )
        decide_leave_request(approver=self.manager, leave_request_id=request.id, decision="APPROVED", comment=None)
        self.client.force_authenticate(user=self.manager)
        response = self.client.get("/api/dashboard/")
        self.assertEqual(response.data["pending_approvals_count"], 0)
