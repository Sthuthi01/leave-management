from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import LeaveRequest
from .serializers import LeaveRequestCreateSerializer, LeaveRequestPreviewSerializer, LeaveRequestSerializer
from .services import (
    ApplyLeaveError,
    CancelError,
    DecideError,
    apply_leave_request,
    cancel_leave_request,
    decide_leave_request,
    preview_leave_request,
)


class LeaveRequestListCreateView(generics.ListCreateAPIView):
    """GET: ?scope=mine (default) — the caller's own requests. ?scope=approvals — requests where
    the caller is the assigned approver (Phase 2D). Optional ?status= filter applies to either
    scope. POST: creates for the caller only — see LeaveRequestCreateSerializer, which has no
    employee field at all."""

    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        scope = self.request.query_params.get("scope", "mine")
        if scope == "approvals":
            qs = LeaveRequest.objects.filter(approver=self.request.user)
        else:
            qs = LeaveRequest.objects.filter(employee=self.request.user)
        qs = qs.select_related("leave_type", "approver", "employee")
        status_param = self.request.query_params.get("status")
        if status_param:
            qs = qs.filter(status=status_param)
        return qs

    def get_serializer_class(self):
        return LeaveRequestCreateSerializer if self.request.method == "POST" else LeaveRequestSerializer

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            leave_request = apply_leave_request(
                employee=request.user,
                leave_type=serializer.validated_data["leave_type"],
                start_date=serializer.validated_data["start_date"],
                end_date=serializer.validated_data["end_date"],
                reason=serializer.validated_data.get("reason", ""),
            )
        except ApplyLeaveError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.http_status)
        return Response(LeaveRequestSerializer(leave_request).data, status=status.HTTP_201_CREATED)


class PreviewLeaveRequestView(APIView):
    """POST /api/leave-requests/preview/ — read-only day-count + balance preview for the Apply
    Leave form. Runs the request through services.preview_leave_request, which shares its
    date/leave-type/working-day validation with apply_leave_request so the two can never
    disagree. Never creates a LeaveRequest, mutates a LeaveBalance, or writes an audit entry."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = LeaveRequestPreviewSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            result = preview_leave_request(
                employee=request.user,
                leave_type=serializer.validated_data["leave_type"],
                start_date=serializer.validated_data["start_date"],
                end_date=serializer.validated_data["end_date"],
            )
        except ApplyLeaveError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.http_status)
        return Response(result)


class LeaveRequestDetailView(generics.RetrieveAPIView):
    """GET only — no PATCH (the source app has no edit endpoint; cancel + recreate is the only
    way to change a request). Scoped to the caller's own requests; another employee's request id
    404s rather than 403ing, to avoid confirming its existence."""

    serializer_class = LeaveRequestSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        return LeaveRequest.objects.filter(employee=self.request.user).select_related("leave_type", "approver")


class CancelLeaveRequestView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            leave_request = cancel_leave_request(employee=request.user, leave_request_id=pk)
        except CancelError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.http_status)
        return Response(LeaveRequestSerializer(leave_request).data)


class DecideLeaveRequestView(APIView):
    """POST /api/leave-requests/<id>/decide/ — approve or reject. Real authorization (is the
    caller the assigned approver, is the request still PENDING, does approving fit the balance)
    happens in services.decide_leave_request, not here — IsAuthenticated is only the coarse
    gate, matching CancelLeaveRequestView's existing pattern."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        try:
            leave_request = decide_leave_request(
                approver=request.user,
                leave_request_id=pk,
                decision=request.data.get("decision"),
                comment=request.data.get("comment"),
            )
        except DecideError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.http_status)
        return Response(LeaveRequestSerializer(leave_request).data)
