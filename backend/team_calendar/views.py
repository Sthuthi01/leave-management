import calendar
from datetime import date

from django.utils import timezone
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Employee, Role
from holidays.models import Holiday
from holidays.serializers import HolidaySerializer
from leave_requests.models import LeaveRequest, LeaveStatus

from .serializers import TeamCalendarEntrySerializer


def _parse_month(raw: str | None) -> date:
    """Returns the first day of the requested month, defaulting to the current month on any
    missing/malformed input — matches the source app's parseMonth() leniency."""
    if raw:
        try:
            year, month = (int(part) for part in raw.split("-", 1))
            return date(year, month, 1)
        except (ValueError, TypeError):
            pass
    today = timezone.now().date()
    return date(today.year, today.month, 1)


class TeamCalendarView(APIView):
    """GET /api/team-calendar/?month=YYYY-MM&scope=team|company — any signed-in user.
    scope=company is silently downgraded to team unless the caller is ADMIN (matches the source
    app's team-calendar/route.ts exactly, rather than rejecting the request outright)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = request.user
        month_start = _parse_month(request.query_params.get("month"))
        _, last_day = calendar.monthrange(month_start.year, month_start.month)
        month_end = date(month_start.year, month_start.month, last_day)

        requested_scope = request.query_params.get("scope")
        scope = "company" if requested_scope == "company" and employee.role == Role.ADMIN else "team"

        if scope == "company":
            in_scope_ids = list(Employee.objects.values_list("id", flat=True))
            department_name = None
        else:
            in_scope_ids = list(
                Employee.objects.filter(department_id=employee.department_id).values_list("id", flat=True)
            )
            department_name = employee.department.name

        entries = (
            LeaveRequest.objects.filter(
                status=LeaveStatus.APPROVED,
                employee_id__in=in_scope_ids,
                start_date__lte=month_end,
                end_date__gte=month_start,
            )
            .select_related("employee", "leave_type")
            .order_by("start_date")
        )

        holidays = Holiday.objects.filter(date__gte=month_start, date__lte=month_end).order_by("date")

        return Response(
            {
                "month": month_start.strftime("%Y-%m"),
                "scope": scope,
                "department_name": department_name,
                "entries": TeamCalendarEntrySerializer(entries, many=True).data,
                "holidays": HolidaySerializer(holidays, many=True).data,
            }
        )
