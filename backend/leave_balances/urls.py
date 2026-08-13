from django.urls import path

from .views import MyLeaveBalancesView

urlpatterns = [
    path("", MyLeaveBalancesView.as_view(), name="my-leave-balances"),
]
