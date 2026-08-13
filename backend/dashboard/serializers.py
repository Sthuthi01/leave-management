from rest_framework import serializers

from accounts.models import Employee
from leave_requests.models import LeaveRequest
from leave_types.models import LeaveType


class HrEmployeeRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = ["id", "name"]


class HrLeaveTypeRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = ["id", "name", "color", "code"]


class HrLeaveRequestSerializer(serializers.ModelSerializer):
    """Distinct from leave_requests.serializers.LeaveRequestSerializer (which stays untouched for
    backward compatibility with Apply/My-Leaves/Approvals): the HR dashboard needs a hydrated
    `approver` (for "Awaiting {name}" text) that those existing consumers don't."""

    employee = HrEmployeeRefSerializer()
    leave_type = HrLeaveTypeRefSerializer()
    approver = HrEmployeeRefSerializer()

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
            "status",
            "approver",
            "applied_at",
        ]
