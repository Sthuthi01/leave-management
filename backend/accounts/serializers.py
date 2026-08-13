from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from departments.models import Department
from departments.serializers import DepartmentSerializer

from .models import Employee, EmployeeStatus, Role


class EmployeeSerializer(serializers.ModelSerializer):
    """Read shape — deliberately never includes `password`. has_password mirrors the source app's
    EmployeeRecord.hasPassword (never the hash itself, just whether one has been set)."""

    department = DepartmentSerializer(read_only=True)
    manager_name = serializers.CharField(source="manager.name", read_only=True, default=None)
    has_password = serializers.BooleanField(read_only=True)
    onboarding_checklist_name = serializers.CharField(source="onboarding_checklist.name", read_only=True, default=None)

    class Meta:
        model = Employee
        fields = [
            "id",
            "name",
            "email",
            "avatar_url",
            "role",
            "title",
            "department",
            "manager",
            "manager_name",
            "joined_at",
            "status",
            "has_password",
            "onboarding_checklist",
            "onboarding_checklist_name",
        ]


class EmployeeCreateSerializer(serializers.ModelSerializer):
    """Write shape — POST /api/employees/. role defaults to EMPLOYEE if omitted, same as the
    source app's POST /api/employees route."""

    department = serializers.PrimaryKeyRelatedField(queryset=Department.objects.all())

    class Meta:
        model = Employee
        fields = ["name", "email", "title", "department", "manager", "role", "onboarding_checklist"]
        extra_kwargs = {
            "role": {"required": False, "default": Role.EMPLOYEE},
            "manager": {"required": False},
            "onboarding_checklist": {"required": False},
        }

    def validate_email(self, value: str) -> str:
        value = value.strip().lower()
        if Employee.objects.filter(email=value).exists():
            raise serializers.ValidationError("An employee with this email already exists.")
        return value


class EmployeeUpdateSerializer(serializers.ModelSerializer):
    """Write shape — PATCH /api/employees/<id>/. Admin-only (gated at the view level, matching
    EmployeeListCreateView). email and joined_at are deliberately not editable here — email is
    the login identity and joined_at is a historical fact, neither fits "edit employee details"
    in the Phase 2A scope; password is never touched by this endpoint (only the invite/reset flow
    ever sets it)."""

    department = serializers.PrimaryKeyRelatedField(queryset=Department.objects.all(), required=False)

    class Meta:
        model = Employee
        fields = ["name", "title", "department", "manager", "role", "status", "onboarding_checklist"]
        extra_kwargs = {
            field: {"required": False}
            for field in ["name", "title", "manager", "role", "status", "onboarding_checklist"]
        }

    def validate_manager(self, value):
        if self.instance and value is not None and value.pk == self.instance.pk:
            raise serializers.ValidationError("An employee cannot be their own manager.")
        return value

    def validate(self, attrs):
        # "Ensure employees cannot modify their own restricted fields" (Phase 2A scope) — the two
        # fields that are dangerous to self-modify: deactivating your own account (self-lockout)
        # and changing your own role away from ADMIN (self-demotion, potentially leaving the
        # system with no admin left). Gated on whoever is actually making the request, not just
        # "is this employee an admin" — matches the source app's self-deactivation guard, extended
        # to cover self-demotion the same way since it's the same class of risk.
        request = self.context.get("request")
        if request is not None and self.instance and self.instance.pk == request.user.pk:
            if attrs.get("status") == EmployeeStatus.INACTIVE:
                raise serializers.ValidationError({"status": "You cannot deactivate your own account."})
            if "role" in attrs and attrs["role"] != Role.ADMIN:
                raise serializers.ValidationError({"role": "You cannot change your own role."})

        # Restored regression: deactivating a manager while employees still actively report to
        # them would silently leave those employees pointed at a reporting line that can no
        # longer sign in or act as an approver. Matches the source app's exact guard and message.
        if (
            self.instance
            and attrs.get("status") == EmployeeStatus.INACTIVE
            and Employee.objects.filter(manager=self.instance, status=EmployeeStatus.ACTIVE).exists()
        ):
            raise serializers.ValidationError({"status": "Reassign this person's direct reports before deactivating them."})
        return attrs


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(trim_whitespace=False)


class SetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField()
    password = serializers.CharField(trim_whitespace=False)

    def validate_password(self, value: str) -> str:
        # Uses Django's own validators (min length, not-all-numeric, not-too-common — see
        # AUTH_PASSWORD_VALIDATORS in settings.py) rather than replicating the source app's exact
        # zod regex — a deliberate simplification for this fresh-start rewrite, not a bug.
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages[0]) from exc
        return value


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False)

    def validate_new_password(self, value: str) -> str:
        try:
            validate_password(value)
        except DjangoValidationError as exc:
            raise serializers.ValidationError(exc.messages[0]) from exc
        return value


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField()
