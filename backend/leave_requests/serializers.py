from rest_framework import serializers

from accounts.models import Employee
from departments.serializers import DepartmentSerializer
from leave_types.models import LeaveType
from leave_types.serializers import LeaveTypeSerializer

from .models import LeaveRequest


class LeaveRequestEmployeeSerializer(serializers.ModelSerializer):
    """Minimal employee shape embedded in a leave request — enough for an approver to identify
    whose request they're looking at, without exposing the full EmployeeSerializer. `department`
    is included (read-only, nested) so the Approvals page can offer a department filter, matching
    the source app's approvals page filter set — this is the only reason it's here; ?scope=mine
    responses ignore it."""

    department = DepartmentSerializer(read_only=True)

    class Meta:
        model = Employee
        fields = ["id", "name", "email", "department"]


class LeaveRequestSerializer(serializers.ModelSerializer):
    """Read shape. Includes `employee` so the ?scope=approvals list (Phase 2D) can show a
    manager whose request each row is — harmless for the ?scope=mine case, where it's always
    just the caller themself."""

    leave_type = LeaveTypeSerializer(read_only=True)
    employee = LeaveRequestEmployeeSerializer(read_only=True)

    class Meta:
        model = LeaveRequest
        fields = [
            "id",
            "reference_number",
            "employee",
            "leave_type",
            "start_date",
            "end_date",
            "days",
            "reason",
            "status",
            "approver",
            "approver_comment",
            "applied_at",
            "decided_at",
        ]


class LeaveRequestCreateSerializer(serializers.Serializer):
    """Write shape — deliberately has no `employee` field. The request is always created for
    the authenticated caller (services.apply_leave_request), never on anyone else's behalf."""

    leave_type = serializers.PrimaryKeyRelatedField(queryset=LeaveType.objects.filter(is_active=True))
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    reason = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")


class LeaveRequestPreviewSerializer(serializers.Serializer):
    """Same leave_type/date fields as LeaveRequestCreateSerializer (same active-only queryset, so
    an inactive leave type is rejected identically at this layer for both endpoints) — no
    `reason`, since the preview never persists anything."""

    leave_type = serializers.PrimaryKeyRelatedField(queryset=LeaveType.objects.filter(is_active=True))
    start_date = serializers.DateField()
    end_date = serializers.DateField()
