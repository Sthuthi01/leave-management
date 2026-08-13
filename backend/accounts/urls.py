from django.urls import path

from .views import (
    AdminSendPasswordResetView,
    EmployeeDetailView,
    EmployeeImportView,
    EmployeeListCreateView,
    ResendInvitationView,
)

urlpatterns = [
    path("import/", EmployeeImportView.as_view(), name="employee-import"),
    path("", EmployeeListCreateView.as_view(), name="employee-list-create"),
    path("<int:pk>/", EmployeeDetailView.as_view(), name="employee-detail"),
    path("<int:pk>/resend-invitation/", ResendInvitationView.as_view(), name="employee-resend-invitation"),
    path("<int:pk>/send-password-reset/", AdminSendPasswordResetView.as_view(), name="employee-send-password-reset"),
]
