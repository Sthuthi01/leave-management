from django.urls import path

from .views import (
    ChecklistDetailView,
    ChecklistListCreateView,
    ChecklistTasksView,
    EmployeeProgressView,
    MyChecklistView,
    ResourceDetailView,
    ResourceDocumentView,
    ResourceListCreateView,
    ResourceVersionsView,
    TaskCompleteView,
    TaskDetailView,
    TaskMoveView,
)

urlpatterns = [
    path("resources/", ResourceListCreateView.as_view(), name="onboarding-resource-list-create"),
    path("resources/<int:pk>/", ResourceDetailView.as_view(), name="onboarding-resource-detail"),
    path("resources/<int:pk>/document/", ResourceDocumentView.as_view(), name="onboarding-resource-document"),
    path("resources/<int:pk>/versions/", ResourceVersionsView.as_view(), name="onboarding-resource-versions"),
    path("checklists/", ChecklistListCreateView.as_view(), name="onboarding-checklist-list-create"),
    path("checklists/<int:pk>/", ChecklistDetailView.as_view(), name="onboarding-checklist-detail"),
    path("checklists/<int:pk>/tasks/", ChecklistTasksView.as_view(), name="onboarding-checklist-tasks"),
    path("tasks/<int:pk>/", TaskDetailView.as_view(), name="onboarding-task-detail"),
    path("tasks/<int:pk>/move/", TaskMoveView.as_view(), name="onboarding-task-move"),
    path("tasks/<int:pk>/complete/", TaskCompleteView.as_view(), name="onboarding-task-complete"),
    path("my-checklist/", MyChecklistView.as_view(), name="onboarding-my-checklist"),
    path("progress/", EmployeeProgressView.as_view(), name="onboarding-progress"),
]
