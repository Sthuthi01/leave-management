from django.db.models import ProtectedError
from rest_framework import generics
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated

from accounts.permissions import IsAdminRole
from audit.services import log_audit
from .models import Department
from .serializers import DepartmentSerializer


class DepartmentListCreateView(generics.ListCreateAPIView):
    """GET: any authenticated user (matches the source app's GET /api/departments, which is not
    ADMIN-gated). POST: ADMIN only (matches the source app's POST /api/departments) — added in
    Phase 1.5 so an HR Admin isn't stuck with only the single bootstrap-created department."""

    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), IsAdminRole()]
        return [IsAuthenticated()]

    def perform_create(self, serializer):
        department = serializer.save()
        log_audit(self.request.user, "Added department", "Department", department.name)


class DepartmentDetailView(generics.RetrieveUpdateDestroyAPIView):
    """PATCH/DELETE: ADMIN only, matching the source app's PATCH/DELETE /api/departments/[id]."""

    queryset = Department.objects.all()
    serializer_class = DepartmentSerializer
    permission_classes = [IsAuthenticated, IsAdminRole]

    def perform_update(self, serializer):
        # Captured before save() so the audit label can show "before → after", exactly like the
        # source app's PATCH /api/departments/[id] — logged unconditionally on every successful
        # PATCH, even a no-op rename, matching that route's behavior (it never checks whether the
        # name actually changed).
        previous_name = serializer.instance.name
        department = serializer.save()
        log_audit(self.request.user, "Edited department", "Department", f"{previous_name} → {department.name}")

    def perform_destroy(self, instance):
        # Department.department FK uses on_delete=PROTECT (see accounts/models.py) — deleting a
        # department that still has employees would otherwise raise a raw ProtectedError and leak
        # a 500. Converted into a clean 400 with a message the frontend can show directly, the
        # same shape as any other validation error (see api-client.ts's error extraction).
        name = instance.name
        try:
            instance.delete()
        except ProtectedError as exc:
            raise ValidationError("This department still has employees assigned to it and can't be deleted.") from exc
        log_audit(self.request.user, "Removed department", "Department", name)
