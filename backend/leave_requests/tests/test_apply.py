import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from holidays.models import Holiday
from leave_balances.services import get_or_create_balance
from leave_types.models import AccrualMethod

from ..models import LeaveRequest, LeaveStatus
from .helpers import make_department, make_employee, make_leave_type, make_manager


def _next_monday(after: datetime.date) -> datetime.date:
    days_ahead = (7 - after.weekday()) % 7 or 7
    return after + datetime.timedelta(days=days_ahead)


class ApplyLeaveRequestTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.manager = make_manager(self.dept)
        self.employee = make_employee(self.dept, manager=self.manager)
        self.client_ = APIClient()
        self.client_.force_authenticate(user=self.employee)
        self.today = timezone.now().date()
        self.monday = _next_monday(self.today)  # a clean future Monday for weekend/holiday tests

    def _apply(self, **overrides):
        payload = {
            "leave_type": self.leave_type.id,
            "start_date": self.monday.isoformat(),
            "end_date": self.monday.isoformat(),
            "reason": "Personal",
        }
        payload.update(overrides)
        return self.client_.post("/api/leave-requests/", payload, format="json")

    # --- happy paths ---

    def test_single_day_approval_required_creates_pending(self):
        self.leave_type = make_leave_type(requires_approval=True)
        response = self._apply()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "PENDING")
        self.assertEqual(response.data["days"], 1)
        self.assertTrue(response.data["reference_number"].startswith(f"LR-{self.monday.year}-"))

    def test_auto_approved_leave_type_creates_approved_and_deducts_balance(self):
        self.leave_type = make_leave_type(requires_approval=False, default_days_per_year=10)
        get_or_create_balance(self.employee, self.leave_type, self.monday.year)
        response = self._apply()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "APPROVED")
        balance = get_or_create_balance(self.employee, self.leave_type, self.monday.year)
        self.assertEqual(balance.used, 1)

    def test_pending_request_does_not_touch_balance(self):
        self.leave_type = make_leave_type(requires_approval=True, default_days_per_year=10)
        response = self._apply()
        self.assertEqual(response.status_code, 201)
        balance = get_or_create_balance(self.employee, self.leave_type, self.monday.year)
        self.assertEqual(balance.used, 0)

    def test_multi_day_leave_within_a_work_week_counts_all_days(self):
        self.leave_type = make_leave_type(requires_approval=True)
        start = self.monday
        end = start + datetime.timedelta(days=4)  # Mon-Fri
        response = self._apply(start_date=start.isoformat(), end_date=end.isoformat())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["days"], 5)

    def test_multi_day_leave_spanning_a_weekend_excludes_weekend_days(self):
        self.leave_type = make_leave_type(requires_approval=True)
        start = self.monday
        end = start + datetime.timedelta(days=6)  # Mon through the following Sun = 7 calendar days
        response = self._apply(start_date=start.isoformat(), end_date=end.isoformat())
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["days"], 5)  # Sat/Sun excluded

    def test_weekend_only_range_has_zero_working_days(self):
        self.leave_type = make_leave_type(requires_approval=True)
        saturday = self.monday + datetime.timedelta(days=5)
        sunday = self.monday + datetime.timedelta(days=6)
        response = self._apply(start_date=saturday.isoformat(), end_date=sunday.isoformat())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "NO_WORKING_DAYS")

    def test_mandatory_holiday_excluded_from_day_count(self):
        self.leave_type = make_leave_type(requires_approval=True)
        Holiday.objects.create(name="Company Holiday", date=self.monday, optional=False)
        response = self._apply()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "NO_WORKING_DAYS")

    def test_optional_holiday_excluded_identically_to_mandatory(self):
        self.leave_type = make_leave_type(requires_approval=True)
        Holiday.objects.create(name="Optional Festival", date=self.monday, optional=True)
        response = self._apply()
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "NO_WORKING_DAYS")

    def test_same_day_leave_on_working_day_counts_as_one_day(self):
        self.leave_type = make_leave_type(requires_approval=True)
        response = self._apply()
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["days"], 1)

    def test_uncapped_leave_type_skips_balance_check(self):
        self.leave_type = make_leave_type(requires_approval=True, default_days_per_year=0)
        response = self._apply()
        self.assertEqual(response.status_code, 201)

    # --- validation failures ---

    def test_end_before_start_rejected(self):
        self.leave_type = make_leave_type(requires_approval=True)
        response = self._apply(start_date=self.monday.isoformat(), end_date=(self.monday - datetime.timedelta(days=1)).isoformat())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "INVALID_RANGE")

    def test_backdated_start_rejected(self):
        self.leave_type = make_leave_type(requires_approval=True)
        past = self.today - datetime.timedelta(days=1)
        response = self._apply(start_date=past.isoformat(), end_date=past.isoformat())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "PAST_DATE")

    def test_start_date_today_is_allowed(self):
        self.leave_type = make_leave_type(requires_approval=True)
        # Only valid if today happens to be a working, non-holiday day; skip otherwise.
        if self.today.weekday() >= 5:
            self.skipTest("today is a weekend in this test run")
        response = self._apply(start_date=self.today.isoformat(), end_date=self.today.isoformat())
        self.assertEqual(response.status_code, 201)

    def test_inactive_leave_type_rejected(self):
        self.leave_type = make_leave_type(requires_approval=True, is_active=False)
        response = self._apply()
        # is_active=False leave types are excluded from the serializer's queryset entirely.
        self.assertEqual(response.status_code, 400)

    def test_no_manager_and_requires_approval_blocked(self):
        # Preserves the source app's exact guard (route.ts:73-75) and message.
        lone_employee = make_employee(self.dept, manager=None, email="lone@example.com")
        client = APIClient()
        client.force_authenticate(user=lone_employee)
        self.leave_type = make_leave_type(requires_approval=True)
        response = client.post(
            "/api/leave-requests/",
            {"leave_type": self.leave_type.id, "start_date": self.monday.isoformat(), "end_date": self.monday.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "NO_MANAGER")
        self.assertIn("Contact HR", response.data["detail"])

    def test_no_manager_but_auto_approved_leave_type_is_allowed(self):
        lone_employee = make_employee(self.dept, manager=None, email="lone2@example.com")
        client = APIClient()
        client.force_authenticate(user=lone_employee)
        self.leave_type = make_leave_type(requires_approval=False)
        response = client.post(
            "/api/leave-requests/",
            {"leave_type": self.leave_type.id, "start_date": self.monday.isoformat(), "end_date": self.monday.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

    def test_insufficient_balance_rejected(self):
        self.leave_type = make_leave_type(requires_approval=False, default_days_per_year=1)
        get_or_create_balance(self.employee, self.leave_type, self.monday.year)
        start = self.monday
        end = start + datetime.timedelta(days=4)  # Mon-Fri = 5 working days, only 1 allocated
        response = self._apply(start_date=start.isoformat(), end_date=end.isoformat())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "INSUFFICIENT_BALANCE")

    def test_overlapping_pending_request_blocks_new_request(self):
        self.leave_type = make_leave_type(requires_approval=True)
        first = self._apply()
        self.assertEqual(first.status_code, 201)
        other_leave_type = make_leave_type(name="Sick Leave", code="SL", requires_approval=True)
        response = self._apply(leave_type=other_leave_type.id)  # overlap check is across ALL leave types
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "OVERLAP")

    def test_overlap_not_blocked_by_rejected_or_cancelled_requests(self):
        self.leave_type = make_leave_type(requires_approval=True)
        rejected = LeaveRequest.objects.create(
            reference_number="LR-TEST-0001", employee=self.employee, leave_type=self.leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=LeaveStatus.REJECTED,
        )
        cancelled = LeaveRequest.objects.create(
            reference_number="LR-TEST-0002", employee=self.employee, leave_type=self.leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=LeaveStatus.CANCELLED,
        )
        response = self._apply()
        self.assertEqual(response.status_code, 201)

    def test_employee_id_in_payload_is_ignored_request_always_created_for_self(self):
        self.leave_type = make_leave_type(requires_approval=True)
        other_employee = make_employee(self.dept, manager=self.manager, email="victim@example.com")
        response = self._apply(employee_id=other_employee.id)
        self.assertEqual(response.status_code, 201)
        created = LeaveRequest.objects.get(reference_number=response.data["reference_number"])
        self.assertEqual(created.employee_id, self.employee.id)

    def test_anonymous_cannot_apply(self):
        self.leave_type = make_leave_type(requires_approval=True)
        response = APIClient().post(
            "/api/leave-requests/",
            {"leave_type": self.leave_type.id, "start_date": self.monday.isoformat(), "end_date": self.monday.isoformat()},
            format="json",
        )
        self.assertIn(response.status_code, (401, 403))
