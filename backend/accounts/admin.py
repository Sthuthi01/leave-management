from django.contrib import admin
from django.contrib.auth.admin import UserAdmin

from .models import Employee, PasswordSetupToken


class EmployeeAdmin(UserAdmin):
    model = Employee
    list_display = ["email", "name", "role", "department", "status", "is_staff"]
    # UserAdmin's default list_filter includes "is_active", which on this model is a computed
    # property (derived from `status`, see models.py) rather than a real DB field — Django admin
    # can only filter on real fields, so it must be overridden here instead of inherited.
    list_filter = ["role", "status", "is_staff", "is_superuser"]
    ordering = ["name"]
    # Django-admin convenience only (dev/debugging) — not the app's own HR Admin UI, which is a
    # Phase 2+ item (the React EmployeeListPage covers the Phase 1 basics).
    fieldsets = (
        (None, {"fields": ("email", "password")}),
        ("Profile", {"fields": ("name", "avatar_url", "role", "title", "department", "manager", "joined_at", "status")}),
        ("Permissions", {"fields": ("is_staff", "is_superuser", "groups", "user_permissions")}),
    )
    add_fieldsets = ((None, {"classes": ("wide",), "fields": ("email", "name", "department", "title", "password1", "password2")}),)
    search_fields = ["email", "name"]


admin.site.register(Employee, EmployeeAdmin)
admin.site.register(PasswordSetupToken)
