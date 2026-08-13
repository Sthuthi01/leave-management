from django.db.models import ProtectedError
from rest_framework import generics
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated

from accounts.permissions import IsAdminRole
from audit.services import log_audit
from .models import LeaveType
from .serializers import LeaveTypeSerializer


class LeaveTypeListCreateView(generics.ListCreateAPIView):
    """GET: any authenticated user. POST: ADMIN only — mirrors the departments app pattern."""

    queryset = LeaveType.objects.all()
    serializer_class = LeaveTypeSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), IsAdminRole()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        leave_type = serializer.save()
        log_audit(self.request.user, "Added leave type", "LeaveType", leave_type.name)


class LeaveTypeDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE: ADMIN only.

    Phase 2A ships without LeaveRequest/LeaveBalance models, so no FK can yet reference a
    LeaveType and delete is always safe today. Phase 2B must add those models with
    on_delete=PROTECT on their leave_type FK, at which point this view's existing
    perform_destroy() (mirroring DepartmentDetailView) will start converting the resulting
    ProtectedError into a clean 400 automatically — no changes needed here.
    """

    queryset = LeaveType.objects.all()
    serializer_class = LeaveTypeSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def perform_update(self, serializer):
        # Logged unconditionally on every successful PATCH (even a no-op edit) with the
        # post-update name — matches the source app's PATCH /api/leave-types/[id] exactly, which
        # logs patch.name (falls back to the existing name when the payload omits it) rather than
        # a before/after pair.
        leave_type = serializer.save()
        log_audit(self.request.user, "Edited leave type", "LeaveType", leave_type.name)

    def perform_destroy(self, instance):
        name = instance.name
        try:
            instance.delete()
        except ProtectedError as exc:
            raise ValidationError(
                "This leave type is still referenced by existing leave data and can't be deleted."
            ) from exc
        log_audit(self.request.user, "Removed leave type", "LeaveType", name)
