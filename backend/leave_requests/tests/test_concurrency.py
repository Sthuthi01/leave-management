"""Real-database concurrency tests. Uses TransactionTestCase (not TestCase) because these tests
need genuinely separate DB connections/transactions that actually COMMIT — Django's regular
TestCase wraps each test in an uncommitted outer transaction, which would make the
pg_advisory_xact_lock and select_for_update() interactions between threads meaningless (nothing
would be visible across connections). This is the Django/Postgres equivalent of the source app's
own live-database concurrency test ("5 identical concurrent submissions produced exactly 1
success and 4 correctly-rejected duplicates").
"""
import datetime
import threading

from django.db import connection
from django.test import TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from leave_balances.services import get_or_create_balance

from ..models import LeaveRequest, LeaveStatus
from .helpers import make_department, make_employee, make_leave_type, make_manager


def _next_monday(after: datetime.date) -> datetime.date:
    days_ahead = (7 - after.weekday()) % 7 or 7
    return after + datetime.timedelta(days=days_ahead)


def _run_concurrently(targets):
    threads = [threading.Thread(target=fn, args=args) for fn, args in targets]
    for t in threads:
        t.start()
    for t in threads:
        t.join()


class ConcurrentApplyTest(TransactionTestCase):
    def setUp(self):
        self.dept = make_department()
        self.manager = make_manager(self.dept)
        self.monday = _next_monday(timezone.now().date())

    def _apply(self, employee, leave_type, results, index):
        try:
            client = APIClient()
            client.force_authenticate(user=employee)
            response = client.post(
                "/api/leave-requests/",
                {"leave_type": leave_type.id, "start_date": self.monday.isoformat(), "end_date": self.monday.isoformat()},
                format="json",
            )
            results[index] = response.status_code
        finally:
            connection.close()

    def test_concurrent_identical_submissions_for_same_employee_only_one_succeeds(self):
        employee = make_employee(self.dept, manager=self.manager)
        leave_type = make_leave_type(requires_approval=True)

        results = [None] * 5
        _run_concurrently([(self._apply, (employee, leave_type, results, i)) for i in range(5)])

        self.assertEqual(results.count(201), 1, f"expected exactly 1 success, got {results}")
        self.assertEqual(results.count(400), 4)
        self.assertEqual(LeaveRequest.objects.filter(employee=employee).count(), 1)

    def test_concurrent_submissions_for_different_employees_both_succeed_independently(self):
        # Proves the advisory lock is scoped per-employee, not global.
        employee_a = make_employee(self.dept, manager=self.manager, email="a@example.com")
        employee_b = make_employee(self.dept, manager=self.manager, email="b@example.com")
        leave_type = make_leave_type(requires_approval=True)

        results = [None, None]
        _run_concurrently(
            [
                (self._apply, (employee_a, leave_type, results, 0)),
                (self._apply, (employee_b, leave_type, results, 1)),
            ]
        )

        self.assertEqual(results, [201, 201])
        self.assertEqual(LeaveRequest.objects.count(), 2)

    def test_insufficient_balance_rollback_leaves_no_partial_state(self):
        # Confirms a failed apply rolls back completely: no LeaveRequest row, no balance change.
        leave_type = make_leave_type(requires_approval=False, default_days_per_year=1)
        employee = make_employee(self.dept, manager=self.manager)
        balance = get_or_create_balance(employee, leave_type, self.monday.year)
        start = self.monday
        end = start + datetime.timedelta(days=4)  # 5 working days requested, only 1 allocated

        client = APIClient()
        client.force_authenticate(user=employee)
        response = client.post(
            "/api/leave-requests/",
            {"leave_type": leave_type.id, "start_date": start.isoformat(), "end_date": end.isoformat()},
            format="json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data["code"], "INSUFFICIENT_BALANCE")
        self.assertEqual(LeaveRequest.objects.filter(employee=employee).count(), 0)
        balance.refresh_from_db()
        self.assertEqual(balance.used, 0)


class ConcurrentCancelTest(TransactionTestCase):
    def setUp(self):
        self.dept = make_department()
        self.manager = make_manager(self.dept)
        self.employee = make_employee(self.dept, manager=self.manager)
        self.monday = _next_monday(timezone.now().date())

    def _cancel(self, employee, request_id, results, index):
        try:
            client = APIClient()
            client.force_authenticate(user=employee)
            response = client.post(f"/api/leave-requests/{request_id}/cancel/")
            results[index] = response.status_code
        finally:
            connection.close()

    def test_concurrent_cancels_on_same_request_only_one_succeeds(self):
        leave_type = make_leave_type(requires_approval=True)
        request = LeaveRequest.objects.create(
            reference_number="LR-CONC-0001", employee=self.employee, leave_type=leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=LeaveStatus.PENDING,
        )

        results = [None, None]
        _run_concurrently([(self._cancel, (self.employee, request.id, results, i)) for i in range(2)])

        self.assertEqual(results.count(200), 1, f"expected exactly 1 success, got {results}")
        self.assertEqual(results.count(400), 1)
        request.refresh_from_db()
        self.assertEqual(request.status, LeaveStatus.CANCELLED)

    def test_concurrent_cancels_of_different_requests_both_refund_the_shared_balance_correctly(self):
        # select_for_update() on the balance row must prevent a lost update when two cancels
        # for the SAME employee+leave_type+year are refunding concurrently.
        leave_type = make_leave_type(requires_approval=False, default_days_per_year=10)
        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        balance.used = 4
        balance.save(update_fields=["used"])
        tuesday = self.monday + datetime.timedelta(days=1)
        request_a = LeaveRequest.objects.create(
            reference_number="LR-CONC-A", employee=self.employee, leave_type=leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=LeaveStatus.APPROVED,
        )
        request_b = LeaveRequest.objects.create(
            reference_number="LR-CONC-B", employee=self.employee, leave_type=leave_type,
            start_date=tuesday, end_date=tuesday, days=1, status=LeaveStatus.APPROVED,
        )

        results = [None, None]
        _run_concurrently(
            [
                (self._cancel, (self.employee, request_a.id, results, 0)),
                (self._cancel, (self.employee, request_b.id, results, 1)),
            ]
        )

        self.assertEqual(results, [200, 200])
        balance.refresh_from_db()
        self.assertEqual(balance.used, 2)  # 4 - 1 - 1, no lost update under concurrent select_for_update()


class ConcurrentDecideTest(TransactionTestCase):
    """Phase 2D: the core, real-Postgres regression test for the mandatory acceptance criterion
    — an approval must never overdraw the balance, even when two individually-valid-at-apply-time
    PENDING requests race to be approved concurrently."""

    def setUp(self):
        self.dept = make_department()
        self.manager = make_manager(self.dept)
        self.employee = make_employee(self.dept, manager=self.manager)
        self.monday = _next_monday(timezone.now().date())

    def _decide(self, approver, request_id, decision, results, index, comment=None):
        try:
            client = APIClient()
            client.force_authenticate(user=approver)
            payload = {"decision": decision}
            if comment is not None:
                payload["comment"] = comment
            response = client.post(f"/api/leave-requests/{request_id}/decide/", payload, format="json")
            results[index] = response.status_code
        finally:
            connection.close()

    def test_concurrent_approvals_never_overdraw_the_shared_balance(self):
        # Two separate PENDING requests, same employee+leave_type+year, each individually within
        # budget at apply-time (PENDING never reserves), but their sum exceeds the balance.
        # Approving both concurrently must never let `used` exceed `allocated`/accrued.
        leave_type = make_leave_type(requires_approval=True, default_days_per_year=5)
        get_or_create_balance(self.employee, leave_type, self.monday.year)  # allocated=5
        tuesday = self.monday + datetime.timedelta(days=1)
        request_a = LeaveRequest.objects.create(
            reference_number="LR-CONC-DEC-A", employee=self.employee, leave_type=leave_type,
            start_date=self.monday, end_date=self.monday, days=3, status=LeaveStatus.PENDING, approver=self.manager,
        )
        request_b = LeaveRequest.objects.create(
            reference_number="LR-CONC-DEC-B", employee=self.employee, leave_type=leave_type,
            start_date=tuesday, end_date=tuesday, days=3, status=LeaveStatus.PENDING, approver=self.manager,
        )

        results = [None, None]
        _run_concurrently(
            [
                (self._decide, (self.manager, request_a.id, "APPROVED", results, 0)),
                (self._decide, (self.manager, request_b.id, "APPROVED", results, 1)),
            ]
        )

        self.assertEqual(results.count(200), 1, f"expected exactly 1 approval to succeed, got {results}")
        self.assertEqual(results.count(409), 1, f"expected exactly 1 INSUFFICIENT_BALANCE, got {results}")

        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        self.assertLessEqual(balance.used, balance.allocated, "balance must never be overdrawn")
        self.assertEqual(balance.used, 3)  # exactly one request's worth of days, never both

        request_a.refresh_from_db()
        request_b.refresh_from_db()
        statuses = {request_a.status, request_b.status}
        self.assertEqual(statuses, {LeaveStatus.APPROVED, LeaveStatus.PENDING})

    def test_concurrent_approve_and_reject_on_same_request_only_one_wins(self):
        leave_type = make_leave_type(requires_approval=True, default_days_per_year=10)
        get_or_create_balance(self.employee, leave_type, self.monday.year)
        request = LeaveRequest.objects.create(
            reference_number="LR-CONC-DEC-C", employee=self.employee, leave_type=leave_type,
            start_date=self.monday, end_date=self.monday, days=1, status=LeaveStatus.PENDING, approver=self.manager,
        )

        results = [None, None]
        _run_concurrently(
            [
                (self._decide, (self.manager, request.id, "APPROVED", results, 0)),
                (self._decide, (self.manager, request.id, "REJECTED", results, 1, "No.")),
            ]
        )

        self.assertEqual(results.count(200), 1, f"expected exactly 1 winner, got {results}")
        self.assertEqual(results.count(400), 1)
        request.refresh_from_db()
        self.assertIn(request.status, (LeaveStatus.APPROVED, LeaveStatus.REJECTED))

    def test_concurrent_double_approve_on_same_request_only_one_succeeds(self):
        leave_type = make_leave_type(requires_approval=True, default_days_per_year=10)
        balance = get_or_create_balance(self.employee, leave_type, self.monday.year)
        request = LeaveRequest.objects.create(
            reference_number="LR-CONC-DEC-D", employee=self.employee, leave_type=leave_type,
            start_date=self.monday, end_date=self.monday, days=2, status=LeaveStatus.PENDING, approver=self.manager,
        )

        results = [None, None]
        _run_concurrently(
            [
                (self._decide, (self.manager, request.id, "APPROVED", results, 0)),
                (self._decide, (self.manager, request.id, "APPROVED", results, 1)),
            ]
        )

        self.assertEqual(results.count(200), 1, f"expected exactly 1 success, got {results}")
        self.assertEqual(results.count(400), 1)
        balance.refresh_from_db()
        self.assertEqual(balance.used, 2)  # incremented exactly once, not twice
