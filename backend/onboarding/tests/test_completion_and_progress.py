"""Rule 10: employees can only complete tasks on their currently assigned checklist. Rules 11-12:
employee progress is computed against the current checklist only, and stale completions from a
previously-assigned checklist are excluded WITHOUT being deleted — Phase 6 condition #9."""

from django.test import TestCase
from rest_framework.test import APIClient

from onboarding.models import TaskCompletion
from onboarding.tests.helpers import make_admin, make_checklist, make_department, make_employee, make_task


class TaskCompletionRestrictedToOwnChecklistTest(TestCase):
    """Rule 10."""

    def setUp(self):
        self.dept = make_department()
        self.checklist_a = make_checklist(name="Checklist A")
        self.checklist_b = make_checklist(name="Checklist B")
        self.task_a = make_task(self.checklist_a, title="Task on A")
        self.task_b = make_task(self.checklist_b, title="Task on B")

        self.employee = make_employee(self.dept, email="e@example.com")
        self.employee.onboarding_checklist = self.checklist_a
        self.employee.save(update_fields=["onboarding_checklist"])

        self.client = APIClient()
        self.client.force_authenticate(user=self.employee)

    def test_can_complete_a_task_on_own_checklist(self):
        response = self.client.post(
            f"/api/onboarding/tasks/{self.task_a.id}/complete/", {"completed": True}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(TaskCompletion.objects.filter(employee=self.employee, task=self.task_a).exists())

    def test_cannot_complete_a_task_on_a_different_checklist(self):
        response = self.client.post(
            f"/api/onboarding/tasks/{self.task_b.id}/complete/", {"completed": True}, format="json"
        )
        self.assertEqual(response.status_code, 403)
        self.assertFalse(TaskCompletion.objects.filter(employee=self.employee, task=self.task_b).exists())

    def test_employee_with_no_checklist_cannot_complete_anything(self):
        unassigned = make_employee(self.dept, email="unassigned@example.com")
        client = APIClient()
        client.force_authenticate(user=unassigned)
        response = client.post(f"/api/onboarding/tasks/{self.task_a.id}/complete/", {"completed": True}, format="json")
        self.assertEqual(response.status_code, 403)

    def test_can_uncomplete_a_task(self):
        self.client.post(f"/api/onboarding/tasks/{self.task_a.id}/complete/", {"completed": True}, format="json")
        response = self.client.post(f"/api/onboarding/tasks/{self.task_a.id}/complete/", {"completed": False}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(TaskCompletion.objects.filter(employee=self.employee, task=self.task_a).exists())

    def test_completing_twice_does_not_error_or_duplicate(self):
        self.client.post(f"/api/onboarding/tasks/{self.task_a.id}/complete/", {"completed": True}, format="json")
        response = self.client.post(f"/api/onboarding/tasks/{self.task_a.id}/complete/", {"completed": True}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(TaskCompletion.objects.filter(employee=self.employee, task=self.task_a).count(), 1)


class MyChecklistViewTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.checklist = make_checklist()
        self.task = make_task(self.checklist, title="Sign form")
        self.employee = make_employee(self.dept)
        self.client = APIClient()
        self.client.force_authenticate(user=self.employee)

    def test_returns_null_when_unassigned(self):
        response = self.client.get("/api/onboarding/my-checklist/")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.data)

    def test_returns_checklist_with_tasks_and_completion_state(self):
        self.employee.onboarding_checklist = self.checklist
        self.employee.save(update_fields=["onboarding_checklist"])
        TaskCompletion.objects.create(employee=self.employee, task=self.task)

        response = self.client.get("/api/onboarding/my-checklist/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["checklist"]["id"], self.checklist.id)
        self.assertEqual(len(response.data["tasks"]), 1)
        self.assertTrue(response.data["tasks"][0]["completed"])


class EmployeeProgressTest(TestCase):
    """Rules 11-12, plus Phase 6 condition #9: reassignment excludes stale completions from
    progress but never deletes the underlying TaskCompletion rows."""

    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)

        self.old_checklist = make_checklist(name="Old Checklist")
        self.old_task_1 = make_task(self.old_checklist, title="Old task 1", sort_order=0)
        self.old_task_2 = make_task(self.old_checklist, title="Old task 2", sort_order=1)

        self.new_checklist = make_checklist(name="New Checklist")
        self.new_task_1 = make_task(self.new_checklist, title="New task 1", sort_order=0)
        self.new_task_2 = make_task(self.new_checklist, title="New task 2", sort_order=1)
        self.new_task_3 = make_task(self.new_checklist, title="New task 3", sort_order=2)

        self.employee = make_employee(self.dept, email="progress@example.com")

    def _progress_row(self):
        response = self.admin_client.get("/api/onboarding/progress/")
        self.assertEqual(response.status_code, 200)
        return next(row for row in response.data if row["employee"]["id"] == self.employee.id)

    def test_progress_computed_against_current_checklist_only(self):
        self.employee.onboarding_checklist = self.new_checklist
        self.employee.save(update_fields=["onboarding_checklist"])
        TaskCompletion.objects.create(employee=self.employee, task=self.new_task_1)

        row = self._progress_row()
        self.assertEqual(row["checklist"]["id"], self.new_checklist.id)
        self.assertEqual(row["total_tasks"], 3)
        self.assertEqual(row["completed_tasks"], 1)

    def test_reassignment_excludes_stale_completions_from_progress(self):
        # Employee starts on the old checklist and completes both its tasks.
        self.employee.onboarding_checklist = self.old_checklist
        self.employee.save(update_fields=["onboarding_checklist"])
        TaskCompletion.objects.create(employee=self.employee, task=self.old_task_1)
        TaskCompletion.objects.create(employee=self.employee, task=self.old_task_2)

        row = self._progress_row()
        self.assertEqual(row["completed_tasks"], 2)
        self.assertEqual(row["total_tasks"], 2)

        # Reassign to a different checklist — the two old completions must stop counting.
        self.employee.onboarding_checklist = self.new_checklist
        self.employee.save(update_fields=["onboarding_checklist"])

        row = self._progress_row()
        self.assertEqual(row["checklist"]["id"], self.new_checklist.id)
        self.assertEqual(row["total_tasks"], 3)
        self.assertEqual(row["completed_tasks"], 0, "stale completions from the OLD checklist must not count")

        # But the historical rows themselves must still exist — never silently deleted.
        self.assertTrue(TaskCompletion.objects.filter(employee=self.employee, task=self.old_task_1).exists())
        self.assertTrue(TaskCompletion.objects.filter(employee=self.employee, task=self.old_task_2).exists())
        self.assertEqual(TaskCompletion.objects.filter(employee=self.employee).count(), 2)

    def test_unassigned_employee_has_zero_total_and_null_checklist(self):
        row = self._progress_row()
        self.assertIsNone(row["checklist"])
        self.assertEqual(row["total_tasks"], 0)
        self.assertEqual(row["completed_tasks"], 0)

    def test_inactive_employees_excluded_from_progress(self):
        from accounts.models import EmployeeStatus

        self.employee.status = EmployeeStatus.INACTIVE
        self.employee.save(update_fields=["status"])
        response = self.admin_client.get("/api/onboarding/progress/")
        ids = [row["employee"]["id"] for row in response.data]
        self.assertNotIn(self.employee.id, ids)

    def test_employee_cannot_view_progress(self):
        client = APIClient()
        client.force_authenticate(user=self.employee)
        response = client.get("/api/onboarding/progress/")
        self.assertEqual(response.status_code, 403)
