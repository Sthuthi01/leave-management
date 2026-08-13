"""Rules 8-9: deleting a task cleans up its completions, and move_task preserves ordering while
silently no-op'ing at the first/last boundary instead of erroring."""

from django.test import TestCase
from rest_framework.test import APIClient

from onboarding.models import Task, TaskCompletion
from onboarding.tests.helpers import make_admin, make_checklist, make_department, make_employee, make_resource, make_task


class TaskCreateTest(TestCase):
    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.employee = make_employee(self.dept)
        self.checklist = make_checklist()
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)
        self.employee_client = APIClient()
        self.employee_client.force_authenticate(user=self.employee)

    def test_employee_cannot_create_task(self):
        response = self.employee_client.post(
            f"/api/onboarding/checklists/{self.checklist.id}/tasks/", {"title": "x"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_creates_task_with_auto_incrementing_sort_order(self):
        r1 = self.admin_client.post(f"/api/onboarding/checklists/{self.checklist.id}/tasks/", {"title": "First"}, format="json")
        r2 = self.admin_client.post(f"/api/onboarding/checklists/{self.checklist.id}/tasks/", {"title": "Second"}, format="json")
        self.assertEqual(r1.status_code, 201)
        self.assertEqual(r2.status_code, 201)
        self.assertEqual(r1.data["sort_order"], 0)
        self.assertEqual(r2.data["sort_order"], 1)

    def test_task_with_unknown_resource_rejected(self):
        response = self.admin_client.post(
            f"/api/onboarding/checklists/{self.checklist.id}/tasks/",
            {"title": "x", "resource": 999999},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_task_can_reference_a_resource(self):
        resource = make_resource()
        response = self.admin_client.post(
            f"/api/onboarding/checklists/{self.checklist.id}/tasks/",
            {"title": "Read the handbook", "resource": resource.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["resource"]["id"], resource.id)

    def test_create_on_unknown_checklist_404s(self):
        response = self.admin_client.post("/api/onboarding/checklists/999999/tasks/", {"title": "x"}, format="json")
        self.assertEqual(response.status_code, 404)


class TaskDeleteCascadeTest(TestCase):
    """Rule 8."""

    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.employee = make_employee(self.dept)
        self.checklist = make_checklist()
        self.task = make_task(self.checklist)
        self.employee.onboarding_checklist = self.checklist
        self.employee.save(update_fields=["onboarding_checklist"])
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def test_deleting_a_task_removes_its_completions(self):
        TaskCompletion.objects.create(employee=self.employee, task=self.task)
        self.assertEqual(TaskCompletion.objects.count(), 1)

        response = self.client.delete(f"/api/onboarding/tasks/{self.task.id}/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(TaskCompletion.objects.count(), 0)
        self.assertFalse(Task.objects.filter(pk=self.task.id).exists())

    def test_employee_cannot_delete_task(self):
        employee_client = APIClient()
        employee_client.force_authenticate(user=self.employee)
        response = employee_client.delete(f"/api/onboarding/tasks/{self.task.id}/")
        self.assertEqual(response.status_code, 403)


class TaskMoveTest(TestCase):
    """Rule 9 — the boundary no-op behavior is the easy part to get wrong."""

    def setUp(self):
        self.dept = make_department()
        self.admin = make_admin(self.dept)
        self.checklist = make_checklist()
        self.t1 = make_task(self.checklist, title="First", sort_order=0)
        self.t2 = make_task(self.checklist, title="Second", sort_order=1)
        self.t3 = make_task(self.checklist, title="Third", sort_order=2)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def _order(self):
        return list(Task.objects.filter(checklist=self.checklist).order_by("sort_order").values_list("title", flat=True))

    def test_move_middle_task_up_swaps_with_previous(self):
        response = self.client.post(f"/api/onboarding/tasks/{self.t2.id}/move/", {"direction": "up"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._order(), ["Second", "First", "Third"])

    def test_move_middle_task_down_swaps_with_next(self):
        response = self.client.post(f"/api/onboarding/tasks/{self.t2.id}/move/", {"direction": "down"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._order(), ["First", "Third", "Second"])

    def test_moving_first_task_up_is_a_silent_noop(self):
        response = self.client.post(f"/api/onboarding/tasks/{self.t1.id}/move/", {"direction": "up"}, format="json")
        self.assertEqual(response.status_code, 200)  # not an error
        self.assertEqual(self._order(), ["First", "Second", "Third"])  # unchanged

    def test_moving_last_task_down_is_a_silent_noop(self):
        response = self.client.post(f"/api/onboarding/tasks/{self.t3.id}/move/", {"direction": "down"}, format="json")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._order(), ["First", "Second", "Third"])

    def test_single_task_checklist_move_is_a_noop_both_directions(self):
        solo_checklist = make_checklist(name="Solo")
        solo_task = make_task(solo_checklist, title="Only", sort_order=0)
        for direction in ("up", "down"):
            response = self.client.post(f"/api/onboarding/tasks/{solo_task.id}/move/", {"direction": direction}, format="json")
            self.assertEqual(response.status_code, 200)
        solo_task.refresh_from_db()
        self.assertEqual(solo_task.sort_order, 0)

    def test_invalid_direction_rejected(self):
        response = self.client.post(f"/api/onboarding/tasks/{self.t1.id}/move/", {"direction": "sideways"}, format="json")
        self.assertEqual(response.status_code, 400)

    def test_employee_cannot_move_task(self):
        employee = make_employee(self.dept)
        employee_client = APIClient()
        employee_client.force_authenticate(user=employee)
        response = employee_client.post(f"/api/onboarding/tasks/{self.t1.id}/move/", {"direction": "down"}, format="json")
        self.assertEqual(response.status_code, 403)
