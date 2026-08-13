from rest_framework import serializers

from accounts.models import Employee
from departments.models import Department

from .models import AudienceScope, Checklist, Resource, ResourceAttachment, ResourceDocument, ResourceVersion, Task


class ResourceAttachmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = ResourceAttachment
        fields = ["id", "name", "url"]
        read_only_fields = ["id"]


class ResourceDocumentSerializer(serializers.ModelSerializer):
    """Metadata only — the file body is never included here, only served through
    ResourceDocumentDownloadView, which re-checks visibility before streaming any bytes."""

    class Meta:
        model = ResourceDocument
        fields = ["id", "file_name", "mime_type", "file_size", "uploaded_at"]
        read_only_fields = fields


class ResourceVersionSerializer(serializers.ModelSerializer):
    edited_by_name = serializers.CharField(source="editor_name", read_only=True)

    class Meta:
        model = ResourceVersion
        fields = ["version", "title", "category", "description", "content", "url", "edited_at", "edited_by_name"]


class ResourceSerializer(serializers.ModelSerializer):
    """Read shape for GET (list + detail), for both the admin (unfiltered) and employee
    (visibility-filtered) branches — the filtering itself happens in services.list_resources_for,
    not here."""

    attachments = ResourceAttachmentSerializer(many=True, read_only=True)
    document = serializers.SerializerMethodField()

    class Meta:
        model = Resource
        fields = [
            "id",
            "title",
            "category",
            "description",
            "content",
            "url",
            "document",
            "status",
            "is_required",
            "audience_scope",
            "audience_department",
            "audience_role",
            "effective_date",
            "version",
            "attachments",
            "created_at",
        ]

    def get_document(self, resource: Resource):
        document = getattr(resource, "document", None)
        return ResourceDocumentSerializer(document).data if document else None


class ResourceWriteSerializer(serializers.ModelSerializer):
    """Write shape for POST/PATCH — attachments are handled as a separate write_only list
    (services.create_resource/update_resource apply them), matching the source's
    parseAttachments + wholesale-replace-on-edit behavior."""

    attachments = serializers.ListField(child=serializers.DictField(), required=False, write_only=True)

    class Meta:
        model = Resource
        fields = [
            "title",
            "category",
            "description",
            "content",
            "url",
            "status",
            "is_required",
            "audience_scope",
            "audience_department",
            "audience_role",
            "effective_date",
            "attachments",
        ]

    def validate_attachments(self, value):
        cleaned = []
        for item in value:
            name = (item.get("name") or "").strip()
            url = (item.get("url") or "").strip()
            if not name and not url:
                continue  # a blank row left over from a dynamic add/remove form — skip, don't error
            if not name or not url:
                raise serializers.ValidationError("Each attachment needs both a name and a URL.")
            cleaned.append({"name": name, "url": url})
        return cleaned

    def validate(self, attrs):
        current_scope = self.instance.audience_scope if self.instance else AudienceScope.ALL
        current_department = self.instance.audience_department if self.instance else None
        current_role = self.instance.audience_role if self.instance else None

        scope = attrs.get("audience_scope", current_scope)
        department = attrs.get("audience_department", current_department)
        role = attrs.get("audience_role", current_role)

        if scope == AudienceScope.DEPARTMENT and not department:
            raise serializers.ValidationError({"audience_department": "Select a department for this audience."})
        if scope == AudienceScope.ROLE and not role:
            raise serializers.ValidationError({"audience_role": "Select a role for this audience."})

        # Only the field matching the chosen scope is meaningful — clear the other one so a
        # scope switch never leaves a stale department/role behind (services.resource_audience_matches
        # only ever reads the field for the CURRENT scope, but a stale value is still confusing to
        # display and edit later).
        if "audience_scope" in attrs or self.instance is None:
            if scope != AudienceScope.DEPARTMENT:
                attrs["audience_department"] = None
            if scope != AudienceScope.ROLE:
                attrs["audience_role"] = None
        return attrs


class TaskSerializer(serializers.ModelSerializer):
    resource = ResourceSerializer(read_only=True)

    class Meta:
        model = Task
        fields = ["id", "checklist", "title", "description", "resource", "sort_order"]


class TaskWithCompletionSerializer(serializers.ModelSerializer):
    """My Checklist page shape — a task plus whether the current employee has completed it.
    `completed`/`completed_at` are injected by the view, not derived from the model directly,
    since completion is per-employee, not a column on Task itself."""

    resource = ResourceSerializer(read_only=True)
    completed = serializers.SerializerMethodField()
    completed_at = serializers.SerializerMethodField()

    class Meta:
        model = Task
        fields = ["id", "title", "description", "resource", "sort_order", "completed", "completed_at"]

    def get_completed(self, task: Task) -> bool:
        return task.id in self.context.get("completed_at_by_task", {})

    def get_completed_at(self, task: Task):
        value = self.context.get("completed_at_by_task", {}).get(task.id)
        return value.isoformat() if value else None


class TaskWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Task
        fields = ["title", "description", "resource"]
        extra_kwargs = {"description": {"required": False, "allow_null": True}, "resource": {"required": False, "allow_null": True}}


class ChecklistSerializer(serializers.ModelSerializer):
    class Meta:
        model = Checklist
        fields = ["id", "name", "description", "is_active"]


class ChecklistDetailSerializer(serializers.ModelSerializer):
    tasks = serializers.SerializerMethodField()
    assigned_employee_count = serializers.SerializerMethodField()

    class Meta:
        model = Checklist
        fields = ["id", "name", "description", "is_active", "tasks", "assigned_employee_count"]

    def get_tasks(self, checklist: Checklist):
        return TaskSerializer(checklist.tasks.select_related("resource").order_by("sort_order"), many=True).data

    def get_assigned_employee_count(self, checklist: Checklist) -> int:
        return Employee.objects.filter(onboarding_checklist=checklist).count()


class ChecklistWriteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Checklist
        fields = ["name", "description", "is_active"]
        extra_kwargs = {"description": {"required": False, "allow_null": True}, "is_active": {"required": False}}


class MyChecklistSerializer(serializers.Serializer):
    """Employee-facing GET /api/onboarding/my-checklist/ shape, built from the dict
    services.get_my_checklist returns — not a ModelSerializer, since it combines a Checklist with
    a per-employee completion map that isn't a field on any single model."""

    checklist = ChecklistSerializer()
    tasks = serializers.SerializerMethodField()

    def get_tasks(self, obj):
        return TaskWithCompletionSerializer(
            obj["tasks"], many=True, context={"completed_at_by_task": obj["completed_at_by_task"]}
        ).data


class EmployeeProgressRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Employee
        fields = ["id", "name", "email", "avatar_url", "status"]


class DepartmentRefSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ["id", "name"]


class EmployeeOnboardingProgressSerializer(serializers.Serializer):
    """Admin-facing GET /api/onboarding/progress/ row shape, built from the dict
    services.list_employee_onboarding_progress returns per employee."""

    employee = EmployeeProgressRefSerializer()
    department = DepartmentRefSerializer()
    checklist = ChecklistSerializer(allow_null=True)
    completed_tasks = serializers.IntegerField()
    total_tasks = serializers.IntegerField()
    last_activity_at = serializers.DateTimeField(allow_null=True)
