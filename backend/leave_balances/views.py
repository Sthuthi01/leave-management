from django.utils import timezone
from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from leave_types.models import LeaveType

from .serializers import LeaveBalanceSerializer
from .services import get_or_create_balance


class MyLeaveBalancesView(generics.ListAPIView):
    """GET /api/leave-balances/ — the caller's own balances for the current year, one row per
    active leave type, lazily created on first view (matches the source app's lazy-creation
    behavior — balances are never pre-created on employee/leave-type creation)."""

    serializer_class = LeaveBalanceSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        year = timezone.now().year
        employee = self.request.user
        return [
            get_or_create_balance(employee, leave_type, year)
            for leave_type in LeaveType.objects.filter(is_active=True)
        ]
