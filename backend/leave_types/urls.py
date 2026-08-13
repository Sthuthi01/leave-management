from django.urls import path

from .views import LeaveTypeDetailView, LeaveTypeListCreateView

urlpatterns = [
    path("", LeaveTypeListCreateView.as_view(), name="leave-type-list-create"),
    path("<int:pk>/", LeaveTypeDetailView.as_view(), name="leave-type-detail"),
]
