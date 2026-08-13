import datetime

from django.test import TestCase

from accounts.models import Employee, Role
from departments.models import Department
from leave_types.models import AccrualMethod, LeaveType

from ..models import LeaveBalance
from ..services import (
    accrued_to_date,
    entitlement_start,
    get_or_create_balance,
    remaining,
)


class EntitlementAndProrationTest(TestCase):
    """Phase 2C: entitlement, join-year proration, carry-forward, lazy creation, negative-balance
    guard. Formulas ported from the source app's entitlementStart/getOrCreateBalance."""

    def setUp(self):
        self.dept = Department.objects.create(name="Engineering")
        self.leave_type = LeaveType.objects.create(
            name="Annual Leave", code="AL", default_days_per_year=12, carry_forward_limit=5,
            accrual_method=AccrualMethod.ANNUAL,
        )

    def _employee(self, joined_at):
        return Employee.objects.create_user(
            email=f"emp-{joined_at}@example.com", name="Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.dept, joined_at=joined_at,
        )

    def test_entitlement_start_is_jan_1_for_non_join_year(self):
        employee = self._employee(datetime.date(2020, 6, 15))
        self.assertEqual(entitlement_start(employee, 2026), datetime.date(2026, 1, 1))

    def test_entitlement_start_is_join_date_in_join_year(self):
        employee = self._employee(datetime.date(2026, 4, 1))
        self.assertEqual(entitlement_start(employee, 2026), datetime.date(2026, 4, 1))

    def test_full_year_allocation_for_established_employee(self):
        employee = self._employee(datetime.date(2020, 1, 1))
        balance = get_or_create_balance(employee, self.leave_type, 2026)
        self.assertEqual(balance.allocated, 12)
        self.assertEqual(balance.used, 0)
        self.assertEqual(balance.carried_forward, 0)

    def test_prorated_allocation_in_join_year(self):
        # Joined April 2026: months_available = 13 - 4 = 9; round(12 * 9 / 12) = 9.
        employee = self._employee(datetime.date(2026, 4, 1))
        balance = get_or_create_balance(employee, self.leave_type, 2026)
        self.assertEqual(balance.allocated, 9)

    def test_lazy_creation_is_idempotent(self):
        employee = self._employee(datetime.date(2020, 1, 1))
        first = get_or_create_balance(employee, self.leave_type, 2026)
        first.used = 3
        first.save(update_fields=["used"])
        second = get_or_create_balance(employee, self.leave_type, 2026)
        self.assertEqual(second.pk, first.pk)
        self.assertEqual(second.used, 3)  # not recomputed/reset on second call
        self.assertEqual(LeaveBalance.objects.filter(employee=employee, leave_type=self.leave_type, year=2026).count(), 1)

    def test_no_balance_row_created_on_employee_or_leave_type_creation(self):
        employee = self._employee(datetime.date(2020, 1, 1))
        self.assertEqual(LeaveBalance.objects.filter(employee=employee).count(), 0)

    def test_carry_forward_computed_from_direct_db_lookup_of_prior_year(self):
        employee = self._employee(datetime.date(2020, 1, 1))
        prior = get_or_create_balance(employee, self.leave_type, 2025)
        prior.used = 8  # allocated=12, so 4 unused
        prior.save(update_fields=["used"])
        current = get_or_create_balance(employee, self.leave_type, 2026)
        self.assertEqual(current.carried_forward, 4)
        self.assertEqual(current.allocated, 12 + 4)

    def test_carry_forward_clamped_to_leave_type_limit(self):
        # carry_forward_limit=5, but 10 days would otherwise be unused.
        employee = self._employee(datetime.date(2020, 1, 1))
        prior = get_or_create_balance(employee, self.leave_type, 2025)
        prior.used = 2  # allocated=12, so 10 unused, but limit is 5
        prior.save(update_fields=["used"])
        current = get_or_create_balance(employee, self.leave_type, 2026)
        self.assertEqual(current.carried_forward, 5)

    def test_carry_forward_defaults_to_zero_when_prior_year_row_does_not_exist(self):
        employee = self._employee(datetime.date(2020, 1, 1))
        current = get_or_create_balance(employee, self.leave_type, 2026)
        self.assertEqual(current.carried_forward, 0)
        self.assertEqual(current.allocated, 12)

    def test_negative_balance_rejected_at_db_level(self):
        employee = self._employee(datetime.date(2020, 1, 1))
        balance = get_or_create_balance(employee, self.leave_type, 2026)
        balance.used = -1
        with self.assertRaises(Exception):
            balance.save(update_fields=["used"])


class AccruedToDateAnnualTest(TestCase):
    """ANNUAL accrual: the full allocated amount is available from day one, regardless of date."""

    def setUp(self):
        self.dept = Department.objects.create(name="Engineering")
        self.leave_type = LeaveType.objects.create(
            name="Annual Leave", code="AL", default_days_per_year=12, accrual_method=AccrualMethod.ANNUAL,
        )
        self.employee = Employee.objects.create_user(
            email="annual@example.com", name="Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.dept, joined_at=datetime.date(2020, 1, 1),
        )

    def test_full_amount_accrued_immediately(self):
        balance = get_or_create_balance(self.employee, self.leave_type, 2026)
        self.assertEqual(accrued_to_date(self.employee, self.leave_type, balance, as_of=datetime.date(2026, 1, 1)), 12)
        self.assertEqual(accrued_to_date(self.employee, self.leave_type, balance, as_of=datetime.date(2026, 12, 31)), 12)


class AccruedToDateMonthlyTest(TestCase):
    """MONTHLY accrual — exact formulas and worked examples from the Phase 2C design doc,
    ported from the source app's accruedToDate. The current in-progress month counts as fully
    elapsed (calendar-month granularity, not day-of-month)."""

    def setUp(self):
        self.dept = Department.objects.create(name="Engineering")
        self.leave_type = LeaveType.objects.create(
            name="Monthly Leave", code="ML", default_days_per_year=12, accrual_method=AccrualMethod.MONTHLY,
        )

    def _employee(self, joined_at):
        return Employee.objects.create_user(
            email=f"monthly-{joined_at}@example.com", name="Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=self.dept, joined_at=joined_at,
        )

    def test_established_employee_today_2026_08_11(self):
        # entitlement_start=Jan 1 2026, months_available=12; as_of=Aug 11 -> months_elapsed=8.
        employee = self._employee(datetime.date(2020, 1, 1))
        balance = get_or_create_balance(employee, self.leave_type, 2026)
        self.assertEqual(balance.allocated, 12)
        accrued = accrued_to_date(employee, self.leave_type, balance, as_of=datetime.date(2026, 8, 11))
        self.assertEqual(accrued, 8)

    def test_join_year_partial_months_worked_example(self):
        # Joined 2026-04-01, as_of=2026-07-15: months_available=9, months_elapsed=4,
        # accrued=round(9*4/9)=4. Matches the Phase 2C design doc worked example exactly.
        employee = self._employee(datetime.date(2026, 4, 1))
        balance = get_or_create_balance(employee, self.leave_type, 2026)
        self.assertEqual(balance.allocated, 9)
        accrued = accrued_to_date(employee, self.leave_type, balance, as_of=datetime.date(2026, 7, 15))
        self.assertEqual(accrued, 4)

    def test_join_year_reaches_full_allocation_at_employees_own_year_end(self):
        employee = self._employee(datetime.date(2026, 4, 1))
        balance = get_or_create_balance(employee, self.leave_type, 2026)
        accrued = accrued_to_date(employee, self.leave_type, balance, as_of=datetime.date(2026, 12, 31))
        self.assertEqual(accrued, 9)  # full prorated allocation, not the un-prorated 12

    def test_first_day_of_month_counts_as_fully_elapsed(self):
        # Day-of-month granularity doesn't matter — Aug 1 accrues the same as Aug 31.
        employee = self._employee(datetime.date(2020, 1, 1))
        balance = get_or_create_balance(employee, self.leave_type, 2026)
        accrued_start = accrued_to_date(employee, self.leave_type, balance, as_of=datetime.date(2026, 8, 1))
        accrued_end = accrued_to_date(employee, self.leave_type, balance, as_of=datetime.date(2026, 8, 31))
        self.assertEqual(accrued_start, accrued_end)
        self.assertEqual(accrued_start, 8)

    def test_past_balance_year_returns_full_allocated(self):
        employee = self._employee(datetime.date(2020, 1, 1))
        balance = get_or_create_balance(employee, self.leave_type, 2025)
        accrued = accrued_to_date(employee, self.leave_type, balance, as_of=datetime.date(2026, 1, 1))
        self.assertEqual(accrued, balance.allocated)

    def test_future_balance_year_returns_only_carried_forward(self):
        employee = self._employee(datetime.date(2020, 1, 1))
        prior = get_or_create_balance(employee, self.leave_type, 2025)
        prior.used = 5  # allocated=12, 7 unused, no carry_forward_limit set (default 0)
        prior.save(update_fields=["used"])
        future_balance = LeaveBalance.objects.create(
            employee=employee, leave_type=self.leave_type, year=2027, allocated=12, used=0, carried_forward=3,
        )
        accrued = accrued_to_date(employee, self.leave_type, future_balance, as_of=datetime.date(2026, 6, 1))
        self.assertEqual(accrued, 3)

    def test_remaining_subtracts_used_from_accrued(self):
        employee = self._employee(datetime.date(2020, 1, 1))
        balance = get_or_create_balance(employee, self.leave_type, 2026)
        balance.used = 3
        balance.save(update_fields=["used"])
        self.assertEqual(remaining(employee, self.leave_type, balance, as_of=datetime.date(2026, 8, 11)), 5)  # accrued 8 - used 3
