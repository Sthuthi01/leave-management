import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeoutError

from django.contrib import admin
from django.db import connection
from django.http import JsonResponse
from django.urls import include, path

logger = logging.getLogger(__name__)

DEEP_HEALTH_CHECK_TIMEOUT_SECONDS = 5


def health(request):
    """Unauthenticated, process-only liveness check — mirrors the Next.js app's GET /api/health."""
    return JsonResponse({"status": "ok"})


def _check_database():
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1")


def health_deep(request):
    """Unauthenticated deep health check — mirrors the Next.js app's GET /api/health/deep.

    Runs the DB check in its own thread (Django's `connection` is thread-local, so the worker gets
    a fresh connection) so a hung query can be bounded by a hard timeout even though this view runs
    under sync WSGI/gunicorn. Isolated to this endpoint only — does not touch or affect the shallow
    `health` view above or Docker's HEALTHCHECK (which still calls /api/health/). Never leaks
    exception/database detail to the caller; full detail goes to the server log only.

    Deliberately not using the executor as a context manager: `Executor.__exit__` calls
    `shutdown(wait=True)`, which would block this request until the hung worker thread actually
    finishes — silently defeating the timeout below for exactly the case it exists to handle.
    `shutdown(wait=False)` lets this request return the moment `future.result()` times out; the
    abandoned worker thread and its DB connection are cleaned up whenever the hung query
    eventually returns or errors.
    """
    executor = ThreadPoolExecutor(max_workers=1)
    try:
        future = executor.submit(_check_database)
        future.result(timeout=DEEP_HEALTH_CHECK_TIMEOUT_SECONDS)
        return JsonResponse({"status": "ok", "checks": {"database": "ok"}})
    except FutureTimeoutError:
        logger.error("Deep health check: database check timed out after %ss", DEEP_HEALTH_CHECK_TIMEOUT_SECONDS)
        return JsonResponse({"status": "error", "checks": {"database": "unreachable"}}, status=503)
    except Exception:
        logger.exception("Deep health check: database check failed")
        return JsonResponse({"status": "error", "checks": {"database": "unreachable"}}, status=503)
    finally:
        executor.shutdown(wait=False)


urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/health/deep/", health_deep),
    path("api/auth/", include("accounts.auth_urls")),
    path("api/employees/", include("accounts.urls")),
    path("api/departments/", include("departments.urls")),
    path("api/leave-types/", include("leave_types.urls")),
    path("api/holidays/", include("holidays.urls")),
    path("api/leave-balances/", include("leave_balances.urls")),
    path("api/leave-requests/", include("leave_requests.urls")),
    path("api/dashboard/", include("dashboard.urls")),
    path("api/audit-log/", include("audit.urls")),
    path("api/settings/", include("org_settings.urls")),
    path("api/team-calendar/", include("team_calendar.urls")),
    path("api/reports/", include("reports.urls")),
    path("api/onboarding/", include("onboarding.urls")),
]
