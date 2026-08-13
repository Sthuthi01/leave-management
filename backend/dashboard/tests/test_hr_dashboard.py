import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Employee, EmployeeStatus, Role
from leave_balances.services import get_or_create_balance
from leave_requests.models import LeaveRequest
from leave_requests.services import apply_leave_request, decide_leave_request
from leave_requests.tests.helpers import make_department, make_employee, make_leave_type, make_manager
from org_settings.models import OrganizationSettings


def _next_monday(after: datetime.date) -> datetime.date:
    days_ahead = (7 - after.weekday()) % 7 or 7
    return after + datetime.timedelta(days=days_ahead)


def _next_weekday(date: datetime.date) -> datetime.date:
    while date.weekday() >= 5:  # Sat=5, Sun=6
        date += datetime.timedelta(days=1)
    return date


class HrDashboardTest(TestCase):
    def setUp(self):
        self.dept_a = make_department(name="Department A")
        self.dept_b = make_department(name="Department B")
        self.manager = make_manager(self.dept_a, email="manager@example.com")
        self.employee_a1 = make_employee(self.dept_a, manager=self.manager, email="a1@example.com")
        self.employee_a2 = make_employee(self.dept_a, manager=self.manager, email="a2@example.com")
        self.employee_b = make_employee(self.dept_b, manager=self.manager, email="b1@example.com")
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept_a,
        )
        self.leave_type = make_leave_type(requires_approval=True)
        self.auto_leave_type = make_leave_type(name="Casual Leave", code="CL", requires_approval=False)
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.today = timezone.now().date()

    def _backdate(self, leave_request, days_ago):
        LeaveRequest.objects.filter(pk=leave_request.pk).update(
            applied_at=timezone.now() - datetime.timedelta(days=days_ago)
        )

    def test_admin_gets_hr_kind_and_expected_keys(self):
        response = self.admin_client.get("/api/dashboard/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["kind"], "HR")
        for key in (
            "kind", "on_leave_today", "on_leave_this_week", "leave_utilization", "department_stats",
            "attention_pending_approvals", "employees_without_manager", "total_employees",
            "pending_approvals_count", "recent_requests", "upcoming_holidays",
        ):
            self.assertIn(key, response.data)

    def test_on_leave_today_includes_only_approved_spanning_today(self):
        apply_leave_request(
            employee=self.employee_a1, leave_type=self.auto_leave_type,
            start_date=self.today, end_date=self.today, reason="",
        )
        # A fixed +10-day single-day offset can land on a weekend (0 working days), which made
        # this call — meant only to be "some other approved day, not today" — flaky depending on
        # which day the suite runs. _next_monday guarantees a working day that's never "today".
        not_today = _next_monday(self.today + datetime.timedelta(days=7))
        apply_leave_request(
            employee=self.employee_a2, leave_type=self.auto_leave_type,
            start_date=not_today,
            end_date=not_today, reason="",
        )
        pending = apply_leave_request(
            employee=self.employee_b, leave_type=self.leave_type,
            start_date=self.today, end_date=self.today, reason="",
        )
        self.assertEqual(pending.status, "PENDING")

        response = self.admin_client.get("/api/dashboard/")
        ids = {r["employee"]["id"] for r in response.data["on_leave_today"]}
        self.assertEqual(ids, {self.employee_a1.id})

    def test_on_leave_this_week_counts_overlapping_approved_requests(self):
        # The dashboard's "this week" window is today..today+6 (see dashboard/views.py's
        # week_end = today + 6 days). A fixed +3-day offset can land on a weekend, and shifting a
        # weekend date forward to the next weekday moves it at most 2 days — so today+3 nudged
        # this way always stays within the 7-day window (worst case today+5). +20 only needs to
        # be a working day comfortably outside that window, which the same nudge preserves.
        within_this_week = _next_weekday(self.today + datetime.timedelta(days=3))
        outside_this_week = _next_weekday(self.today + datetime.timedelta(days=20))
        apply_leave_request(
            employee=self.employee_a1, leave_type=self.auto_leave_type,
            start_date=within_this_week,
            end_date=within_this_week, reason="",
        )
        apply_leave_request(
            employee=self.employee_a2, leave_type=self.auto_leave_type,
            start_date=outside_this_week,
            end_date=outside_this_week, reason="",
        )
        response = self.admin_client.get("/api/dashboard/")
        self.assertEqual(response.data["on_leave_this_week"], 1)

    def test_leave_utilization_includes_all_active_types_defaulting_to_zero(self):
        make_leave_type(name="Retired Leave", code="RL", is_active=False)
        balance = get_or_create_balance(self.employee_a1, self.leave_type, self.today.year)
        balance.used = 4
        balance.save(update_fields=["used"])

        response = self.admin_client.get("/api/dashboard/")
        by_code = {row["leave_type"]["code"]: row for row in response.data["leave_utilization"]}
        self.assertIn(self.leave_type.code, by_code)
        self.assertIn(self.auto_leave_type.code, by_code)
        self.assertNotIn("RL", by_code)
        self.assertEqual(by_code[self.leave_type.code]["used"], 4)
        # No balance rows exist for the auto-approve type yet — must default to 0, not be omitted.
        self.assertEqual(by_code[self.auto_leave_type.code]["used"], 0)
        self.assertEqual(by_code[self.auto_leave_type.code]["allocated"], 0)

    def test_department_stats_employee_count_and_on_leave_today(self):
        apply_leave_request(
            employee=self.employee_a1, leave_type=self.auto_leave_type,
            start_date=self.today, end_date=self.today, reason="",
        )
        response = self.admin_client.get("/api/dashboard/")
        stats_by_name = {row["department"]["name"]: row for row in response.data["department_stats"]}
        self.assertEqual(stats_by_name["Department A"]["employee_count"], 4)  # admin + manager + a1 + a2
        self.assertEqual(stats_by_name["Department A"]["on_leave_today"], 1)
        self.assertEqual(stats_by_name["Department B"]["employee_count"], 1)
        self.assertEqual(stats_by_name["Department B"]["on_leave_today"], 0)

    def test_department_stats_excludes_inactive_employees_from_count(self):
        self.employee_a2.status = EmployeeStatus.INACTIVE
        self.employee_a2.save(update_fields=["status"])
        response = self.admin_client.get("/api/dashboard/")
        stats_by_name = {row["department"]["name"]: row for row in response.data["department_stats"]}
        self.assertEqual(stats_by_name["Department A"]["employee_count"], 3)  # admin + manager + a1

    def test_urgent_by_waited_too_long(self):
        OrganizationSettings.load()  # ensure default pending_approval_urgency_days=3 exists
        urgent = apply_leave_request(
            employee=self.employee_a1, leave_type=self.leave_type,
            start_date=self.today + datetime.timedelta(days=30),
            end_date=self.today + datetime.timedelta(days=30), reason="",
        )
        self._backdate(urgent, days_ago=5)  # waited 5 days >= default urgency threshold of 3
        response = self.admin_client.get("/api/dashboard/")
        ids = {item["request"]["id"] for item in response.data["attention_pending_approvals"]}
        self.assertIn(urgent.id, ids)

    def test_urgent_by_starting_soon_even_if_just_applied(self):
        urgent = apply_leave_request(
            employee=self.employee_a1, leave_type=self.leave_type,
            start_date=self.today + datetime.timedelta(days=1),
            end_date=self.today + datetime.timedelta(days=1), reason="",
        )
        # applied_at stays "now" (0 days pending) — starts tomorrow, within STARTING_SOON_DAYS=2.
        response = self.admin_client.get("/api/dashboard/")
        ids = {item["request"]["id"] for item in response.data["attention_pending_approvals"]}
        self.assertIn(urgent.id, ids)

    def test_not_urgent_excluded(self):
        not_urgent = apply_leave_request(
            employee=self.employee_a1, leave_type=self.leave_type,
            start_date=self.today + datetime.timedelta(days=30),
            end_date=self.today + datetime.timedelta(days=30), reason="",
        )
        # 0 days pending, starts in 30 days — neither urgency condition applies.
        response = self.admin_client.get("/api/dashboard/")
        ids = {item["request"]["id"] for item in response.data["attention_pending_approvals"]}
        self.assertNotIn(not_urgent.id, ids)

    def test_urgency_sort_soonest_start_first_then_longest_waiting(self):
        far = apply_leave_request(
            employee=self.employee_a1, leave_type=self.leave_type,
            start_date=self.today + datetime.timedelta(days=30),
            end_date=self.today + datetime.timedelta(days=30), reason="",
        )
        self._backdate(far, days_ago=10)  # urgent via waited-too-long, starts far away (soon=30)

        soon = apply_leave_request(
            employee=self.employee_a2, leave_type=self.leave_type,
            start_date=self.today + datetime.timedelta(days=1),
            end_date=self.today + datetime.timedelta(days=1), reason="",
        )  # urgent via starting-soon, days_until_start=1 < far's 30

        response = self.admin_client.get("/api/dashboard/")
        ids_in_order = [item["request"]["id"] for item in response.data["attention_pending_approvals"]]
        self.assertLess(ids_in_order.index(soon.id), ids_in_order.index(far.id))

    def test_urgency_tie_break_longest_waiting_first(self):
        less_waited = apply_leave_request(
            employee=self.employee_a1, leave_type=self.leave_type,
            start_date=self.today + datetime.timedelta(days=1), end_date=self.today + datetime.timedelta(days=1),
            reason="",
        )
        self._backdate(less_waited, days_ago=1)

        more_waited = apply_leave_request(
            employee=self.employee_a2, leave_type=self.leave_type,
            start_date=self.today + datetime.timedelta(days=1), end_date=self.today + datetime.timedelta(days=1),
            reason="",
        )
        self._backdate(more_waited, days_ago=4)

        response = self.admin_client.get("/api/dashboard/")
        ids_in_order = [item["request"]["id"] for item in response.data["attention_pending_approvals"]]
        self.assertLess(ids_in_order.index(more_waited.id), ids_in_order.index(less_waited.id))

    def test_attention_pending_approvals_capped_at_six(self):
        extra_employees = [
            make_employee(self.dept_a, manager=self.manager, email=f"extra{i}@example.com") for i in range(7)
        ]
        for i, emp in enumerate(extra_employees):
            apply_leave_request(
                employee=emp, leave_type=self.leave_type,
                start_date=self.today + datetime.timedelta(days=1), end_date=self.today + datetime.timedelta(days=1),
                reason="",
            )
        response = self.admin_client.get("/api/dashboard/")
        self.assertEqual(len(response.data["attention_pending_approvals"]), 6)

    def test_employees_without_manager_excludes_admin_and_inactive(self):
        no_manager_employee = make_employee(self.dept_a, email="nomgr@example.com")
        inactive_no_manager = make_employee(self.dept_a, email="inactive-nomgr@example.com")
        inactive_no_manager.status = EmployeeStatus.INACTIVE
        inactive_no_manager.save(update_fields=["status"])

        response = self.admin_client.get("/api/dashboard/")
        ids = {e["id"] for e in response.data["employees_without_manager"]}
        self.assertIn(no_manager_employee.id, ids)
        self.assertNotIn(inactive_no_manager.id, ids)
        self.assertNotIn(self.admin.id, ids)  # admin itself has no manager but must be excluded

    def test_total_employees_counts_active_only(self):
        self.employee_b.status = EmployeeStatus.INACTIVE
        self.employee_b.save(update_fields=["status"])
        response = self.admin_client.get("/api/dashboard/")
        # admin + manager + a1 + a2 + b(inactive, excluded) = 4 active
        self.assertEqual(response.data["total_employees"], 4)

    def test_pending_approvals_count_is_company_wide_not_approver_scoped(self):
        # employee_a1's approver is self.manager, not the admin caller — HR's count must still
        # include it (contrast with the employee/manager branch's approver-scoped count).
        # A 3-day range guarantees at least one working day regardless of what day "today" is.
        apply_leave_request(
            employee=self.employee_a1, leave_type=self.leave_type,
            start_date=self.today + datetime.timedelta(days=5), end_date=self.today + datetime.timedelta(days=7),
            reason="",
        )
        response = self.admin_client.get("/api/dashboard/")
        self.assertEqual(response.data["pending_approvals_count"], 1)

    def test_recent_requests_are_company_wide(self):
        apply_leave_request(
            employee=self.employee_b, leave_type=self.leave_type,
            start_date=self.today + datetime.timedelta(days=5), end_date=self.today + datetime.timedelta(days=7),
            reason="",
        )
        response = self.admin_client.get("/api/dashboard/")
        ids = {r["employee"]["id"] for r in response.data["recent_requests"]}
        self.assertIn(self.employee_b.id, ids)
