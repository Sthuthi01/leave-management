"""Rule 13 (size/MIME enforced server-side) plus Phase 6 conditions #2-4: downloads only through
an authenticated, visibility-checked view (never a raw media URL), and replacing/deleting a
document actually removes the old file from storage instead of orphaning it.

MEDIA_ROOT is overridden to a throwaway temp directory for the whole module so these tests never
touch the real dev media volume and clean up completely afterward.
"""

import os
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from onboarding.models import AudienceScope, ResourceDocument, ResourceStatus
from onboarding.tests.helpers import make_admin, make_department, make_employee, make_resource

_MEDIA_ROOT = tempfile.mkdtemp(prefix="onboarding_test_media_")


def _pdf(name="policy.pdf", content=b"%PDF-1.4 fake pdf content", content_type="application/pdf"):
    return SimpleUploadedFile(name, content, content_type=content_type)


@override_settings(MEDIA_ROOT=_MEDIA_ROOT)
class ResourceDocumentTest(TestCase):
    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        shutil.rmtree(_MEDIA_ROOT, ignore_errors=True)

    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.employee = make_employee(self.dept)
        self.resource = make_resource(audience_scope=AudienceScope.ALL, status=ResourceStatus.PUBLISHED)
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    # ---- upload RBAC + validation (rule 13) ----

    def test_employee_cannot_upload(self):
        response = self.employee_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": _pdf()}, format="multipart"
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_can_upload_allowed_type(self):
        response = self.admin_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": _pdf()}, format="multipart"
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["file_name"], "policy.pdf")
        self.assertTrue(ResourceDocument.objects.filter(resource=self.resource).exists())

    def test_disallowed_mime_type_rejected(self):
        bad_file = SimpleUploadedFile("virus.exe", b"MZ...", content_type="application/x-msdownload")
        response = self.admin_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": bad_file}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ResourceDocument.objects.filter(resource=self.resource).exists())

    def test_oversized_file_rejected(self):
        big_file = SimpleUploadedFile("huge.pdf", b"x" * (10 * 1024 * 1024 + 1), content_type="application/pdf")
        response = self.admin_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": big_file}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(ResourceDocument.objects.filter(resource=self.resource).exists())

    def test_empty_file_rejected(self):
        empty = SimpleUploadedFile("empty.pdf", b"", content_type="application/pdf")
        response = self.admin_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": empty}, format="multipart"
        )
        self.assertEqual(response.status_code, 400)

    def test_missing_file_rejected(self):
        response = self.admin_client.post(f"/api/onboarding/resources/{self.resource.id}/document/", {}, format="multipart")
        self.assertEqual(response.status_code, 400)

    # ---- storage cleanup (Phase 6 condition #4) ----

    def test_replacing_a_document_deletes_the_old_file_from_disk(self):
        self.admin_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": _pdf("first.pdf")}, format="multipart"
        )
        first_path = ResourceDocument.objects.get(resource=self.resource).file.path
        self.assertTrue(os.path.exists(first_path))

        response = self.admin_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": _pdf("second.pdf")}, format="multipart"
        )
        self.assertEqual(response.status_code, 201)
        self.assertFalse(os.path.exists(first_path), "old file must be removed from storage on replace, not orphaned")
        self.assertEqual(ResourceDocument.objects.filter(resource=self.resource).count(), 1)
        self.assertEqual(ResourceDocument.objects.get(resource=self.resource).file_name, "second.pdf")

    def test_deleting_a_document_removes_the_file_from_disk(self):
        self.admin_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": _pdf()}, format="multipart"
        )
        path = ResourceDocument.objects.get(resource=self.resource).file.path
        self.assertTrue(os.path.exists(path))

        response = self.admin_client.delete(f"/api/onboarding/resources/{self.resource.id}/document/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(os.path.exists(path))
        self.assertFalse(ResourceDocument.objects.filter(resource=self.resource).exists())

    def test_deleting_the_resource_removes_its_document_file(self):
        self.admin_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": _pdf()}, format="multipart"
        )
        path = ResourceDocument.objects.get(resource=self.resource).file.path
        response = self.admin_client.delete(f"/api/onboarding/resources/{self.resource.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(os.path.exists(path))

    def test_employee_cannot_delete_document(self):
        self.admin_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": _pdf()}, format="multipart"
        )
        response = self.employee_client.delete(f"/api/onboarding/resources/{self.resource.id}/document/")
        self.assertEqual(response.status_code, 403)

    # ---- download auth + visibility (Phase 6 condition #2) ----

    def test_unauthenticated_download_rejected(self):
        self.admin_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": _pdf()}, format="multipart"
        )
        response = APIClient().get(f"/api/onboarding/resources/{self.resource.id}/document/")
        self.assertIn(response.status_code, (401, 403))

    def test_employee_can_download_a_visible_resources_document(self):
        self.admin_client.post(
            f"/api/onboarding/resources/{self.resource.id}/document/", {"file": _pdf()}, format="multipart"
        )
        response = self.employee_client.get(f"/api/onboarding/resources/{self.resource.id}/document/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "application/pdf")

    def test_employee_cannot_download_a_draft_resources_document(self):
        draft_resource = make_resource(status=ResourceStatus.DRAFT)
        self.admin_client.post(
            f"/api/onboarding/resources/{draft_resource.id}/document/", {"file": _pdf()}, format="multipart"
        )
        response = self.employee_client.get(f"/api/onboarding/resources/{draft_resource.id}/document/")
        self.assertEqual(response.status_code, 403)

    def test_employee_cannot_download_a_document_for_another_departments_resource(self):
        other_dept = make_department("Sales")
        restricted = make_resource(audience_scope=AudienceScope.DEPARTMENT, audience_department=other_dept)
        self.admin_client.post(
            f"/api/onboarding/resources/{restricted.id}/document/", {"file": _pdf()}, format="multipart"
        )
        response = self.employee_client.get(f"/api/onboarding/resources/{restricted.id}/document/")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_always_download_including_drafts(self):
        draft_resource = make_resource(status=ResourceStatus.DRAFT)
        self.admin_client.post(
            f"/api/onboarding/resources/{draft_resource.id}/document/", {"file": _pdf()}, format="multipart"
        )
        response = self.admin_client.get(f"/api/onboarding/resources/{draft_resource.id}/document/")
        self.assertEqual(response.status_code, 200)

    def test_download_404s_when_resource_has_no_document(self):
        response = self.admin_client.get(f"/api/onboarding/resources/{self.resource.id}/document/")
        self.assertEqual(response.status_code, 404)
