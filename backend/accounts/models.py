from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models
from django.utils import timezone


class Role(models.TextChoices):
    EMPLOYEE = "EMPLOYEE", "Employee"
    MANAGER = "MANAGER", "Manager"
    ADMIN = "ADMIN", "HR Admin"


class EmployeeStatus(models.TextChoices):
    ACTIVE = "ACTIVE", "Active"
    INACTIVE = "INACTIVE", "Inactive"


class TokenPurpose(models.TextChoices):
    INVITE = "INVITE", "Invite"
    RESET = "RESET", "Reset"


class EmployeeManager(BaseUserManager):
    """Employee IS the login table (no separate Django User) — mirrors the source schema, where
    employees.password_hash/session_version live directly on the same row, not a joined profile."""

    use_in_migrations = True

    def _create(self, email, name, password, **extra):
        if not email:
            raise ValueError("Employees must have an email address.")
        email = self.normalize_email(email)
        employee = self.model(email=email, name=name, **extra)
        if password:
            employee.set_password(password)
        else:
            employee.set_unusable_password()
        employee.save(using=self._db)
        return employee

    def create_user(self, email, name, password=None, **extra):
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create(email, name, password, **extra)

    def create_superuser(self, email, name, password=None, **extra):
        """For `manage.py createsuperuser` / Django admin access only — unrelated to the app's own
        `role` field. A Django superuser is not automatically an HR Admin in the app's sense."""
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self._create(email, name, password, **extra)


class Employee(AbstractBaseUser, PermissionsMixin):
    email = models.EmailField(unique=True)
    name = models.CharField(max_length=255)
    avatar_url = models.URLField(blank=True, null=True)
    role = models.CharField(max_length=16, choices=Role.choices, default=Role.EMPLOYEE)
    title = models.CharField(max_length=255)
    department = models.ForeignKey("departments.Department", on_delete=models.PROTECT, related_name="employees")
    manager = models.ForeignKey("self", null=True, blank=True, on_delete=models.SET_NULL, related_name="direct_reports")
    joined_at = models.DateField(default=timezone.now)
    status = models.CharField(max_length=16, choices=EmployeeStatus.choices, default=EmployeeStatus.ACTIVE)

    # Bumped every time the password changes (see set_password_and_bump_session in emails.py's
    # sibling module accounts/views.py) — a session created before a password change stops being
    # valid the moment SessionVersionMiddleware notices the mismatch. Mirrors src/lib/db/schema.ts's
    # sessionVersion column and its exact purpose.
    session_version = models.PositiveIntegerField(default=0)

    # Which onboarding checklist (if any) this employee is currently working through — SET_NULL
    # so deleting a checklist's row (never allowed while assigned, see
    # onboarding.services.delete_checklist) or a future admin action never cascades into deleting
    # the employee. Mirrors the source app's employees.onboarding_checklist_id column.
    onboarding_checklist = models.ForeignKey(
        "onboarding.Checklist", null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_employees"
    )

    is_staff = models.BooleanField(default=False)  # Django-admin access only, unrelated to `role`

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["name"]

    objects = EmployeeManager()

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return f"{self.name} <{self.email}>"

    @property
    def is_active(self) -> bool:
        """Django's auth machinery (ModelBackend, session auth) checks this — tie it directly to
        the app's own `status` field rather than maintaining a separate boolean that could drift."""
        return self.status == EmployeeStatus.ACTIVE

    @property
    def has_password(self) -> bool:
        return self.has_usable_password()


class PasswordSetupToken(models.Model):
    """Mirrors src/lib/db/invitation-repo.ts's password_setup_tokens table exactly: only the
    token's SHA-256 hash is ever stored, single-use, purpose-scoped (one table for both invite and
    reset), and issuing a new token for the same employee+purpose invalidates prior unused ones."""

    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="password_setup_tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    purpose = models.CharField(max_length=16, choices=TokenPurpose.choices)
    expires_at = models.DateTimeField()
    used_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=["employee", "purpose", "used_at"])]
