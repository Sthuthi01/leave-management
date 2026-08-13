from django.urls import path

from .views import (
    CancelLeaveRequestView,
    DecideLeaveRequestView,
    LeaveRequestDetailView,
    LeaveRequestListCreateView,
    PreviewLeaveRequestView,
)

urlpatterns = [
    path("", LeaveRequestListCreateView.as_view(), name="leave-request-list-create"),
    path("preview/", PreviewLeaveRequestView.as_view(), name="leave-request-preview"),
    path("<int:pk>/", LeaveRequestDetailView.as_view(), name="leave-request-detail"),
    path("<int:pk>/cancel/", CancelLeaveRequestView.as_view(), name="leave-request-cancel"),
    path("<int:pk>/decide/", DecideLeaveRequestView.as_view(), name="leave-request-decide"),
]
