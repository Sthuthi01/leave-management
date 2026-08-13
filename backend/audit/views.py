from rest_framework import generics
from rest_framework.permissions import IsAuthenticated

from accounts.permissions import IsAdminRole
from org_settings.models import OrganizationSettings
from .models import AuditLogEntry
from .serializers import AuditLogEntrySerializer


class AuditLogListView(generics.ListAPIView):
    """GET /api/audit-log/ — ADMIN only, most recent audit_log_display_limit entries (Phase 4's
    OrganizationSettings), newest first."""

    serializer_class = AuditLogEntrySerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get_queryset(self):
        limit = OrganizationSettings.load().audit_log_display_limit
        return AuditLogEntry.objects.select_related("actor").order_by("-timestamp")[:limit]
