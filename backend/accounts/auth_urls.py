from django.urls import path

from .views import ChangePasswordView, CsrfView, ForgotPasswordView, LoginView, LogoutView, MeView, SetPasswordView

urlpatterns = [
    path("csrf/", CsrfView.as_view(), name="auth-csrf"),
    path("login/", LoginView.as_view(), name="auth-login"),
    path("logout/", LogoutView.as_view(), name="auth-logout"),
    path("me/", MeView.as_view(), name="auth-me"),
    path("set-password/", SetPasswordView.as_view(), name="auth-set-password"),
    path("change-password/", ChangePasswordView.as_view(), name="auth-change-password"),
    path("forgot-password/", ForgotPasswordView.as_view(), name="auth-forgot-password"),
]
