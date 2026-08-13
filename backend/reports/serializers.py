from rest_framework import serializers

from accounts.models import Employee
from departments.models import Department
from leave_requests.models import LeaveRequest
from leave_types.models import LeaveType


class ReportDepartmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "name"]


class ReportLeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = ["id", "name", "color", "code"]


class ReportEmployeeSerializer(serializers.ModelSerializer):
    department = ReportDepartmentSerializer()

    class Meta:
        model = Employee
        fields = ["id", "name", "department"]


class ReportApproverSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = ["id", "name"]


class ReportLeaveRequestSerializer(serializers.ModelSerializer):
    employee = ReportEmployeeSerializer()
    leave_type = ReportLeaveTypeSerializer()
    approver = ReportApproverSerializer()

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
