from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminRole
from audit.services import log_audit
from .models import OrganizationSettings
from .serializers import OrganizationSettingsSerializer


class OrganizationSettingsView(APIView):
    """GET /api/settings/ — any signed-in user (matches the source app; consumed app-wide, not
    just by admins). PATCH /api/settings/ — ADMIN only, partial update with per-field validation
    matching src/app/api/settings/route.ts exactly."""

    def get_permissions(self):
        if self.request.method == "PATCH":
            return [IsAuthenticated(), IsAdminRole()]
        return [IsAuthenticated()]

    def get(self, request):
        settings = OrganizationSettings.load()
        return Response(OrganizationSettingsSerializer(settings).data)

    def patch(self, request):
        settings = OrganizationSettings.load()
        serializer = OrganizationSettingsSerializer(settings, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        log_audit(request.user, "Updated settings", "Settings", "Organization settings")
        return Response(serializer.data)
