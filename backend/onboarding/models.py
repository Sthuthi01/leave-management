from django.db import models

from accounts.models import Role


class ResourceCategory(models.TextChoices):
    GUIDE = "GUIDE", "Guide"
    POLICY = "POLICY", "Policy"
    TRAINING = "TRAINING", "Training"


class ResourceStatus(models.TextChoices):
    DRAFT = "DRAFT", "Draft"
    PUBLISHED = "PUBLISHED", "Published"


class AudienceScope(models.TextChoices):
    ALL = "ALL", "All employees"
    DEPARTMENT = "DEPARTMENT", "Department"
    ROLE = "ROLE", "Role"


def resource_document_upload_path(instance: "ResourceDocument", filename: str) -> str:
    # Keyed by resource id (not the document's own, not-yet-assigned pk) so a re-upload's old
    # path is easy to reconstruct — services.set_resource_document deletes the previous file
    # from storage explicitly before writing the new one; nothing here relies on the filesystem
    # naturally overwriting.
    return f"onboarding_documents/{instance.resource_id}/{filename}"


class Resource(models.Model):
    """Mirrors the source app's onboarding_resources table (src/lib/db/schema.ts) — one shared
    content library for guides, policies, and training material, distinguished by `category`.
    Visibility rules (draft/effective-date/audience) live in onboarding/services.py, ported
    field-for-field from src/lib/onboarding.ts — this model only stores the data those rules
    read."""

    title = models.CharField(max_length=255)
    category = models.CharField(max_length=16, choices=ResourceCategory.choices)
    description = models.TextField()
    # Rich-text body. Optional — a resource's primary content may instead be an uploaded document
    # (see ResourceDocument) or an external link.
    content = models.TextField(null=True, blank=True)
    url = models.URLField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=ResourceStatus.choices, default=ResourceStatus.DRAFT)
    is_required = models.BooleanField(default=False)
    # Who this resource applies to: everyone, one department, or one role. Only the matching
    # audience_department/audience_role field is read, based on audience_scope — see
    # services.resource_audience_matches().
    audience_scope = models.CharField(max_length=16, choices=AudienceScope.choices, default=AudienceScope.ALL)
    audience_department = models.ForeignKey(
        "departments.Department", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    audience_role = models.CharField(max_length=16, choices=Role.choices, null=True, blank=True)
    # When the resource becomes visible to its audience; null means immediately.
    effective_date = models.DateField(null=True, blank=True)
    version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]

    def __str__(self) -> str:
        return self.title


class ResourceDocument(models.Model):
    """The primary uploaded document for a resource (e.g. a policy PDF) — one per resource,
    replaced wholesale on re-upload (see services.set_resource_document). File bytes live on disk
    via Django's FileField/MEDIA_ROOT, not base64-in-Postgres — a deliberate improvement over the
    source app (which had no object storage available), approved explicitly for this rewrite.
    Downloads are never served directly by nginx/media; they go through an authenticated Django
    view that re-runs the same visibility check as the resource itself (see views.py)."""

    resource = models.OneToOneField(Resource, on_delete=models.CASCADE, related_name="document")
    file = models.FileField(upload_to=resource_document_upload_path)
    file_name = models.CharField(max_length=255)
    mime_type = models.CharField(max_length=255)
    file_size = models.PositiveIntegerField()
    uploaded_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return f"{self.file_name} ({self.resource.title})"


class ResourceAttachment(models.Model):
    """A lightweight named-link attachment (as opposed to ResourceDocument's uploaded file) —
    mirrors the source app's onboarding_resource_attachments table exactly."""

    resource = models.ForeignKey(Resource, on_delete=models.CASCADE, related_name="attachments")
    name = models.CharField(max_length=255)
    url = models.URLField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self) -> str:
        return self.name


class ResourceVersion(models.Model):
    """A snapshot of a resource's content taken every time it's meaningfully (content-field)
    edited — see services.CONTENT_FIELDS and update_resource(). The resource row itself always
    holds the current version; this table is history only."""

    resource = models.ForeignKey(Resource, on_delete=models.CASCADE, related_name="versions")
    version = models.PositiveIntegerField()
    title = models.CharField(max_length=255)
    category = models.CharField(max_length=16, choices=ResourceCategory.choices)
    description = models.TextField()
    content = models.TextField(null=True, blank=True)
    url = models.URLField(null=True, blank=True)
    edited_at = models.DateTimeField(auto_now_add=True)
    editor = models.ForeignKey("accounts.Employee", null=True, on_delete=models.SET_NULL, related_name="+")
    editor_name = models.CharField(max_length=255)

    class Meta:
        ordering = ["-version"]

    def __str__(self) -> str:
        return f"{self.resource.title} v{self.version}"


class Checklist(models.Model):
    name = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Task(models.Model):
    checklist = models.ForeignKey(Checklist, on_delete=models.CASCADE, related_name="tasks")
    title = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    # A task may optionally point employees at a resource for context — deleting a resource still
    # in use by a task is blocked (services.resource_in_use_by_tasks), so this FK is never
    # silently orphaned in normal operation; PROTECT makes that guarantee explicit at the DB
    # layer too, matching rule 6.
    resource = models.ForeignKey(Resource, null=True, blank=True, on_delete=models.PROTECT, related_name="tasks")
    sort_order = models.PositiveIntegerField(default=0)

    class Meta:
        ordering = ["sort_order"]

    def __str__(self) -> str:
        return self.title


class TaskCompletion(models.Model):
    """A row's presence means the task is complete for that employee — no boolean to keep in
    sync, just insert/delete. Mirrors the source app's employee_task_completions table exactly,
    including the composite-key semantics (one completion per employee+task)."""

    employee = models.ForeignKey("accounts.Employee", on_delete=models.CASCADE, related_name="task_completions")
    task = models.ForeignKey(Task, on_delete=models.CASCADE, related_name="completions")
    completed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["employee", "task"], name="onboarding_unique_employee_task_completion")
        ]

    def __str__(self) -> str:
        return f"{self.employee_id} completed {self.task_id}"
