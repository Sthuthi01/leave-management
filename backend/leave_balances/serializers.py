from rest_framework import serializers

from leave_types.serializers import LeaveTypeSerializer

from .models import LeaveBalance
from .services import accrued_to_date


class LeaveBalanceSerializer(serializers.ModelSerializer):
    """Read-only — balances are never written directly via the API, only derived from
    leave-type/employee data by leave_balances.services."""

    leave_type = LeaveTypeSerializer(read_only=True)
    accrued_to_date = serializers.SerializerMethodField()
    remaining = serializers.SerializerMethodField()

    class Meta:
        model = LeaveBalance
        fields = ["id", "leave_type", "year", "allocated", "used", "carried_forward", "accrued_to_date", "remaining"]

    def get_accrued_to_date(self, obj: LeaveBalance) -> int:
        return accrued_to_date(obj.employee, obj.leave_type, obj)

    def get_remaining(self, obj: LeaveBalance) -> int:
        return self.get_accrued_to_date(obj) - obj.used
