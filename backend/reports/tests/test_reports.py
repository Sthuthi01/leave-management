import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Employee, Role
from leave_requests.services import apply_leave_request
from leave_requests.tests.helpers import make_department, make_employee, make_leave_type


class ReportsTest(TestCase):
    def setUp(self):
        self.dept_a = make_department(name="Department A")
        self.dept_b = make_department(name="Department B")
        self.employee_a = make_employee(self.dept_a, email="employee-a@example.com")
        self.employee_b = make_employee(self.dept_b, email="employee-b@example.com")
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept_a,
        )
        self.leave_type = make_leave_type(requires_approval=False)
        self.other_leave_type = make_leave_type(name="Casual Leave", code="CL", requires_approval=False)
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)

    def test_requires_authentication(self):
        response = self.client.get("/api/reports/")
        self.assertEqual(response.status_code, 403)

    def test_non_admin_forbidden(self):
        client = APIClient()
        client.force_authenticate(user=self.employee_a)
        response = client.get("/api/reports/")
        self.assertEqual(response.status_code, 403)

    def test_from_after_to_rejected(self):
        response = self.admin_client.get("/api/reports/?from=2027-02-10&to=2027-02-01")
        self.assertEqual(response.status_code, 400)

    def test_period_comparison_window_is_equal_length_and_immediately_prior(self):
        # current period: 2027-02-01..2027-02-10 (10 days). Expected previous period:
        # 2027-01-22..2027-01-31 (10 days, ending the day before `from`).
        current = apply_leave_request(
            employee=self.employee_a, leave_type=self.leave_type,
            start_date=datetime.date(2027, 2, 5), end_date=datetime.date(2027, 2, 5), reason="",
        )
        previous = apply_leave_request(
            employee=self.employee_a, leave_type=self.leave_type,
            start_date=datetime.date(2027, 1, 25), end_date=datetime.date(2027, 1, 25), reason="",
        )
        # Just outside the previous window (2027-01-21) — must appear in neither list.
        apply_leave_request(
            employee=self.employee_a, leave_type=self.leave_type,
            start_date=datetime.date(2027, 1, 21), end_date=datetime.date(2027, 1, 21), reason="",
        )

        response = self.admin_client.get("/api/reports/?from=2027-02-01&to=2027-02-10")
        self.assertEqual(response.status_code, 200)
        current_ids = {r["id"] for r in response.data["requests"]}
        previous_ids = {r["id"] for r in response.data["previous_requests"]}
        self.assertEqual(current_ids, {current.id})
        self.assertEqual(previous_ids, {previous.id})

    def test_overlap_counts_a_request_spanning_into_the_window(self):
        spanning = apply_leave_request(
            employee=self.employee_a, leave_type=self.leave_type,
            start_date=datetime.date(2027, 1, 30), end_date=datetime.date(2027, 2, 3), reason="",
        )
        response = self.admin_client.get("/api/reports/?from=2027-02-01&to=2027-02-10")
        current_ids = {r["id"] for r in response.data["requests"]}
        self.assertIn(spanning.id, current_ids)

    def test_department_filter(self):
        req_a = apply_leave_request(
            employee=self.employee_a, leave_type=self.leave_type,
            start_date=datetime.date(2027, 2, 5), end_date=datetime.date(2027, 2, 5), reason="",
        )
        apply_leave_request(
            employee=self.employee_b, leave_type=self.leave_type,
            start_date=datetime.date(2027, 2, 8), end_date=datetime.date(2027, 2, 8), reason="",
        )
        response = self.admin_client.get(
            f"/api/reports/?from=2027-02-01&to=2027-02-10&department_id={self.dept_a.id}"
        )
        current_ids = {r["id"] for r in response.data["requests"]}
        self.assertEqual(current_ids, {req_a.id})

    def test_leave_type_filter(self):
        req_leave = apply_leave_request(
            employee=self.employee_a, leave_type=self.leave_type,
            start_date=datetime.date(2027, 2, 5), end_date=datetime.date(2027, 2, 5), reason="",
        )
        apply_leave_request(
            employee=self.employee_a, leave_type=self.other_leave_type,
            start_date=datetime.date(2027, 2, 8), end_date=datetime.date(2027, 2, 8), reason="",
        )
        response = self.admin_client.get(
            f"/api/reports/?from=2027-02-01&to=2027-02-10&leave_type_id={self.leave_type.id}"
        )
        current_ids = {r["id"] for r in response.data["requests"]}
        self.assertEqual(current_ids, {req_leave.id})

    def test_default_from_and_to(self):
        today = datetime.date.today()
        response = self.admin_client.get("/api/reports/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["filters"]["from"], datetime.date(today.year, 1, 1).isoformat())
        self.assertEqual(response.data["filters"]["to"], today.isoformat())

    def test_all_statuses_included_no_server_side_status_filter(self):
        apply_leave_request(
            employee=self.employee_a, leave_type=self.leave_type,
            start_date=datetime.date(2027, 2, 5), end_date=datetime.date(2027, 2, 5), reason="",
        )
        response = self.admin_client.get("/api/reports/?from=2027-02-01&to=2027-02-10")
        self.assertEqual(len(response.data["requests"]), 1)
        self.assertEqual(response.data["requests"][0]["status"], "APPROVED")

    def test_active_only_leave_types_returned(self):
        make_leave_type(name="Retired Leave", code="RL", is_active=False)
        response = self.admin_client.get("/api/reports/?from=2027-02-01&to=2027-02-10")
        codes = {lt["code"] for lt in response.data["leave_types"]}
        self.assertNotIn("RL", codes)

    def test_department_and_employee_hydrated_on_requests(self):
        apply_leave_request(
            employee=self.employee_a, leave_type=self.leave_type,
            start_date=datetime.date(2027, 2, 5), end_date=datetime.date(2027, 2, 5), reason="",
        )
        response = self.admin_client.get("/api/reports/?from=2027-02-01&to=2027-02-10")
        request_data = response.data["requests"][0]
        self.assertEqual(request_data["employee"]["department"]["name"], "Department A")
