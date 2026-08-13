"""Rules 1-3: draft resources are never visible to employees, future-effective-date resources
are not visible until their date arrives, and ALL/DEPARTMENT/ROLE audience filtering matches the
source exactly. Also covers the list endpoint's RBAC: any authenticated user can GET, but the
admin branch is unfiltered while everyone else only sees what they're entitled to."""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import Role
from onboarding.models import AudienceScope, ResourceCategory, ResourceStatus
from onboarding.services import resource_effective_state, resource_visible_to_employee
from onboarding.tests.helpers import make_admin, make_department, make_employee, make_resource


class ResourceEffectiveStateTest(TestCase):
    def setUp(self):
        self.dept = make_department()

    def test_draft_is_draft_regardless_of_effective_date(self):
        resource = make_resource(status=ResourceStatus.DRAFT, effective_date=datetime.date(2020, 1, 1))
        self.assertEqual(resource_effective_state(resource), "DRAFT")

    def test_published_with_no_effective_date_is_live(self):
        resource = make_resource(status=ResourceStatus.PUBLISHED, effective_date=None)
        self.assertEqual(resource_effective_state(resource), "LIVE")

    def test_published_with_past_effective_date_is_live(self):
        resource = make_resource(status=ResourceStatus.PUBLISHED, effective_date=datetime.date(2020, 1, 1))
        self.assertEqual(resource_effective_state(resource, today=datetime.date(2026, 1, 1)), "LIVE")

    def test_published_with_future_effective_date_is_scheduled(self):
        resource = make_resource(status=ResourceStatus.PUBLISHED, effective_date=datetime.date(2099, 1, 1))
        self.assertEqual(resource_effective_state(resource, today=datetime.date(2026, 1, 1)), "SCHEDULED")

    def test_published_with_effective_date_exactly_today_is_live(self):
        today = datetime.date(2026, 6, 15)
        resource = make_resource(status=ResourceStatus.PUBLISHED, effective_date=today)
        self.assertEqual(resource_effective_state(resource, today=today), "LIVE")


class ResourceAudienceMatrixTest(TestCase):
    """Full ALL/DEPARTMENT/ROLE × matching/non-matching matrix, rule 3."""

    def setUp(self):
        self.dept_a = make_department("Engineering")
        self.dept_b = make_department("Sales")
        self.employee_a = make_employee(self.dept_a, email="a@example.com", role=Role.EMPLOYEE)
        self.manager_b = make_employee(self.dept_b, email="b@example.com", role=Role.MANAGER)

    def test_all_scope_visible_to_everyone(self):
        resource = make_resource(audience_scope=AudienceScope.ALL)
        self.assertTrue(resource_visible_to_employee(resource, self.employee_a))
        self.assertTrue(resource_visible_to_employee(resource, self.manager_b))

    def test_department_scope_visible_only_to_matching_department(self):
        resource = make_resource(audience_scope=AudienceScope.DEPARTMENT, audience_department=self.dept_a)
        self.assertTrue(resource_visible_to_employee(resource, self.employee_a))
        self.assertFalse(resource_visible_to_employee(resource, self.manager_b))

    def test_role_scope_visible_only_to_matching_role(self):
        resource = make_resource(audience_scope=AudienceScope.ROLE, audience_role=Role.MANAGER)
        self.assertFalse(resource_visible_to_employee(resource, self.employee_a))
        self.assertTrue(resource_visible_to_employee(resource, self.manager_b))

    def test_draft_department_matching_resource_still_not_visible(self):
        # Rule 1 wins even when rule 3's audience would otherwise match — draft always hides.
        resource = make_resource(
            status=ResourceStatus.DRAFT, audience_scope=AudienceScope.DEPARTMENT, audience_department=self.dept_a
        )
        self.assertFalse(resource_visible_to_employee(resource, self.employee_a))

    def test_future_dated_matching_resource_still_not_visible(self):
        resource = make_resource(
            status=ResourceStatus.PUBLISHED,
            effective_date=datetime.date(2099, 1, 1),
            audience_scope=AudienceScope.ALL,
        )
        self.assertFalse(resource_visible_to_employee(resource, self.employee_a))


class ResourceListEndpointRbacTest(TestCase):
    def setUp(self):
        self.dept_a = make_department("Engineering")
        self.dept_b = make_department("Sales")
        self.admin = make_admin(self.dept_a)
        self.employee = make_employee(self.dept_a, email="emp@example.com")

        self.visible_to_employee = make_resource(title="Visible", audience_scope=AudienceScope.ALL)
        self.draft = make_resource(title="Draft only", status=ResourceStatus.DRAFT)
        self.other_department = make_resource(
            title="Other dept", audience_scope=AudienceScope.DEPARTMENT, audience_department=self.dept_b
        )

        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    def test_unauthenticated_rejected(self):
        response = APIClient().get("/api/onboarding/resources/")
        self.assertIn(response.status_code, (401, 403))

    def test_admin_sees_everything_including_drafts(self):
        response = self.admin_client.get("/api/onboarding/resources/")
        self.assertEqual(response.status_code, 200)
        titles = {r["title"] for r in response.data}
        self.assertEqual(titles, {"Visible", "Draft only", "Other dept"})

    def test_employee_sees_only_visible_resources(self):
        response = self.employee_client.get("/api/onboarding/resources/")
        self.assertEqual(response.status_code, 200)
        titles = {r["title"] for r in response.data}
        self.assertEqual(titles, {"Visible"})

    def test_employee_cannot_create_resource(self):
        response = self.employee_client.post(
            "/api/onboarding/resources/",
            {"title": "x", "category": ResourceCategory.GUIDE, "description": "x"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_can_create_resource(self):
        response = self.admin_client.post(
            "/api/onboarding/resources/",
            {"title": "New guide", "category": ResourceCategory.GUIDE, "description": "desc"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["status"], "DRAFT")  # default, matches source

    def test_create_requires_title_and_description(self):
        response = self.admin_client.post(
            "/api/onboarding/resources/", {"category": ResourceCategory.GUIDE}, format="json"
        )
        self.assertEqual(response.status_code, 400)

    def test_department_scope_requires_department(self):
        response = self.admin_client.post(
            "/api/onboarding/resources/",
            {"title": "x", "category": ResourceCategory.GUIDE, "description": "x", "audience_scope": "DEPARTMENT"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("audience_department", response.data)

    def test_role_scope_requires_role(self):
        response = self.admin_client.post(
            "/api/onboarding/resources/",
            {"title": "x", "category": ResourceCategory.GUIDE, "description": "x", "audience_scope": "ROLE"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertIn("audience_role", response.data)
