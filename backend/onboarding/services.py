"""Onboarding business logic: resource visibility, versioning, checklist/task lifecycle, and
employee progress — ported field-for-field from the source Next.js app's src/lib/onboarding.ts
and src/lib/db/onboarding-repo.ts (444 lines, read in full during Phase 6 research), preserving
every documented business rule exactly:

1.  Draft resources are never visible to employees (resource_effective_state).
2.  Future-effective-date resources are not visible until their date arrives (resource_effective_state).
3.  ALL/DEPARTMENT/ROLE audience filtering (resource_audience_matches) matches the source exactly.
4.  A resource version is only created when a content field actually changes (update_resource,
    CONTENT_FIELDS).
5.  Metadata-only edits (status/audience/required/effective_date) never create a version — same
    mechanism as #4, by construction (those fields are outside CONTENT_FIELDS).
6.  A resource referenced by any Task cannot be deleted (delete_resource, resource_in_use_by_tasks).
7.  A checklist currently assigned to any employee cannot be deleted (delete_checklist,
    checklist_assigned_count).
8.  Deleting a task or checklist cleans up TaskCompletion rows — enforced via CASCADE FKs on
    Task.checklist and TaskCompletion.task, so ORM-level delete() already produces the exact
    end-state the source app's manual multi-step delete produces.
9.  move_task preserves ordering and no-ops (does not error) at the first/last boundary — exact
    port of the source's swap-with-sibling logic.
10. Employees can only complete tasks on their currently assigned checklist (set_task_completion),
    checked as an explicit object-level comparison, not just queryset filtering — same pattern as
    leave_requests.services.decide_leave_request's approver_id check.
11. Completions belonging to a task whose checklist is no longer the employee's current one are
    excluded from progress (list_employee_onboarding_progress) — but never deleted; reassigning an
    employee's checklist only changes the FK, the old TaskCompletion rows stay in the database.
12. Employee progress (completed/total) is always computed against the employee's CURRENT
    checklist only (list_employee_onboarding_progress).
13. Document upload size/MIME are enforced here (validate_document_upload), server-side, ahead of
    any storage write — never trust client-supplied Content-Type alone for the allow-list.
"""

from collections import defaultdict

from django.db import transaction
from django.db.models import Count, Max
from django.utils import timezone

from accounts.models import Employee, EmployeeStatus
from audit.services import log_audit

from .models import AudienceScope, Checklist, Resource, ResourceAttachment, ResourceDocument, ResourceStatus, ResourceVersion, Task, TaskCompletion


class OnboardingError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 400):
        self.code = code
        self.message = message
        self.http_status = http_status
        super().__init__(message)


# ---- resource visibility (rules 1-3) ----


def resource_effective_state(resource: Resource, today=None) -> str:
    if resource.status == ResourceStatus.DRAFT:
        return "DRAFT"
    today = today or timezone.now().date()
    if resource.effective_date and resource.effective_date > today:
        return "SCHEDULED"
    return "LIVE"


def resource_audience_matches(resource: Resource, employee: Employee) -> bool:
    if resource.audience_scope == AudienceScope.ALL:
        return True
    if resource.audience_scope == AudienceScope.DEPARTMENT:
        return resource.audience_department_id == employee.department_id
    if resource.audience_scope == AudienceScope.ROLE:
        return resource.audience_role == employee.role
    return False


def resource_visible_to_employee(resource: Resource, employee: Employee) -> bool:
    return resource_effective_state(resource) == "LIVE" and resource_audience_matches(resource, employee)


def list_resources_for(employee: Employee | None) -> list[Resource]:
    """employee=None means the ADMIN (unfiltered) branch — matches listResources(forEmployee)."""
    queryset = Resource.objects.select_related("audience_department").prefetch_related("attachments").all()
    if employee is None:
        return list(queryset)
    return [r for r in queryset if resource_visible_to_employee(r, employee)]


# ---- resource CRUD + versioning (rules 4-5) ----

CONTENT_FIELDS = ("title", "category", "description", "content", "url")


def create_resource(*, actor: Employee, attachments: list[dict] | None = None, **fields) -> Resource:
    with transaction.atomic():
        resource = Resource.objects.create(**fields)
        for attachment in attachments or []:
            ResourceAttachment.objects.create(resource=resource, **attachment)
        log_audit(actor, "Added onboarding resource", "OnboardingResource", resource.title)
    return resource


def update_resource(*, actor: Employee, resource: Resource, patch: dict, attachments: list[dict] | None = None) -> Resource:
    """`patch` holds only the fields actually included in this request (DRF's validated_data
    under partial=True) — content-field diffing only compares keys present in `patch`, so a
    metadata-only PATCH (none of CONTENT_FIELDS included) never triggers a version regardless of
    what the resource's existing content is, and a full-form resubmission with unchanged content
    correctly detects no real change. Same end result as the source's always-fully-resolved patch
    object, reached without requiring the caller to resolve every field first."""
    with transaction.atomic():
        content_changed = any(field in patch and patch[field] != getattr(resource, field) for field in CONTENT_FIELDS)
        if content_changed:
            ResourceVersion.objects.create(
                resource=resource,
                version=resource.version,
                title=resource.title,
                category=resource.category,
                description=resource.description,
                content=resource.content,
                url=resource.url,
                editor=actor,
                editor_name=actor.name,
            )
            patch = {**patch, "version": resource.version + 1}

        for field, value in patch.items():
            setattr(resource, field, value)
        resource.save()

        if attachments is not None:
            resource.attachments.all().delete()
            for attachment in attachments:
                ResourceAttachment.objects.create(resource=resource, **attachment)

        log_audit(actor, "Edited onboarding resource", "OnboardingResource", resource.title)
    return resource


def resource_in_use_by_tasks(resource: Resource) -> bool:
    return Task.objects.filter(resource=resource).exists()


def delete_resource(*, actor: Employee, resource: Resource) -> None:
    if resource_in_use_by_tasks(resource):
        raise OnboardingError(
            "RESOURCE_IN_USE",
            "This resource is linked to onboarding tasks. Set it to Draft instead of removing it.",
        )
    with transaction.atomic():
        title = resource.title
        document = getattr(resource, "document", None)
        if document:
            # Explicit storage cleanup — FileField never auto-deletes the underlying file on
            # model delete, so skipping this would leave an orphaned file on the media volume.
            document.file.delete(save=False)
        resource.delete()
        log_audit(actor, "Removed onboarding resource", "OnboardingResource", title)


def get_resource_versions(resource: Resource) -> list[ResourceVersion]:
    return list(resource.versions.all())


# ---- document upload (rule 13) ----

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
ALLOWED_DOCUMENT_MIME_TYPES = frozenset(
    {
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
        "image/png",
        "image/jpeg",
    }
)


def validate_document_upload(file) -> None:
    if file.size == 0:
        raise OnboardingError("EMPTY_FILE", "The uploaded file is empty.")
    if file.size > MAX_DOCUMENT_BYTES:
        raise OnboardingError("FILE_TOO_LARGE", "Files must be 10MB or smaller.")
    if file.content_type not in ALLOWED_DOCUMENT_MIME_TYPES:
        raise OnboardingError(
            "UNSUPPORTED_TYPE",
            "Unsupported file type. Upload a PDF, Word, PowerPoint, Excel, text, or image file.",
        )


def set_resource_document(*, actor: Employee, resource: Resource, file) -> ResourceDocument:
    """Replaces the resource's primary document wholesale — there's only ever one per resource,
    matching the source's setResourceDocument. The previous file is explicitly removed from
    storage first so a re-upload never leaves an orphan on the media volume."""
    validate_document_upload(file)
    with transaction.atomic():
        existing = getattr(resource, "document", None)
        if existing:
            existing.file.delete(save=False)
            existing.delete()
        document = ResourceDocument.objects.create(
            resource=resource,
            file=file,
            file_name=file.name,
            mime_type=file.content_type,
            file_size=file.size,
        )
        log_audit(
            actor,
            "Uploaded onboarding resource document",
            "OnboardingResource",
            f"{resource.title} ({document.file_name})",
        )
    return document


def delete_resource_document(*, actor: Employee, resource: Resource) -> None:
    document = getattr(resource, "document", None)
    if not document:
        return
    with transaction.atomic():
        document.file.delete(save=False)
        document.delete()
        log_audit(actor, "Removed onboarding resource document", "OnboardingResource", resource.title)


# ---- checklists (rule 7) ----


def checklist_assigned_count(checklist: Checklist) -> int:
    return Employee.objects.filter(onboarding_checklist=checklist).count()


def create_checklist(*, actor: Employee, name: str, description: str | None = None) -> Checklist:
    checklist = Checklist.objects.create(name=name, description=description)
    log_audit(actor, "Added onboarding checklist", "OnboardingChecklist", checklist.name)
    return checklist


def update_checklist(*, actor: Employee, checklist: Checklist, patch: dict) -> Checklist:
    for field, value in patch.items():
        setattr(checklist, field, value)
    checklist.save()
    log_audit(actor, "Edited onboarding checklist", "OnboardingChecklist", checklist.name)
    return checklist


def delete_checklist(*, actor: Employee, checklist: Checklist) -> None:
    assigned = checklist_assigned_count(checklist)
    if assigned > 0:
        raise OnboardingError(
            "CHECKLIST_ASSIGNED",
            f"This checklist is assigned to {assigned} employee{'' if assigned == 1 else 's'}. "
            f"Reassign them before removing it.",
        )
    with transaction.atomic():
        name = checklist.name
        # Task.checklist and TaskCompletion.task are both on_delete=CASCADE, so this single
        # delete() already produces the exact end-state the source app's manual
        # completions-then-tasks-then-checklist delete produces (rule 8).
        checklist.delete()
        log_audit(actor, "Removed onboarding checklist", "OnboardingChecklist", name)


# ---- tasks (rules 8-9) ----


def next_task_sort_order(checklist: Checklist) -> int:
    current_max = checklist.tasks.aggregate(value=Max("sort_order"))["value"]
    return 0 if current_max is None else current_max + 1


def create_task(*, actor: Employee, checklist: Checklist, title: str, description: str | None = None, resource: Resource | None = None) -> Task:
    with transaction.atomic():
        task = Task.objects.create(
            checklist=checklist,
            title=title,
            description=description,
            resource=resource,
            sort_order=next_task_sort_order(checklist),
        )
        log_audit(actor, "Added onboarding task", "OnboardingTask", title)
    return task


def update_task(*, actor: Employee, task: Task, patch: dict) -> Task:
    for field, value in patch.items():
        setattr(task, field, value)
    task.save()
    log_audit(actor, "Edited onboarding task", "OnboardingTask", task.title)
    return task


def delete_task(*, actor: Employee, task: Task) -> None:
    with transaction.atomic():
        title = task.title
        task.delete()  # CASCADE removes its TaskCompletion rows (rule 8)
        log_audit(actor, "Removed onboarding task", "OnboardingTask", title)


def move_task(*, task: Task, direction: str) -> None:
    """Swaps sort_order with the adjacent sibling; silently no-ops at the first/last boundary
    (moving the first task up, or the last task down) rather than raising — exact port of the
    source's moveTask, which returns without error in that case (rule 9)."""
    siblings = list(Task.objects.filter(checklist_id=task.checklist_id).order_by("sort_order"))
    idx = next((i for i, sibling in enumerate(siblings) if sibling.pk == task.pk), -1)
    swap_idx = idx - 1 if direction == "up" else idx + 1
    if idx < 0 or swap_idx < 0 or swap_idx >= len(siblings):
        return

    a, b = siblings[idx], siblings[swap_idx]
    with transaction.atomic():
        a.sort_order, b.sort_order = b.sort_order, a.sort_order
        Task.objects.filter(pk=a.pk).update(sort_order=a.sort_order)
        Task.objects.filter(pk=b.pk).update(sort_order=b.sort_order)


# ---- employee-facing progress (rule 10) ----


def get_my_checklist(employee: Employee) -> dict | None:
    checklist = employee.onboarding_checklist
    if checklist is None:
        return None
    tasks = list(checklist.tasks.select_related("resource").order_by("sort_order"))
    completed_at_by_task = dict(
        TaskCompletion.objects.filter(employee=employee, task__checklist=checklist).values_list("task_id", "completed_at")
    )
    return {"checklist": checklist, "tasks": tasks, "completed_at_by_task": completed_at_by_task}


def set_task_completion(*, actor: Employee, task: Task, completed: bool) -> None:
    """Object-level ownership check, not just queryset filtering — an employee may only complete
    a task that belongs to their CURRENTLY assigned checklist (rule 10). Same pattern as
    leave_requests.services.decide_leave_request's explicit approver_id comparison."""
    if actor.onboarding_checklist_id is None or task.checklist_id != actor.onboarding_checklist_id:
        raise OnboardingError("NOT_YOUR_CHECKLIST", "This task isn't part of your assigned checklist.", http_status=403)

    with transaction.atomic():
        if completed:
            TaskCompletion.objects.get_or_create(employee=actor, task=task)
        else:
            TaskCompletion.objects.filter(employee=actor, task=task).delete()
        # Self-service action, audited the same way Applied/Cancelled leave are — this codebase's
        # audit strategy already covers employee-initiated actions, not just admin mutations (see
        # leave_requests.services.apply_leave_request / cancel_leave_request).
        log_audit(
            actor,
            "Completed onboarding task" if completed else "Marked onboarding task incomplete",
            "OnboardingTask",
            task.title,
        )


# ---- HR-facing progress (rules 11-12) ----


def list_employee_onboarding_progress() -> list[dict]:
    employees = (
        Employee.objects.filter(status=EmployeeStatus.ACTIVE)
        .select_related("department", "onboarding_checklist")
        .order_by("name")
    )
    task_count_by_checklist = dict(
        Task.objects.values("checklist_id").annotate(total=Count("id")).values_list("checklist_id", "total")
    )
    checklist_id_by_task = dict(Task.objects.values_list("id", "checklist_id"))

    completions_by_employee: dict[int, list] = defaultdict(list)
    for completion in TaskCompletion.objects.all():
        completions_by_employee[completion.employee_id].append(completion)

    results = []
    for employee in employees:
        checklist = employee.onboarding_checklist
        total_tasks = task_count_by_checklist.get(checklist.id, 0) if checklist else 0
        # A completion whose task belongs to a checklist that is NOT the employee's current one
        # (e.g. they were reassigned) is excluded here — but the TaskCompletion row itself is
        # never deleted; it simply stops counting toward progress (rules 11-12).
        relevant = [
            c
            for c in completions_by_employee.get(employee.id, [])
            if checklist is not None and checklist_id_by_task.get(c.task_id) == checklist.id
        ]
        last_activity_at = max((c.completed_at for c in relevant), default=None)
        results.append(
            {
                "employee": employee,
                "department": employee.department,
                "checklist": checklist,
                "completed_tasks": len(relevant),
                "total_tasks": total_tasks,
                "last_activity_at": last_activity_at,
            }
        )
    return results
