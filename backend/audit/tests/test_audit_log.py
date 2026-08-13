"""Phase 3 audit log tests.

Covers: GET /api/audit-log/ RBAC, that every instrumented mutation writes the correct entry
(action/actor/target_type/target_label/details), that failed mutations never write a misleading
entry, that an audit entry survives its actor being deleted, and that the log_audit() call inside
a transaction.atomic() block doesn't disturb the business effects committed alongside it.
"""
import datetime

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import Employee, EmployeeStatus, Role, TokenPurpose
from accounts.tokens import create_token
from audit.models import AuditLogEntry
from departments.models import Department
from holidays.models import Holiday
from leave_balances.services import get_or_create_balance
from leave_requests.models import LeaveRequest, LeaveStatus
from leave_requests.tests.helpers import make_department, make_employee, make_leave_type, make_manager
from leave_types.models import LeaveType


def _next_monday(after: datetime.date) -> datetime.date:
    days_ahead = (7 - after.weekday()) % 7 or 7
    return after + datetime.timedelta(days=days_ahead)


class AuditLogApiTest(TestCase):
    """GET /api/audit-log/ — RBAC and basic shape."""

    def setUp(self):
        self.dept = make_department()
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept,
        )
        self.employee = make_employee(self.dept, email="worker@example.com")
        AuditLogEntry.objects.create(
            actor=self.admin, actor_name=self.admin.name, action="Added department",
            target_type="Department", target_label="Engineering",
        )

    def test_admin_can_read_audit_log(self):
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.get("/api/audit-log/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        entry = response.data[0]
        self.assertEqual(entry["action"], "Added department")
        self.assertEqual(entry["actor_name"], "Admin")
        self.assertEqual(entry["target_type"], "Department")
        self.assertEqual(entry["target_label"], "Engineering")

    def test_non_admin_gets_403(self):
        client = APIClient()
        client.force_authenticate(user=self.employee)
        response = client.get("/api/audit-log/")
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_rejected(self):
        response = APIClient().get("/api/audit-log/")
        self.assertIn(response.status_code, (401, 403))

    def test_ordered_newest_first(self):
        AuditLogEntry.objects.create(
            actor=self.admin, actor_name=self.admin.name, action="Added holiday",
            target_type="Holiday", target_label="Diwali (2026-11-08)",
        )
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.get("/api/audit-log/")
        self.assertEqual(response.data[0]["action"], "Added holiday")
        self.assertEqual(response.data[1]["action"], "Added department")


class AuditActionsTest(TestCase):
    """One entry, with the correct fields, per instrumented mutation."""

    def setUp(self):
        self.dept = make_department()
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept,
        )
        self.admin_client = APIClient()
        self.admin_client.force_authenticate(user=self.admin)

    def _last_entry(self):
        return AuditLogEntry.objects.order_by("-id").first()

    # ---- employees ----

    def test_added_employee(self):
        other_dept = Department.objects.create(name="Sales")
        response = self.admin_client.post(
            "/api/employees/",
            {"name": "New Hire", "email": "new.hire@example.com", "title": "Rep", "department": other_dept.id},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Added employee")
        self.assertEqual(entry.actor_id, self.admin.id)
        self.assertEqual(entry.target_type, "Employee")
        self.assertEqual(entry.target_label, "New Hire")
        self.assertEqual(entry.details, "Invitation sent to new.hire@example.com")

    def test_edited_employee(self):
        worker = make_employee(self.dept, email="worker@example.com")
        response = self.admin_client.patch(f"/api/employees/{worker.id}/", {"title": "Senior Engineer"}, format="json")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Edited employee")
        self.assertEqual(entry.target_label, "Employee")

    def test_deactivated_employee(self):
        worker = make_employee(self.dept, email="worker@example.com")
        response = self.admin_client.patch(f"/api/employees/{worker.id}/", {"status": "INACTIVE"}, format="json")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Deactivated employee")

    def test_reactivated_employee(self):
        worker = make_employee(self.dept, email="worker@example.com")
        worker.status = EmployeeStatus.INACTIVE
        worker.save(update_fields=["status"])
        response = self.admin_client.patch(f"/api/employees/{worker.id}/", {"status": "ACTIVE"}, format="json")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Reactivated employee")

    def test_activated_account_via_set_password_invite_token(self):
        worker = make_employee(self.dept, email="worker@example.com")
        worker.set_unusable_password()
        worker.save(update_fields=["password"])
        raw_token = create_token(worker, TokenPurpose.INVITE)
        response = APIClient().post("/api/auth/set-password/", {"token": raw_token, "password": "BrandNewPass123"}, format="json")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Activated account")
        self.assertEqual(entry.actor_id, worker.id)
        self.assertEqual(entry.target_label, "Employee")

    def test_reset_password_via_set_password_reset_token(self):
        worker = make_employee(self.dept, email="worker@example.com", )
        worker.set_password("OldPass123456")
        worker.save(update_fields=["password"])
        raw_token = create_token(worker, TokenPurpose.RESET)
        response = APIClient().post("/api/auth/set-password/", {"token": raw_token, "password": "BrandNewPass123"}, format="json")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Reset password")
        self.assertEqual(entry.actor_id, worker.id)

    def test_changed_password(self):
        worker = make_employee(self.dept, email="worker@example.com")
        worker.set_password("OldPass123456")
        worker.save(update_fields=["password"])
        client = APIClient()
        client.force_authenticate(user=worker)
        response = client.post(
            "/api/auth/change-password/",
            {"current_password": "OldPass123456", "new_password": "BrandNewPass123"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Changed password")
        self.assertEqual(entry.actor_id, worker.id)
        self.assertEqual(entry.target_label, worker.name)

    def test_resent_invitation(self):
        worker = make_employee(self.dept, email="worker@example.com")
        worker.set_unusable_password()
        worker.save(update_fields=["password"])
        response = self.admin_client.post(f"/api/employees/{worker.id}/resend-invitation/")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Resent invitation")
        self.assertEqual(entry.actor_id, self.admin.id)
        self.assertEqual(entry.details, f"Invitation sent to {worker.email}")

    def test_sent_password_reset_link(self):
        worker = make_employee(self.dept, email="worker@example.com")
        worker.set_password("SomePass123456")
        worker.save(update_fields=["password"])
        response = self.admin_client.post(f"/api/employees/{worker.id}/send-password-reset/")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Sent password reset link")
        self.assertEqual(entry.details, f"Password reset link sent to {worker.email}")

    # ---- departments ----

    def test_added_department(self):
        response = self.admin_client.post("/api/departments/", {"name": "Marketing"}, format="json")
        self.assertEqual(response.status_code, 201)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Added department")
        self.assertEqual(entry.target_label, "Marketing")

    def test_edited_department(self):
        dept = Department.objects.create(name="Old Name")
        response = self.admin_client.patch(f"/api/departments/{dept.id}/", {"name": "New Name"}, format="json")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Edited department")
        self.assertEqual(entry.target_label, "Old Name → New Name")

    def test_removed_department(self):
        dept = Department.objects.create(name="Temp Dept")
        response = self.admin_client.delete(f"/api/departments/{dept.id}/")
        self.assertEqual(response.status_code, 204)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Removed department")
        self.assertEqual(entry.target_label, "Temp Dept")

    # ---- leave types ----

    def test_added_leave_type(self):
        response = self.admin_client.post(
            "/api/leave-types/",
            {"name": "Sick Leave", "code": "SL", "color": "#16a34a", "default_days_per_year": 10},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Added leave type")
        self.assertEqual(entry.target_label, "Sick Leave")

    def test_edited_leave_type(self):
        lt = make_leave_type(name="Casual Leave", code="CL")
        response = self.admin_client.patch(f"/api/leave-types/{lt.id}/", {"name": "Casual Time Off"}, format="json")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Edited leave type")
        self.assertEqual(entry.target_label, "Casual Time Off")

    def test_removed_leave_type(self):
        lt = make_leave_type(name="Unused Leave", code="UL")
        response = self.admin_client.delete(f"/api/leave-types/{lt.id}/")
        self.assertEqual(response.status_code, 204)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Removed leave type")
        self.assertEqual(entry.target_label, "Unused Leave")

    # ---- holidays ----

    def test_added_holiday(self):
        response = self.admin_client.post(
            "/api/holidays/", {"name": "Founders Day", "date": "2026-09-01", "optional": False}, format="json"
        )
        self.assertEqual(response.status_code, 201)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Added holiday")
        self.assertEqual(entry.target_label, "Founders Day (2026-09-01)")

    def test_edited_holiday(self):
        holiday = Holiday.objects.create(name="Old Holiday", date="2026-10-01")
        response = self.admin_client.patch(f"/api/holidays/{holiday.id}/", {"name": "Renamed Holiday"}, format="json")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Edited holiday")
        self.assertEqual(entry.target_label, "Renamed Holiday (2026-10-01)")

    def test_removed_holiday(self):
        holiday = Holiday.objects.create(name="Gone Holiday", date="2026-12-01")
        response = self.admin_client.delete(f"/api/holidays/{holiday.id}/")
        self.assertEqual(response.status_code, 204)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Removed holiday")
        self.assertEqual(entry.target_label, "Gone Holiday (2026-12-01)")

    # ---- leave requests ----

    def test_applied_leave_requires_approval(self):
        manager = make_manager(self.dept, email="manager2@example.com")
        worker = make_employee(self.dept, manager=manager, email="applicant@example.com")
        lt = make_leave_type(name="Approval Leave", code="APL", requires_approval=True)
        monday = _next_monday(timezone.now().date())
        client = APIClient()
        client.force_authenticate(user=worker)
        response = client.post(
            "/api/leave-requests/",
            {"leave_type": lt.id, "start_date": monday.isoformat(), "end_date": monday.isoformat(), "reason": "Trip"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Applied leave")
        self.assertEqual(entry.actor_id, worker.id)
        self.assertIn(worker.name, entry.target_label)

    def test_applied_leave_auto_approved(self):
        worker = make_employee(self.dept, email="applicant2@example.com")
        lt = make_leave_type(name="Auto Leave", code="AUTO", requires_approval=False, default_days_per_year=10)
        monday = _next_monday(timezone.now().date())
        get_or_create_balance(worker, lt, monday.year)
        client = APIClient()
        client.force_authenticate(user=worker)
        response = client.post(
            "/api/leave-requests/",
            {"leave_type": lt.id, "start_date": monday.isoformat(), "end_date": monday.isoformat(), "reason": "Trip"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Applied leave (auto-approved)")

    def test_approved_leave(self):
        manager = make_manager(self.dept, email="manager3@example.com")
        worker = make_employee(self.dept, manager=manager, email="applicant3@example.com")
        lt = make_leave_type(name="Approve Leave", code="APR", requires_approval=True)
        monday = _next_monday(timezone.now().date())
        applicant_client = APIClient()
        applicant_client.force_authenticate(user=worker)
        apply_response = applicant_client.post(
            "/api/leave-requests/",
            {"leave_type": lt.id, "start_date": monday.isoformat(), "end_date": monday.isoformat(), "reason": "Trip"},
            format="json",
        )
        request_id = apply_response.data["id"]

        manager_client = APIClient()
        manager_client.force_authenticate(user=manager)
        response = manager_client.post(f"/api/leave-requests/{request_id}/decide/", {"decision": "APPROVED"}, format="json")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Approved leave")
        self.assertEqual(entry.actor_id, manager.id)
        self.assertIn(worker.name, entry.target_label)

    def test_rejected_leave_captures_comment_as_details(self):
        manager = make_manager(self.dept, email="manager4@example.com")
        worker = make_employee(self.dept, manager=manager, email="applicant4@example.com")
        lt = make_leave_type(name="Reject Leave", code="REJ", requires_approval=True)
        monday = _next_monday(timezone.now().date())
        applicant_client = APIClient()
        applicant_client.force_authenticate(user=worker)
        apply_response = applicant_client.post(
            "/api/leave-requests/",
            {"leave_type": lt.id, "start_date": monday.isoformat(), "end_date": monday.isoformat(), "reason": "Trip"},
            format="json",
        )
        request_id = apply_response.data["id"]

        manager_client = APIClient()
        manager_client.force_authenticate(user=manager)
        response = manager_client.post(
            f"/api/leave-requests/{request_id}/decide/",
            {"decision": "REJECTED", "comment": "Too busy that week"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Rejected leave")
        self.assertEqual(entry.details, "Too busy that week")

    def test_cancelled_leave(self):
        worker = make_employee(self.dept, email="applicant5@example.com")
        lt = make_leave_type(name="Cancel Leave", code="CAN", requires_approval=False, default_days_per_year=10)
        monday = _next_monday(timezone.now().date())
        get_or_create_balance(worker, lt, monday.year)
        client = APIClient()
        client.force_authenticate(user=worker)
        apply_response = client.post(
            "/api/leave-requests/",
            {"leave_type": lt.id, "start_date": monday.isoformat(), "end_date": monday.isoformat(), "reason": "Trip"},
            format="json",
        )
        request_id = apply_response.data["id"]
        response = client.post(f"/api/leave-requests/{request_id}/cancel/")
        self.assertEqual(response.status_code, 200)
        entry = self._last_entry()
        self.assertEqual(entry.action, "Cancelled leave")
        self.assertEqual(entry.actor_id, worker.id)


class AuditNegativeTest(TestCase):
    """Failed/rejected mutations must not write a misleading successful audit entry."""

    def setUp(self):
        self.dept = make_department()
        self.admin = Employee.objects.create_user(
            email="admin@example.com", name="Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=self.dept,
        )
        self.employee = make_employee(self.dept, email="worker@example.com")

    def test_non_admin_create_employee_forbidden_no_audit(self):
        client = APIClient()
        client.force_authenticate(user=self.employee)
        response = client.post(
            "/api/employees/",
            {"name": "X", "email": "x@example.com", "title": "T", "department": self.dept.id},
            format="json",
        )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(AuditLogEntry.objects.count(), 0)

    def test_invalid_department_create_rejected_no_audit(self):
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.post("/api/employees/", {"name": "X", "email": "x@example.com", "title": "T", "department": 999999}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(AuditLogEntry.objects.count(), 0)

    def test_change_password_wrong_current_password_no_audit(self):
        self.employee.set_password("RealPass123456")
        self.employee.save(update_fields=["password"])
        client = APIClient()
        client.force_authenticate(user=self.employee)
        response = client.post(
            "/api/auth/change-password/",
            {"current_password": "WrongPass999999", "new_password": "NewPass123456"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(AuditLogEntry.objects.count(), 0)

    def test_set_password_invalid_token_no_audit(self):
        response = APIClient().post("/api/auth/set-password/", {"token": "not-a-real-token", "password": "NewPass123456"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(AuditLogEntry.objects.count(), 0)

    def test_duplicate_department_name_rejected_no_audit(self):
        Department.objects.create(name="Duplicate")
        client = APIClient()
        client.force_authenticate(user=self.admin)
        response = client.post("/api/departments/", {"name": "Duplicate"}, format="json")
        self.assertEqual(response.status_code, 400)
        # Only the setUp's implicit zero + this rejected attempt — no entry for the failed create.
        self.assertEqual(AuditLogEntry.objects.filter(action="Added department").count(), 0)

    def test_reject_without_comment_rejected_no_audit(self):
        manager = make_manager(self.dept, email="manager5@example.com")
        worker = make_employee(self.dept, manager=manager, email="applicant6@example.com")
        lt = make_leave_type(name="No Comment Leave", code="NCL", requires_approval=True)
        monday = _next_monday(timezone.now().date())
        applicant_client = APIClient()
        applicant_client.force_authenticate(user=worker)
        apply_response = applicant_client.post(
            "/api/leave-requests/",
            {"leave_type": lt.id, "start_date": monday.isoformat(), "end_date": monday.isoformat(), "reason": "Trip"},
            format="json",
        )
        request_id = apply_response.data["id"]
        entries_after_apply = AuditLogEntry.objects.count()

        manager_client = APIClient()
        manager_client.force_authenticate(user=manager)
        response = manager_client.post(f"/api/leave-requests/{request_id}/decide/", {"decision": "REJECTED"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(AuditLogEntry.objects.count(), entries_after_apply)

    def test_apply_leave_insufficient_balance_no_audit(self):
        worker = make_employee(self.dept, email="applicant7@example.com")
        lt = make_leave_type(name="Capped Leave", code="CAP", requires_approval=False, default_days_per_year=1)
        monday = _next_monday(timezone.now().date())
        tuesday = monday + datetime.timedelta(days=1)
        get_or_create_balance(worker, lt, monday.year)
        client = APIClient()
        client.force_authenticate(user=worker)
        response = client.post(
            "/api/leave-requests/",
            {"leave_type": lt.id, "start_date": monday.isoformat(), "end_date": tuesday.isoformat(), "reason": "Too long"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(AuditLogEntry.objects.filter(action__startswith="Applied leave").count(), 0)


class AuditDeletionSurvivalTest(TestCase):
    """An audit entry must outlive the employee who produced it."""

    def test_actor_deletion_preserves_entry_and_name(self):
        dept = make_department()
        admin = Employee.objects.create_user(
            email="temp-admin@example.com", name="Temp Admin", password="AdminPass123",
            role=Role.ADMIN, title="HR Administrator", department=dept,
        )
        client = APIClient()
        client.force_authenticate(user=admin)
        response = client.post("/api/departments/", {"name": "Survives Deletion"}, format="json")
        self.assertEqual(response.status_code, 201)

        entry = AuditLogEntry.objects.get(target_label="Survives Deletion")
        self.assertEqual(entry.actor_id, admin.id)
        self.assertEqual(entry.actor_name, "Temp Admin")

        admin.delete()

        entry.refresh_from_db()
        self.assertIsNone(entry.actor_id)
        self.assertEqual(entry.actor_name, "Temp Admin")
        self.assertEqual(entry.action, "Added department")
        self.assertEqual(entry.target_label, "Survives Deletion")


class AuditTransactionIntegrityTest(TestCase):
    """log_audit() inside a service's transaction.atomic() block must not disturb the business
    effects committed alongside it — the balance change and the audit entry both land, or (on a
    validation failure raised before the atomic block commits) neither does."""

    def test_apply_leave_balance_and_audit_entry_both_commit(self):
        dept = make_department()
        worker = make_employee(dept, email="txn-applicant@example.com")
        lt = make_leave_type(name="Txn Leave", code="TXN", requires_approval=False, default_days_per_year=10)
        monday = _next_monday(timezone.now().date())
        get_or_create_balance(worker, lt, monday.year)

        client = APIClient()
        client.force_authenticate(user=worker)
        response = client.post(
            "/api/leave-requests/",
            {"leave_type": lt.id, "start_date": monday.isoformat(), "end_date": monday.isoformat(), "reason": "Trip"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)

        balance = get_or_create_balance(worker, lt, monday.year)
        self.assertEqual(balance.used, 1)
        self.assertEqual(
            AuditLogEntry.objects.filter(action="Applied leave (auto-approved)").count(), 1
        )
        leave_request = LeaveRequest.objects.get(employee=worker)
        self.assertEqual(leave_request.status, LeaveStatus.APPROVED)

    def test_cancel_leave_balance_release_and_audit_entry_both_commit(self):
        dept = make_department()
        worker = make_employee(dept, email="txn-canceller@example.com")
        lt = make_leave_type(name="Txn Cancel Leave", code="TXNC", requires_approval=False, default_days_per_year=10)
        monday = _next_monday(timezone.now().date())
        get_or_create_balance(worker, lt, monday.year)

        client = APIClient()
        client.force_authenticate(user=worker)
        apply_response = client.post(
            "/api/leave-requests/",
            {"leave_type": lt.id, "start_date": monday.isoformat(), "end_date": monday.isoformat(), "reason": "Trip"},
            format="json",
        )
        request_id = apply_response.data["id"]
        audit_count_after_apply = AuditLogEntry.objects.count()

        response = client.post(f"/api/leave-requests/{request_id}/cancel/")
        self.assertEqual(response.status_code, 200)

        balance = get_or_create_balance(worker, lt, monday.year)
        self.assertEqual(balance.used, 0)
        self.assertEqual(AuditLogEntry.objects.count(), audit_count_after_apply + 1)
        self.assertEqual(AuditLogEntry.objects.order_by("-id").first().action, "Cancelled leave")
