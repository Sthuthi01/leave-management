from rest_framework import serializers

from accounts.models import Employee
from leave_requests.models import LeaveRequest
from leave_types.models import LeaveType


class TeamCalendarEmployeeSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = ["id", "name", "avatar_url"]


class TeamCalendarLeaveTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = LeaveType
        fields = ["id", "name", "color", "code"]


class TeamCalendarEntrySerializer(serializers.ModelSerializer):
    employee = TeamCalendarEmployeeSerializer()
    leave_type = TeamCalendarLeaveTypeSerializer()

    class Meta:
        model = LeaveRequest
        fields = ["employee", "leave_type", "start_date", "end_date"]
