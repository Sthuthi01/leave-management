from rest_framework.permissions import BasePermission

from .models import Role


class IsAdminRole(BasePermission):
    """Checks the app's own `role` field — deliberately distinct from Django's `is_staff`/
    `is_superuser` (those only gate the built-in Django admin site, unrelated to this app's HR
    Admin concept). Matches the source app's `user.role !== "ADMIN"` checks throughout
    src/app/api/employees/route.ts and src/app/api/departments/route.ts."""

    def has_permission(self, request, view) -> bool:
        return bool(request.user and request.user.is_authenticated and request.user.role == Role.ADMIN)
