from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient


class DeepHealthCheckTest(TestCase):
    """Phase 7: GET /api/health/deep/. Unauthenticated, isolated from the existing shallow
    /api/health/ check and from Docker's HEALTHCHECK (which still targets the shallow endpoint).
    Must never leak exception/database detail in the response body."""

    def setUp(self):
        self.client = APIClient()

    def _url(self):
        return "/api/health/deep/"

    def test_healthy_database_returns_200(self):
        response = self.client.get(self._url())
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "checks": {"database": "ok"}})

    def test_unauthenticated_access_allowed(self):
        # No force_authenticate anywhere in this test class — confirms the endpoint requires no
        # session/credentials at all, matching the source app's deliberately open design.
        response = self.client.get(self._url())
        self.assertNotIn(response.status_code, (401, 403))

    def test_database_unreachable_returns_503_with_no_leaked_detail(self):
        with patch("config.urls._check_database", side_effect=Exception("password authentication failed for user \"secret\"")):
            response = self.client.get(self._url())
        self.assertEqual(response.status_code, 503)
        body = response.json()
        self.assertEqual(body, {"status": "error", "checks": {"database": "unreachable"}})
        self.assertNotIn("password", str(body))
        self.assertNotIn("secret", str(body))

    def test_database_timeout_returns_503_with_no_leaked_detail(self):
        import time

        def _slow(*args, **kwargs):
            time.sleep(6)

        with patch("config.urls._check_database", side_effect=_slow):
            with patch("config.urls.DEEP_HEALTH_CHECK_TIMEOUT_SECONDS", 0.1):
                response = self.client.get(self._url())
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {"status": "error", "checks": {"database": "unreachable"}})

    def test_shallow_health_check_unaffected(self):
        response = self.client.get("/api/health/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})
