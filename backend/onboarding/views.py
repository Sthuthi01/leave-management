from django.http import FileResponse
from django.shortcuts import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import Role
from accounts.permissions import IsAdminRole

from . import services
from .models import Checklist, Resource, Task
from .services import OnboardingError
from .serializers import (
    ChecklistDetailSerializer,
    ChecklistSerializer,
    ChecklistWriteSerializer,
    EmployeeOnboardingProgressSerializer,
    MyChecklistSerializer,
    ResourceDocumentSerializer,
    ResourceSerializer,
    ResourceVersionSerializer,
    ResourceWriteSerializer,
    TaskSerializer,
    TaskWriteSerializer,
)


class ResourceListCreateView(APIView):
    """GET: admins see every resource; everyone else sees only what
    services.resource_visible_to_employee lets through (rules 1-3). POST: admin only."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        employee = None if request.user.role == Role.ADMIN else request.user
        resources = services.list_resources_for(employee)
        return Response(ResourceSerializer(resources, many=True).data)

    def post(self, request):
        if request.user.role != Role.ADMIN:
            return Response({"detail": "Only admins can add onboarding resources."}, status=403)
        serializer = ResourceWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        attachments = data.pop("attachments", [])
        resource = services.create_resource(actor=request.user, attachments=attachments, **data)
        return Response(ResourceSerializer(resource).data, status=201)


class ResourceDetailView(APIView):
    """PATCH/DELETE only — matches the source app exactly, which has no GET on this route; a
    single resource's data is only ever read through the list endpoint."""

    permission_classes = [IsAuthenticated, IsAdminRole]

    def patch(self, request, pk):
        resource = get_object_or_404(Resource, pk=pk)
        serializer = ResourceWriteSerializer(resource, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = dict(serializer.validated_data)
        attachments = data.pop("attachments", None)
        resource = services.update_resource(actor=request.user, resource=resource, patch=data, attachments=attachments)
        return Response(ResourceSerializer(resource).data)

    def delete(self, request, pk):
        resource = get_object_or_404(Resource, pk=pk)
        try:
            services.delete_resource(actor=request.user, resource=resource)
        except OnboardingError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.http_status)
        return Response({"ok": True})


class ResourceDocumentView(APIView):
    """POST/DELETE: admin only. GET: any authenticated user, but re-runs the same visibility
    check the resource list already applies — this is the only place document bytes ever leave
    the server, and it must never trust a client that merely knows a resource id (Phase 6
    condition #2: downloads always go through this authenticated, visibility-checked endpoint,
    never a raw /media/ URL)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        if request.user.role != Role.ADMIN:
            return Response({"detail": "Only admins can upload onboarding documents."}, status=403)
        resource = get_object_or_404(Resource, pk=pk)
        file = request.FILES.get("file")
        if not file:
            return Response({"detail": "No file was uploaded."}, status=400)
        try:
            document = services.set_resource_document(actor=request.user, resource=resource, file=file)
        except OnboardingError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.http_status)
        return Response(ResourceDocumentSerializer(document).data, status=201)

    def delete(self, request, pk):
        if request.user.role != Role.ADMIN:
            return Response({"detail": "Only admins can remove onboarding documents."}, status=403)
        resource = get_object_or_404(Resource, pk=pk)
        services.delete_resource_document(actor=request.user, resource=resource)
        return Response({"ok": True})

    def get(self, request, pk):
        resource = get_object_or_404(Resource, pk=pk)
        if request.user.role != Role.ADMIN and not services.resource_visible_to_employee(resource, request.user):
            return Response({"detail": "This resource isn't available to you."}, status=403)

        document = getattr(resource, "document", None)
        if not document:
            return Response({"detail": "This resource has no document."}, status=404)

        response = FileResponse(document.file.open("rb"), content_type=document.mime_type)
        response["Content-Disposition"] = f'inline; filename="{document.file_name.replace(chr(34), "")}"'
        response["Content-Length"] = str(document.file_size)
        response["Cache-Control"] = "private, no-store"
        return response


class ResourceVersionsView(APIView):
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request, pk):
        resource = get_object_or_404(Resource, pk=pk)
        versions = services.get_resource_versions(resource)
        return Response(ResourceVersionSerializer(versions, many=True).data)


class ChecklistListCreateView(APIView):
    """GET: any authenticated user — matches the source app exactly, which leaves this route
    ungated so the employee-edit form's checklist picker can populate. POST: admin only."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response(ChecklistSerializer(Checklist.objects.all(), many=True).data)

    def post(self, request):
        if request.user.role != Role.ADMIN:
            return Response({"detail": "Only admins can add onboarding checklists."}, status=403)
        serializer = ChecklistWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        checklist = services.create_checklist(actor=request.user, **serializer.validated_data)
        return Response(ChecklistSerializer(checklist).data, status=201)


class ChecklistDetailView(APIView):
    """Admin only for GET/PATCH/DELETE — matches the source app (unlike the list route, the
    single-checklist detail route IS admin-gated even for GET)."""

    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request, pk):
        checklist = get_object_or_404(Checklist, pk=pk)
        return Response(ChecklistDetailSerializer(checklist).data)

    def patch(self, request, pk):
        checklist = get_object_or_404(Checklist, pk=pk)
        serializer = ChecklistWriteSerializer(checklist, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        checklist = services.update_checklist(actor=request.user, checklist=checklist, patch=serializer.validated_data)
        return Response(ChecklistDetailSerializer(checklist).data)

    def delete(self, request, pk):
        checklist = get_object_or_404(Checklist, pk=pk)
        try:
            services.delete_checklist(actor=request.user, checklist=checklist)
        except OnboardingError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.http_status)
        return Response({"ok": True})


class ChecklistTasksView(APIView):
    permission_classes = [IsAuthenticated, IsAdminRole]

    def post(self, request, pk):
        checklist = get_object_or_404(Checklist, pk=pk)
        serializer = TaskWriteSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        task = services.create_task(actor=request.user, checklist=checklist, **serializer.validated_data)
        return Response(TaskSerializer(task).data, status=201)


class TaskDetailView(APIView):
    permission_classes = [IsAuthenticated, IsAdminRole]

    def patch(self, request, pk):
        task = get_object_or_404(Task, pk=pk)
        serializer = TaskWriteSerializer(task, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        task = services.update_task(actor=request.user, task=task, patch=serializer.validated_data)
        return Response(TaskSerializer(task).data)

    def delete(self, request, pk):
        task = get_object_or_404(Task, pk=pk)
        services.delete_task(actor=request.user, task=task)
        return Response({"ok": True})


class TaskMoveView(APIView):
    permission_classes = [IsAuthenticated, IsAdminRole]

    def post(self, request, pk):
        task = get_object_or_404(Task, pk=pk)
        direction = request.data.get("direction")
        if direction not in ("up", "down"):
            return Response({"detail": "direction must be 'up' or 'down'."}, status=400)
        services.move_task(task=task, direction=direction)
        return Response({"ok": True})


class TaskCompleteView(APIView):
    """Any authenticated user — real authorization (is this task on MY currently assigned
    checklist) happens in services.set_task_completion as an explicit object-level check, not
    here, matching leave_requests' DecideLeaveRequestView/CancelLeaveRequestView pattern."""

    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        task = get_object_or_404(Task, pk=pk)
        completed = bool(request.data.get("completed"))
        try:
            services.set_task_completion(actor=request.user, task=task, completed=completed)
        except OnboardingError as exc:
            return Response({"detail": exc.message, "code": exc.code}, status=exc.http_status)
        return Response({"ok": True, "completed": completed})


class MyChecklistView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        result = services.get_my_checklist(request.user)
        if result is None:
            return Response(None)
        return Response(MyChecklistSerializer(result).data)


class EmployeeProgressView(APIView):
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        progress = services.list_employee_onboarding_progress()
        return Response(EmployeeOnboardingProgressSerializer(progress, many=True).data)
