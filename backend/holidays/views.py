from django.db import transaction
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminRole
from audit.services import log_audit
from .models import Holiday
from .serializers import HolidaySerializer

MAX_IMPORT_ROWS = 500


class HolidayListCreateView(generics.ListCreateAPIView):
    """GET: any authenticated user (matches the source app — the holiday calendar is read-open,
    not ADMIN-gated). POST: ADMIN only, mirrors the departments/leave_types pattern."""

    queryset = Holiday.objects.all()
    serializer_class = HolidaySerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), IsAdminRole()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        holiday = serializer.save()
        log_audit(self.request.user, "Added holiday", "Holiday", f"{holiday.name} ({holiday.date})")


class HolidayDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE: ADMIN only.

    No perform_destroy override, unlike DepartmentDetailView/LeaveTypeDetailView: the source app
    never links a holiday to anything by FK (leave-day calculations read the full holiday list by
    value at calculation time, not by reference — see the Phase 2B research notes), so delete is
    unconditionally safe today, matching source behavior exactly. If a future Leave Requests phase
    deliberately introduces a FK from leave data to specific Holiday rows with on_delete=PROTECT,
    this view's default destroy() will raise a raw 500 on ProtectedError and would need the same
    try/except -> ValidationError conversion added here at that time.
    """

    queryset = Holiday.objects.all()
    serializer_class = HolidaySerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def perform_update(self, serializer):
        # Logged unconditionally on every successful PATCH with the post-update name/date,
        # matching the source app's PATCH /api/holidays/[id] exactly.
        holiday = serializer.save()
        log_audit(self.request.user, "Edited holiday", "Holiday", f"{holiday.name} ({holiday.date})")

    def perform_destroy(self, instance):
        label = f"{instance.name} ({instance.date})"
        instance.delete()
        log_audit(self.request.user, "Removed holiday", "Holiday", label)


class HolidayImportView(APIView):
    """POST /api/holidays/import/ — bulk equivalent of HolidayListCreateView.perform_create.

    Mirrors accounts.views.EmployeeImportView: the request body is already-parsed JSON rows
    (client-side xlsx parsing, no raw file reaches the backend). Each row is re-validated here via
    the same HolidaySerializer a single create already uses, so duplicate-date detection
    (UniqueValidator on date) and name validation are reused as-is rather than duplicated. Each row
    is its own transaction.atomic() unit so one bad row doesn't roll back rows that already
    succeeded.
    """

    permission_classes = [IsAuthenticated, IsAdminRole]

    def post(self, request):
        rows = request.data.get("rows")
        if not isinstance(rows, list) or len(rows) == 0:
            return Response({"detail": "rows must be a non-empty array."}, status=status.HTTP_400_BAD_REQUEST)
        if len(rows) > MAX_IMPORT_ROWS:
            return Response(
                {"detail": f"A single import can contain at most {MAX_IMPORT_ROWS} rows."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        results = []
        created = 0
        for index, row in enumerate(rows):
            serializer = HolidaySerializer(data=row if isinstance(row, dict) else {})
            if not serializer.is_valid():
                message = "; ".join(f"{field}: {errors[0]}" for field, errors in serializer.errors.items())
                results.append({"index": index, "status": "skipped", "message": message or "Invalid row."})
                continue

            with transaction.atomic():
                holiday = serializer.save()
                log_audit(request.user, "Added holiday", "Holiday", f"{holiday.name} ({holiday.date})")
            created += 1
            results.append({"index": index, "status": "created"})

        return Response({"created": created, "skipped": len(results) - created, "results": results})
