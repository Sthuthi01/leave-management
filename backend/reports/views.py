from datetime import date, timedelta

from django.utils import timezone
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminRole
from departments.models import Department
from leave_requests.models import LeaveRequest
from leave_types.models import LeaveType

from .serializers import (
    ReportDepartmentSerializer,
    ReportLeaveRequestSerializer,
    ReportLeaveTypeSerializer,
)


def _parse_date(raw: str) -> date:
    return date.fromisoformat(raw)


class ReportsView(APIView):
    """GET /api/reports/?from&to&department_id&leave_type_id — ADMIN only. Returns the current
    period's requests plus an equal-length prior period ending the day before `from` starts, both
    filtered identically — matches the source app's reports/route.ts exactly. No status filter
    is applied server-side (KPIs/charts are computed client-side from the raw request lists, same
    as the source)."""

    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        today = timezone.now().date()
        raw_from = request.query_params.get("from") or date(today.year, 1, 1).isoformat()
        raw_to = request.query_params.get("to") or today.isoformat()

        try:
            period_from = _parse_date(raw_from)
            period_to = _parse_date(raw_to)
        except ValueError as exc:
            raise ValidationError("from and to must be valid dates (YYYY-MM-DD).") from exc

        if period_from > period_to:
            raise ValidationError("from must be on or before to.")

        span_days = (period_to - period_from).days + 1
        prev_to = period_from - timedelta(days=1)
        prev_from = prev_to - timedelta(days=span_days - 1)

        department_id = request.query_params.get("department_id")
        leave_type_id = request.query_params.get("leave_type_id")

        base_qs = LeaveRequest.objects.select_related("employee", "employee__department", "leave_type", "approver")
        if department_id:
            base_qs = base_qs.filter(employee__department_id=department_id)
        if leave_type_id:
            base_qs = base_qs.filter(leave_type_id=leave_type_id)

        current_requests = base_qs.filter(start_date__lte=period_to, end_date__gte=period_from).order_by(
            "-start_date"
        )
        previous_requests = base_qs.filter(start_date__lte=prev_to, end_date__gte=prev_from)

        return Response(
            {
                "filters": {
                    "from": period_from.isoformat(),
                    "to": period_to.isoformat(),
                    "department_id": int(department_id) if department_id else None,
                    "leave_type_id": int(leave_type_id) if leave_type_id else None,
                },
                "departments": ReportDepartmentSerializer(Department.objects.all(), many=True).data,
                "leave_types": ReportLeaveTypeSerializer(
                    LeaveType.objects.filter(is_active=True), many=True
                ).data,
                "requests": ReportLeaveRequestSerializer(current_requests, many=True).data,
                "previous_requests": ReportLeaveRequestSerializer(previous_requests, many=True).data,
            }
        )
