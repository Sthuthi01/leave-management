"""Phase 1.5 fix: SessionVersionMiddleware (middleware.py) force-logs-out any session whose
`session["session_version"]` doesn't match the employee's current DB value — but that key was
previously only ever set inline inside LoginView/SetPasswordView. Any OTHER login path (the
clearest example: Django's own /admin/ login view) never set it, so the very next request after
logging in there would immediately compare `None != session_version` and force a logout.

Connecting to Django's user_logged_in signal instead fixes this at the root for every login path,
present and future, in one place — django_login() sends this signal as its last step for any
caller (the custom LoginView/SetPasswordView included), so this replaces those views' own inline
`request.session["session_version"] = ...` lines rather than duplicating the behavior."""

from django.contrib.auth.signals import user_logged_in
from django.dispatch import receiver


@receiver(user_logged_in)
def set_session_version(sender, request, user, **kwargs):
    request.session["session_version"] = user.session_version
