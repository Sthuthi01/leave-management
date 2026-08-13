import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from holidays.models import Holiday
from leave_balances.services import get_or_create_balance

from .helpers import make_department, make_employee, make_leave_type, make_manager


def _next_monday(after: datetime.date) -> datetime.date:
    days_ahead = (7 - after.weekday()) % 7 or 7
    return after + datetime.timedelta(days=days_ahead)


class PreviewLeaveRequestTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.manager = make_manager(self.dept)
        self.employee = make_employee(self.dept, manager=self.manager)
        self.client_ = APIClient()
        self.client_.force_authenticate(user=self.employee)
        self.today = timezone.now().date()
        self.monday = _next_monday(self.today)

    def _preview(self, **overrides):
        payload = {
            "leave_type": self.leave_type.id,
            "start_date": self.monday.isoformat(),
            "end_date": self.monday.isoformat(),
        }
        payload.update(overrides)
        return self.client_.post("/api/leave-requests/preview/", payload, format="json")

    # --- happy paths ---

    def test_single_day_preview_returns_day_count_and_balance(self):
        self.leave_type = make_leave_type(default_days_per_year=10)
        get_or_create_balance(self.employee, self.leave_type, self.monday.year)
        response = self._preview()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["days"], 1)
        self.assertTrue(response.data["is_capped"])
        self.assertEqual(response.data["remaining_balance"], 10)
        self.assertEqual(response.data["balance_after"], 9)
        self.assertFalse(response.data["insufficient_balance"])

    def test_multi_day_preview_spanning_weekend_excludes_weekend_days(self):
        self.leave_type = make_leave_type(default_days_per_year=20)
        get_or_create_balance(self.employee, self.leave_type, self.monday.year)
        end = self.monday + datetime.timedelta(days=6)  # Mon through following Sun
        response = self._preview(end_date=end.isoformat())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["days"], 5)

    def test_mandatory_holiday_excluded_from_preview_day_count(self):
        self.leave_type = make_leave_type(default_days_per_year=20)
        Holiday.objects.create(name="Company Holiday", date=self.monday, optional=False)
        end = self.monday + datetime.timedelta(days=1)
        response = self._preview(end_date=end.isoformat())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["days"], 1)

    def test_uncapped_leave_type_has_no_balance_figures(self):
        self.leave_type = make_leave_type(default_days_per_year=0)
        response = self._preview()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["is_capped"])
        self.assertIsNone(response.data["remaining_balance"])
        self.assertIsNone(response.data["balance_after"])
        self.assertFalse(response.data["insufficient_balance"])

    def test_insufficient_balance_flag_set_without_rejecting_the_request(self):
        self.leave_type = make_leave_type(default_days_per_year=1)
        get_or_create_balance(self.employee, self.leave_type, self.monday.year)
        end = self.monday + datetime.timedelta(days=4)  # Mon-Fri = 5 working days, only 1 allocated
        response = self._preview(end_date=end.isoformat())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["days"], 5)
        self.assertEqual(response.data["remaining_balance"], 1)
        self.assertEqual(response.data["balance_after"], -4)
        self.assertTrue(response.data["insufficient_balance"])

    def test_preview_does_not_create_a_balance_row_when_none_exists(self):
        self.leave_type = make_leave_type(default_days_per_year=10)
        from leave_balances.models import LeaveBalance

        self.assertFalse(LeaveBalance.objects.filter(employee=self.employee, leave_type=self.leave_type).exists())
        response = self._preview()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["remaining_balance"], 10)
        self.assertFalse(
            LeaveBalance.objects.filter(employee=self.employee, leave_type=self.leave_type).exists(),
            "preview must never create a LeaveBalance row",
        )

    def test_preview_does_not_create_a_leave_request(self):
        self.leave_type = make_leave_type(default_days_per_year=10)
        from leave_requests.models import LeaveRequest

        response = self._preview()
        self.assertEqual(response.status_code, 200)
        self.assertFalse(LeaveRequest.objects.filter(employee=self.employee).exists())

    def test_preview_ignores_missing_manager_unlike_apply(self):
        # Deliberately different from apply_leave_request: the day-count/balance preview doesn't
        # depend on whether the request could later be routed for approval.
        lone_employee = make_employee(self.dept, manager=None, email="lone-preview@example.com")
        client = APIClient()
        client.force_authenticate(user=lone_employee)
        self.leave_type = make_leave_type(requires_approval=True, default_days_per_year=10)
        response = client.post(
            "/api/leave-requests/preview/",
            {"leave_type": self.leave_type.id, "start_date": self.monday.isoformat(), "end_date": self.monday.isoformat()},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["days"], 1)

    # --- validation failures, consistent with apply ---

    def test_end_before_start_rejected(self):
        self.leave_type = make_leave_type()
        response = self._preview(end_date=(self.monday - datetime.timedelta(days=1)).isoformat())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "INVALID_RANGE")

    def test_backdated_start_rejected(self):
        self.leave_type = make_leave_type()
        past = self.today - datetime.timedelta(days=1)
        response = self._preview(start_date=past.isoformat(), end_date=past.isoformat())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "PAST_DATE")

    def test_inactive_leave_type_rejected(self):
        self.leave_type = make_leave_type(is_active=False)
        response = self._preview()
        # is_active=False leave types are excluded from the serializer's queryset entirely,
        # matching LeaveRequestCreateSerializer exactly.
        self.assertEqual(response.status_code, 400)

    def test_weekend_only_range_rejected_with_no_working_days(self):
        self.leave_type = make_leave_type()
        saturday = self.monday + datetime.timedelta(days=5)
        sunday = self.monday + datetime.timedelta(days=6)
        response = self._preview(start_date=saturday.isoformat(), end_date=sunday.isoformat())
        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "NO_WORKING_DAYS")

    def test_anonymous_cannot_preview(self):
        self.leave_type = make_leave_type()
        response = APIClient().post(
            "/api/leave-requests/preview/",
            {"leave_type": self.leave_type.id, "start_date": self.monday.isoformat(), "end_date": self.monday.isoformat()},
            format="json",
        )
        self.assertIn(response.status_code, (401, 403))


class PreviewMatchesApplyTest(TestCase):
    """Cross-checks that preview and the real submission agree — the acceptance criterion that
    the final submission must never produce a different day count or balance outcome than what
    was previewed."""

    def setUp(self):
        self.dept = make_department()
        self.manager = make_manager(self.dept)
        self.employee = make_employee(self.dept, manager=self.manager)
        self.client_ = APIClient()
        self.client_.force_authenticate(user=self.employee)
        self.today = timezone.now().date()
        self.monday = _next_monday(self.today)

    def test_preview_day_count_matches_the_days_actually_charged_on_submission(self):
        leave_type = make_leave_type(default_days_per_year=20)
        get_or_create_balance(self.employee, leave_type, self.monday.year)
        end = self.monday + datetime.timedelta(days=6)  # spans a weekend
        Holiday.objects.create(name="Mid-week Holiday", date=self.monday + datetime.timedelta(days=2))

        preview = self.client_.post(
            "/api/leave-requests/preview/",
            {"leave_type": leave_type.id, "start_date": self.monday.isoformat(), "end_date": end.isoformat()},
            format="json",
        )
        self.assertEqual(preview.status_code, 200)

        submission = self.client_.post(
            "/api/leave-requests/",
            {
                "leave_type": leave_type.id,
                "start_date": self.monday.isoformat(),
                "end_date": end.isoformat(),
                "reason": "cross-check",
            },
            format="json",
        )
        self.assertEqual(submission.status_code, 201)
        self.assertEqual(preview.data["days"], submission.data["days"])

    def test_preview_balance_after_matches_remaining_balance_post_submission_for_auto_approved_type(self):
        leave_type = make_leave_type(requires_approval=False, default_days_per_year=20)
        get_or_create_balance(self.employee, leave_type, self.monday.year)

        preview = self.client_.post(
            "/api/leave-requests/preview/",
            {"leave_type": leave_type.id, "start_date": self.monday.isoformat(), "end_date": self.monday.isoformat()},
            format="json",
        )
        self.assertEqual(preview.status_code, 200)

        submission = self.client_.post(
            "/api/leave-requests/",
            {
                "leave_type": leave_type.id,
                "start_date": self.monday.isoformat(),
                "end_date": self.monday.isoformat(),
                "reason": "cross-check",
            },
            format="json",
        )
        self.assertEqual(submission.status_code, 201)

        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        actual_remaining_after = balance.allocated - balance.used
        self.assertEqual(preview.data["balance_after"], actual_remaining_after)

    def test_preview_insufficient_flag_matches_apply_rejection(self):
        leave_type = make_leave_type(requires_approval=False, default_days_per_year=1)
        get_or_create_balance(self.employee, leave_type, self.monday.year)
        end = self.monday + datetime.timedelta(days=4)  # 5 working days, only 1 allocated

        preview = self.client_.post(
            "/api/leave-requests/preview/",
            {"leave_type": leave_type.id, "start_date": self.monday.isoformat(), "end_date": end.isoformat()},
            format="json",
        )
        self.assertEqual(preview.status_code, 200)
        self.assertTrue(preview.data["insufficient_balance"])

        submission = self.client_.post(
            "/api/leave-requests/",
            {
                "leave_type": leave_type.id,
                "start_date": self.monday.isoformat(),
                "end_date": end.isoformat(),
                "reason": "cross-check",
            },
            format="json",
        )
        self.assertEqual(submission.status_code, 400)
        self.assertEqual(submission.data["code"], "INSUFFICIENT_BALANCE")
