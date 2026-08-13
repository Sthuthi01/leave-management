from django.contrib.auth import logout
from django.contrib.auth.models import AnonymousUser

from .models import EmployeeStatus


class SessionVersionMiddleware:
    """Reproduces the source app's invalidate-on-password-change behavior (src/lib/auth.ts's
    sessionVersion check) using Django's own session store instead of a signed-cookie payload:
    the version is stashed in the session dict at login, and compared to the live DB value on
    every request. A stolen/copied session cookie stops working the instant the real owner changes
    their password. Also rejects a session for an employee whose status flipped to INACTIVE since
    login, same as the source app. Must run after AuthenticationMiddleware (see settings.py).

    Phase 1.5 fix: session_version is now set by a user_logged_in signal receiver (signals.py)
    rather than inline in each login view, so it's set consistently for EVERY login path —
    including Django's own /admin/ login, which previously skipped it and got force-logged-out on
    the very next request by this same middleware."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        user = getattr(request, "user", None)
        if user is not None and user.is_authenticated:
            session_version_at_login = request.session.get("session_version")
            if session_version_at_login != user.session_version or user.status == EmployeeStatus.INACTIVE:
                logout(request)
                request.user = AnonymousUser()
        return self.get_response(request)
