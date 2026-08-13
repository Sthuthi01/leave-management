from django.urls import path

from .views import TeamCalendarView

urlpatterns = [
    path("", TeamCalendarView.as_view(), name="team-calendar"),
]
