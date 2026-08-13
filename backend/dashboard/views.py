"""Dashboard: a single read-only aggregation endpoint, not a new business-logic surface. Every
field below is composed from data/serializers that already exist and are already tested
(leave_balances, leave_requests, holidays) — this view adds no new validation, no new mutation,
and no new authorization decisions beyond "is the caller signed in."

Phase 1 scope was the employee/manager branch only (`_employee_payload`, unchanged below —
verify any edit here against the Phase 1 regression tests). Phase 5 adds the ADMIN/HR branch
(`_hr_payload`): company-wide stats, per-department/per-leave-type utilization, an
urgency-sorted pending-approvals list, and employees missing a manager — matching the source
app's dashboard/route.ts ADMIN branch.
"""
from datetime import timedelta

from django.db.models import Sum
from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Employee, EmployeeStatus, Role
from departments.models import Department
from holidays.models import Holiday
from holidays.serializers import HolidaySerializer
from leave_balances.models import LeaveBalance
from leave_balances.serializers import LeaveBalanceSerializer
from leave_balances.services import get_or_create_balance
from leave_requests.models import LeaveRequest, LeaveStatus
from leave_requests.serializers import LeaveRequestSerializer
from leave_types.models import LeaveType
from org_settings.models import OrganizationSettings

from .serializers import HrLeaveRequestSerializer

RECENT_REQUESTS_LIMIT = 5
UPCOMING_HOLIDAYS_LIMIT = 5

# HR branch only
HR_RECENT_REQUESTS_LIMIT = 8
ATTENTION_PENDING_APPROVALS_LIMIT = 6
# A pending request starting this soon is flagged regardless of how long it's been waiting —
# separate from OrganizationSettings.pending_approval_urgency_days, which governs "waited too
# long" instead. Hardcoded to match the source app's dashboard/route.ts exactly.
STARTING_SOON_DAYS = 2


class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = request.user
        today = timezone.now().date()
        if employee.role == Role.ADMIN:
            return Response(self._hr_payload(today))
        return Response(self._employee_payload(employee, today))

    def _employee_payload(self, employee, today):
        year = today.year

        balances = [
            get_or_create_balance(employee, leave_type, year)
            for leave_type in LeaveType.objects.filter(is_active=True)
        ]

        recent_requests = (
            LeaveRequest.objects.filter(employee=employee)
            .select_related("leave_type", "approver", "employee")
            .order_by("-applied_at")[:RECENT_REQUESTS_LIMIT]
        )

        upcoming_leave = (
            LeaveRequest.objects.filter(employee=employee, status=LeaveStatus.APPROVED, start_date__gte=today)
            .select_related("leave_type", "approver", "employee")
            .order_by("start_date")
        )

        upcoming_holidays = Holiday.objects.filter(date__gte=today).order_by("date")[:UPCOMING_HOLIDAYS_LIMIT]

        pending_approvals_count = LeaveRequest.objects.filter(approver=employee, status=LeaveStatus.PENDING).count()

        return {
            "kind": "EMPLOYEE",
            "balances": LeaveBalanceSerializer(balances, many=True).data,
            "recent_requests": LeaveRequestSerializer(recent_requests, many=True).data,
            "upcoming_leave": LeaveRequestSerializer(upcoming_leave, many=True).data,
            "upcoming_holidays": HolidaySerializer(upcoming_holidays, many=True).data,
            "pending_approvals_count": pending_approvals_count,
        }

    def _hr_payload(self, today):
        year = today.year
        week_end = today + timedelta(days=6)

        on_leave_today_qs = (
            LeaveRequest.objects.filter(status=LeaveStatus.APPROVED, start_date__lte=today, end_date__gte=today)
            .select_related("employee", "leave_type", "approver")
        )
        on_leave_this_week = LeaveRequest.objects.filter(
            status=LeaveStatus.APPROVED, start_date__lte=week_end, end_date__gte=today
        ).count()

        active_leave_types = list(LeaveType.objects.filter(is_active=True))
        balances_by_type = {
            row["leave_type_id"]: row
            for row in LeaveBalance.objects.filter(year=year, leave_type__in=active_leave_types)
            .values("leave_type_id")
            .annotate(allocated=Sum("allocated"), used=Sum("used"))
        }
        leave_utilization = [
            {
                "leave_type": {"id": lt.id, "name": lt.name, "color": lt.color, "code": lt.code},
                "allocated": balances_by_type.get(lt.id, {}).get("allocated") or 0,
                "used": balances_by_type.get(lt.id, {}).get("used") or 0,
            }
            for lt in active_leave_types
        ]

        department_stats = [
            {
                "department": {"id": dept.id, "name": dept.name},
                "employee_count": Employee.objects.filter(
                    department=dept, status=EmployeeStatus.ACTIVE
                ).count(),
                "on_leave_today": on_leave_today_qs.filter(employee__department=dept).count(),
            }
            for dept in Department.objects.all()
        ]

        urgency_days = OrganizationSettings.load().pending_approval_urgency_days
        now = timezone.now()
        attention_items = []
        for leave_request in (
            LeaveRequest.objects.filter(status=LeaveStatus.PENDING)
            .select_related("employee", "leave_type", "approver")
        ):
            days_pending = (now - leave_request.applied_at).days
            days_until_start = (leave_request.start_date - today).days
            if days_pending >= urgency_days or days_until_start <= STARTING_SOON_DAYS:
                attention_items.append(
                    {
                        "request": leave_request,
                        "days_pending": days_pending,
                        "days_until_start": days_until_start,
                    }
                )
        attention_items.sort(key=lambda item: (item["days_until_start"], -item["days_pending"]))
        attention_items = attention_items[:ATTENTION_PENDING_APPROVALS_LIMIT]
        attention_pending_approvals = [
            {
                "request": HrLeaveRequestSerializer(item["request"]).data,
                "days_pending": item["days_pending"],
                "days_until_start": item["days_until_start"],
            }
            for item in attention_items
        ]

        employees_without_manager = Employee.objects.filter(
            status=EmployeeStatus.ACTIVE, manager__isnull=True
        ).exclude(role=Role.ADMIN)

        recent_requests = (
            LeaveRequest.objects.select_related("employee", "leave_type", "approver")
            .order_by("-applied_at")[:HR_RECENT_REQUESTS_LIMIT]
        )

        upcoming_holidays = Holiday.objects.filter(date__gte=today).order_by("date")[:UPCOMING_HOLIDAYS_LIMIT]

        return {
            "kind": "HR",
            "on_leave_today": HrLeaveRequestSerializer(on_leave_today_qs, many=True).data,
            "on_leave_this_week": on_leave_this_week,
            "leave_utilization": leave_utilization,
            "department_stats": department_stats,
            "attention_pending_approvals": attention_pending_approvals,
            "employees_without_manager": [
                {"id": e.id, "name": e.name, "title": e.title} for e in employees_without_manager
            ],
            "total_employees": Employee.objects.filter(status=EmployeeStatus.ACTIVE).count(),
            "pending_approvals_count": LeaveRequest.objects.filter(status=LeaveStatus.PENDING).count(),
            "recent_requests": HrLeaveRequestSerializer(recent_requests, many=True).data,
            "upcoming_holidays": HolidaySerializer(upcoming_holidays, many=True).data,
        }
