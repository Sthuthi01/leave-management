"""Rules 4-6: a resource version is created only when a content field actually changes,
metadata-only edits never create one, and a resource referenced by a task cannot be deleted.
Also covers PATCH/DELETE RBAC (admin-only, matches source — no GET on this route)."""

from django.test import TestCase
from rest_framework.test import APIClient

from onboarding.models import Resource, ResourceVersion
from onboarding.tests.helpers import make_admin, make_checklist, make_department, make_employee, make_resource, make_task


class ResourceUpdateRbacTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.employee = make_employee(self.dept)
        self.resource = make_resource()
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    def test_employee_cannot_patch(self):
        response = self.employee_client.patch(
            f"/api/onboarding/resources/{self.resource.id}/", {"title": "Hacked"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_employee_cannot_delete(self):
        response = self.employee_client.delete(f"/api/onboarding/resources/{self.resource.id}/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_rejected(self):
        response = APIClient().patch(f"/api/onboarding/resources/{self.resource.id}/", {}, format="json")
        self.assertIn(response.status_code, (401, 403))

    def test_admin_can_patch(self):
        response = self.admin_client.patch(
            f"/api/onboarding/resources/{self.resource.id}/", {"title": "Updated Title"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["title"], "Updated Title")

    def test_patch_unknown_resource_404s(self):
        response = self.admin_client.patch("/api/onboarding/resources/999999/", {"title": "x"}, format="json")
        self.assertEqual(response.status_code, 404)

    def test_resource_detail_has_no_get(self):
        # Matches the source app exactly — resources/[id]/route.ts exports only PATCH and DELETE.
        response = self.admin_client.get(f"/api/onboarding/resources/{self.resource.id}/")
        self.assertEqual(response.status_code, 405)


class ResourceVersioningTest(TestCase):
    """Rules 4-5 — the trickiest and most easily-broken business rule in this phase."""

    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.resource = make_resource(title="Original Title", content="Original content")
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_content_field_change_creates_a_version_and_bumps_counter(self):
        self.assertEqual(self.resource.version, 1)
        response = self.client.patch(
            f"/api/onboarding/resources/{self.resource.id}/", {"content": "Changed content"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.resource.refresh_from_db()
        self.assertEqual(self.resource.version, 2)
        versions = list(ResourceVersion.objects.filter(resource=self.resource))
        self.assertEqual(len(versions), 1)
        self.assertEqual(versions[0].version, 1)  # snapshot holds the PRE-edit version number
        self.assertEqual(versions[0].content, "Original content")

    def test_title_change_creates_a_version(self):
        response = self.client.patch(
            f"/api/onboarding/resources/{self.resource.id}/", {"title": "New Title"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.resource.refresh_from_db()
        self.assertEqual(self.resource.version, 2)
        self.assertEqual(ResourceVersion.objects.filter(resource=self.resource).count(), 1)

    def test_metadata_only_edit_does_not_create_a_version(self):
        response = self.client.patch(
            f"/api/onboarding/resources/{self.resource.id}/",
            {"status": "DRAFT", "is_required": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.resource.refresh_from_db()
        self.assertEqual(self.resource.version, 1)  # unchanged
        self.assertEqual(ResourceVersion.objects.filter(resource=self.resource).count(), 0)

    def test_resubmitting_identical_content_does_not_create_a_version(self):
        # A full-form edit that resends the SAME content — not just an omitted field — must not
        # be mistaken for a real change.
        response = self.client.patch(
            f"/api/onboarding/resources/{self.resource.id}/",
            {"title": "Original Title", "content": "Original content"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.resource.refresh_from_db()
        self.assertEqual(self.resource.version, 1)
        self.assertEqual(ResourceVersion.objects.filter(resource=self.resource).count(), 0)

    def test_multiple_content_edits_accumulate_version_history_in_order(self):
        self.client.patch(f"/api/onboarding/resources/{self.resource.id}/", {"content": "v2 content"}, format="json")
        self.client.patch(f"/api/onboarding/resources/{self.resource.id}/", {"content": "v3 content"}, format="json")
        self.resource.refresh_from_db()
        self.assertEqual(self.resource.version, 3)
        versions = list(ResourceVersion.objects.filter(resource=self.resource).order_by("version"))
        self.assertEqual([v.version for v in versions], [1, 2])
        self.assertEqual(versions[0].content, "Original content")
        self.assertEqual(versions[1].content, "v2 content")

    def test_versions_endpoint_admin_only(self):
        employee = make_employee(self.dept, email="e@example.com")
        employee_client = APIClient()
        employee_client.force_authenticate(user=employee)
        response = employee_client.get(f"/api/onboarding/resources/{self.resource.id}/versions/")
        self.assertEqual(response.status_code, 403)

        response = self.client.get(f"/api/onboarding/resources/{self.resource.id}/versions/")
        self.assertEqual(response.status_code, 200)


class ResourceDeleteGuardTest(TestCase):
    """Rule 6: a resource referenced by a checklist task cannot be deleted."""

    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_unreferenced_resource_can_be_deleted(self):
        resource = make_resource()
        response = self.client.delete(f"/api/onboarding/resources/{resource.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(Resource.objects.filter(pk=resource.id).exists())

    def test_resource_referenced_by_task_cannot_be_deleted(self):
        resource = make_resource()
        checklist = make_checklist()
        make_task(checklist, resource=resource)
        response = self.client.delete(f"/api/onboarding/resources/{resource.id}/")
        self.assertEqual(response.status_code, 400)
        self.assertTrue(Resource.objects.filter(pk=resource.id).exists())

    def test_resource_becomes_deletable_once_no_longer_referenced(self):
        resource = make_resource()
        checklist = make_checklist()
        task = make_task(checklist, resource=resource)
        task.delete()
        response = self.client.delete(f"/api/onboarding/resources/{resource.id}/")
        self.assertEqual(response.status_code, 200)
