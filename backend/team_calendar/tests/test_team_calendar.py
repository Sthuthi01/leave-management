import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from holidays.models import Holiday
from leave_requests.services import apply_leave_request, decide_leave_request
from leave_requests.tests.helpers import make_department, make_employee, make_leave_type, make_manager


class TeamCalendarTest(TestCase):
    def setUp(self):
        self.dept_a = make_department(name="Department A")
        self.dept_b = make_department(name="Department B")
        self.manager_a = make_manager(self.dept_a, email="manager-a@example.com")
        self.employee_a = make_employee(self.dept_a, manager=self.manager_a, email="employee-a@example.com")
        self.employee_b = make_employee(self.dept_b, email="employee-b@example.com")
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept_a,
        )
        self.leave_type = make_leave_type(requires_approval=True)
        self.auto_leave_type = make_leave_type(name="Casual Leave", code="CL", requires_approval=False)

    def _approved_request(self, employee, start, end, leave_type=None, approver=None):
        leave_request = apply_leave_request(
            employee=employee, leave_type=leave_type or self.leave_type, start_date=start, end_date=end, reason=""
        )
        if leave_request.status == "PENDING":
            decide_leave_request(
                approver=approver or self.manager_a, leave_request_id=leave_request.id,
                decision="APPROVED", comment=None,
            )
        return leave_request

    def test_requires_authentication(self):
        response = self.client.get("/api/team-calendar/?month=2027-03")
        self.assertEqual(response.status_code, 403)

    def test_team_scope_only_shows_same_department(self):
        self._approved_request(self.employee_a, datetime.date(2027, 3, 10), datetime.date(2027, 3, 10))
        self._approved_request(
            self.employee_b, datetime.date(2027, 3, 11), datetime.date(2027, 3, 11), leave_type=self.auto_leave_type
        )

        client = APIClient()
        client.force_authenticate(user=self.employee_a)
        response = client.get("/api/team-calendar/?month=2027-03")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["scope"], "team")
        self.assertEqual(response.data["department_name"], "Department A")
        employee_ids = {e["employee"]["id"] for e in response.data["entries"]}
        self.assertEqual(employee_ids, {self.employee_a.id})

    def test_company_scope_downgraded_to_team_for_non_admin(self):
        self._approved_request(self.employee_a, datetime.date(2027, 3, 10), datetime.date(2027, 3, 10))
        self._approved_request(
            self.employee_b, datetime.date(2027, 3, 11), datetime.date(2027, 3, 11), leave_type=self.auto_leave_type
        )

        client = APIClient()
        client.force_authenticate(user=self.employee_a)
        response = client.get("/api/team-calendar/?month=2027-03&scope=company")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["scope"], "team")
        self.assertEqual(response.data["department_name"], "Department A")
        employee_ids = {e["employee"]["id"] for e in response.data["entries"]}
        self.assertNotIn(self.employee_b.id, employee_ids)

    def test_company_scope_allowed_for_admin(self):
        self._approved_request(self.employee_a, datetime.date(2027, 3, 10), datetime.date(2027, 3, 10))
        self._approved_request(
            self.employee_b, datetime.date(2027, 3, 11), datetime.date(2027, 3, 11), leave_type=self.auto_leave_type
        )

        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.get("/api/team-calendar/?month=2027-03&scope=company")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["scope"], "company")
        self.assertIsNone(response.data["department_name"])
        employee_ids = {e["employee"]["id"] for e in response.data["entries"]}
        self.assertEqual(employee_ids, {self.employee_a.id, self.employee_b.id})

    def test_only_approved_entries_shown(self):
        pending = apply_leave_request(
            employee=self.employee_a, leave_type=self.leave_type,
            start_date=datetime.date(2027, 3, 15), end_date=datetime.date(2027, 3, 15), reason="",
        )
        self.assertEqual(pending.status, "PENDING")
        rejected_source = apply_leave_request(
            employee=self.employee_a, leave_type=self.leave_type,
            start_date=datetime.date(2027, 3, 16), end_date=datetime.date(2027, 3, 16), reason="",
        )
        decide_leave_request(
            approver=self.manager_a, leave_request_id=rejected_source.id, decision="REJECTED", comment="No"
        )

        client = APIClient()
        client.force_authenticate(user=self.employee_a)
        response = client.get("/api/team-calendar/?month=2027-03")
        self.assertEqual(response.data["entries"], [])

    def test_entries_outside_month_excluded(self):
        self._approved_request(self.employee_a, datetime.date(2027, 4, 5), datetime.date(2027, 4, 5))

        client = APIClient()
        client.force_authenticate(user=self.employee_a)
        response = client.get("/api/team-calendar/?month=2027-03")
        self.assertEqual(response.data["entries"], [])

    def test_multi_day_entry_overlapping_month_boundary_included(self):
        self._approved_request(self.employee_a, datetime.date(2027, 3, 30), datetime.date(2027, 4, 2))

        client = APIClient()
        client.force_authenticate(user=self.employee_a)
        response = client.get("/api/team-calendar/?month=2027-03")
        self.assertEqual(len(response.data["entries"]), 1)

    def test_holidays_for_month_included(self):
        Holiday.objects.create(name="In Month", date=datetime.date(2027, 3, 20))
        Holiday.objects.create(name="Out Of Month", date=datetime.date(2027, 4, 1))

        client = APIClient()
        client.force_authenticate(user=self.employee_a)
        response = client.get("/api/team-calendar/?month=2027-03")
        names = [h["name"] for h in response.data["holidays"]]
        self.assertEqual(names, ["In Month"])

    def test_missing_month_defaults_to_current_month(self):
        client = APIClient()
        client.force_authenticate(user=self.employee_a)
        response = client.get("/api/team-calendar/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["month"], datetime.date.today().strftime("%Y-%m"))
