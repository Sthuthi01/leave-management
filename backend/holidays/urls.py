from django.urls import path

from .views import HolidayDetailView, HolidayImportView, HolidayListCreateView

urlpatterns = [
    path("import/", HolidayImportView.as_view(), name="holiday-import"),
    path("", HolidayListCreateView.as_view(), name="holiday-list-create"),
    path("<int:pk>/", HolidayDetailView.as_view(), name="holiday-detail"),
]
