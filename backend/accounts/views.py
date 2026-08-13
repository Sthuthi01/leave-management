from django.contrib.auth import authenticate, login as django_login, logout as django_logout
from django.db import transaction
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect, ensure_csrf_cookie
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from audit.services import log_audit
from org_settings.models import OrganizationSettings

from .emails import invite_employee, send_reset_email
from .models import Employee, EmployeeStatus, TokenPurpose
from .permissions import IsAdminRole
from .serializers import (
    ChangePasswordSerializer,
    EmployeeCreateSerializer,
    EmployeeSerializer,
    EmployeeUpdateSerializer,
    ForgotPasswordSerializer,
    LoginSerializer,
    SetPasswordSerializer,
)
from .throttles import ChangePasswordRateThrottle, ForgotPasswordRateThrottle, LoginRateThrottle, SetPasswordRateThrottle
from .tokens import check_token, consume_token

INVALID_CREDENTIALS = "Invalid email or password."


def _apply_session_expiry(request) -> None:
    """Call immediately after django_login() to size this session's cookie from the *current*
    OrganizationSettings.session_max_age_days, instead of Django's static SESSION_COOKIE_AGE.

    Deliberately per-login, not a global/dynamic setting: Django's session store bakes an
    absolute expire_date into the session at set_expiry()/save() time — unlike the source app,
    which re-derives session validity from live settings on every single request (see
    src/lib/auth.ts's `Date.now() - session.issuedAt > maxAgeMs` check). That means a change to
    session_max_age_days here only takes effect for sessions issued *after* the change; any
    already-issued session keeps the expiry it was given at its own login, until it next
    logs in or naturally expires. This is the idiomatic Django approach (see Phase 4 plan) and a
    deliberate, documented deviation from the source app's dynamic-per-request re-check."""
    days = OrganizationSettings.load().session_max_age_days
    request.session.set_expiry(days * 24 * 60 * 60)


@method_decorator(ensure_csrf_cookie, name="get")
class CsrfView(APIView):
    """The SPA calls this once on load to receive the csrftoken cookie, then echoes it back as
    X-CSRFToken on every mutating request — see frontend/src/lib/csrf.ts."""

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"csrfToken": get_token(request)})


@method_decorator(csrf_protect, name="dispatch")
class LoginView(APIView):
    """Phase 1.5: explicitly CSRF-protected via csrf_protect on dispatch(), overriding DRF's
    default behavior of exempting unauthenticated requests from CSRF checking (SessionAuthentication
    only calls enforce_csrf() once request.user already resolves to an authenticated user, which is
    never true for the login request itself — see the Phase 1 review). Closes the "login CSRF" gap
    (an attacker could otherwise trick a victim's browser into signing into the attacker's own
    account) without touching any other endpoint's CSRF behavior."""

    permission_classes = [AllowAny]
    throttle_classes = [LoginRateThrottle]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()
        password = serializer.validated_data["password"]

        # Looked up once, before authenticate(), purely to give the SAME distinct messages the
        # source app's POST /api/auth/login gives (route.ts) — "not activated yet" vs
        # "deactivated" vs the generic invalid-credentials message. authenticate() itself is still
        # what actually verifies the password (and, for an unknown email, Django's ModelBackend
        # runs a dummy password hash comparison internally so response time doesn't leak whether
        # the account exists — the same timing-attack defense the source app's DUMMY_PASSWORD_HASH
        # constant provided by hand).
        try:
            record = Employee.objects.get(email=email)
        except Employee.DoesNotExist:
            authenticate(request, username=email, password=password)  # dummy-hash timing defense
            return Response({"detail": INVALID_CREDENTIALS}, status=status.HTTP_401_UNAUTHORIZED)

        if record.status == EmployeeStatus.INACTIVE:
            return Response({"detail": "This account has been deactivated."}, status=status.HTTP_403_FORBIDDEN)
        if not record.has_usable_password():
            return Response(
                {"detail": "This account hasn't been activated yet. Check your email for an invitation."},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = authenticate(request, username=email, password=password)
        if user is None:
            return Response({"detail": INVALID_CREDENTIALS}, status=status.HTTP_401_UNAUTHORIZED)

        django_login(request, user)
        _apply_session_expiry(request)
        return Response(EmployeeSerializer(user).data)


class LogoutView(APIView):
    def post(self, request):
        django_logout(request)
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(EmployeeSerializer(request.user).data)


@method_decorator(csrf_protect, name="dispatch")
class SetPasswordView(APIView):
    """GET checks token validity without consuming it (page-load check, before the user has typed
    anything). POST consumes the token, sets the password, and signs the user straight in — the
    same two-step contract as the source app's GET/POST /api/auth/set-password.

    Explicitly CSRF-protected via csrf_protect on dispatch(), same fix and same reasoning as
    LoginView above: this view also ends in django_login() while being reachable pre-auth, so it
    has the identical "login CSRF" exposure LoginView was already hardened against — an attacker
    could otherwise embed a cross-site POST carrying their own valid invite/reset token plus an
    attacker-chosen password, signing the victim's browser into the attacker's account. csrf_protect
    only enforces on unsafe methods, so the GET token-check above is unaffected."""

    permission_classes = [AllowAny]
    throttle_classes = [SetPasswordRateThrottle]

    def get(self, request):
        raw_token = request.query_params.get("token", "")
        token, reason = check_token(raw_token)
        if token is None:
            return Response({"valid": False, "reason": reason})
        return Response({"valid": True, "purpose": token.purpose, "name": token.employee.name, "email": token.employee.email})

    def post(self, request):
        serializer = SetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        raw_token = serializer.validated_data["token"]
        # Peeked before consume_token() below invalidates it — purpose never changes for a given
        # token row, so this read-only lookup can't race with the consume that follows. Needed
        # only to pick the right audit label (consume_token() returns just the Employee).
        token_row, _ = check_token(raw_token)
        purpose = token_row.purpose if token_row else None

        employee = consume_token(raw_token)
        if employee is None:
            return Response({"detail": "This link isn't valid or has already been used."}, status=status.HTTP_400_BAD_REQUEST)

        employee.set_password(serializer.validated_data["password"])
        employee.session_version += 1
        employee.save(update_fields=["password", "session_version"])
        log_audit(
            employee,
            "Activated account" if purpose == TokenPurpose.INVITE else "Reset password",
            "Employee",
            employee.name,
        )

        # authenticate() re-verifies against the just-set password rather than trusting our own
        # write — cheap, and it's what actually populates request.user correctly for django_login.
        user = authenticate(request, username=employee.email, password=serializer.validated_data["password"])
        django_login(request, user)
        _apply_session_expiry(request)
        return Response(EmployeeSerializer(user).data)


class ChangePasswordView(APIView):
    """Self-service password change for an already-signed-in caller — POST /api/auth/change-password/.
    Unlike LoginView/SetPasswordView, no explicit @csrf_protect override is needed: DRF's
    SessionAuthentication only skips CSRF enforcement while request.user is still unresolved
    (true for those two pre-auth views), and this endpoint requires IsAuthenticated, so by the
    time it runs request.user already resolved via the session and enforce_csrf() has already
    fired naturally in the normal authentication flow — verified live and in
    tests/test_change_password.py."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [ChangePasswordRateThrottle]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        employee = request.user
        if not employee.check_password(serializer.validated_data["current_password"]):
            return Response({"detail": "Current password is incorrect."}, status=status.HTTP_401_UNAUTHORIZED)

        employee.set_password(serializer.validated_data["new_password"])
        employee.session_version += 1
        employee.save(update_fields=["password", "session_version"])
        log_audit(employee, "Changed password", "Employee", employee.name)

        # session_version was just bumped, which is exactly what SessionVersionMiddleware uses to
        # invalidate outstanding sessions on a password change — including, on the very next
        # request, the one this request itself is using. Re-authenticating and re-issuing the
        # session right here means the user isn't logged out by changing their own password,
        # while every *other* session for this account is correctly invalidated. Same pattern as
        # SetPasswordView above.
        user = authenticate(request, username=employee.email, password=serializer.validated_data["new_password"])
        django_login(request, user)
        _apply_session_expiry(request)
        return Response(EmployeeSerializer(user).data)


class ForgotPasswordView(APIView):
    """Unauthenticated, self-service — POST /api/auth/forgot-password/. No CSRF protection is
    needed here (unlike SetPasswordView): this view never calls django_login() or otherwise acts
    on behalf of a session — it only ever sends an email to whatever address is in the request
    body, which an attacker could already do directly without needing to forge a request through
    a victim's browser. Rate-limited by IP+email instead (see ForgotPasswordRateThrottle)."""

    permission_classes = [AllowAny]
    throttle_classes = [ForgotPasswordRateThrottle]

    def post(self, request):
        serializer = ForgotPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip().lower()

        # Always the same response regardless of whether the account exists, is active, or has a
        # password yet — an endpoint that returns a different message for "no such account" than
        # for "account exists" is a real-employee-email oracle, letting an attacker enumerate the
        # org's roster one guess at a time.
        generic_response = Response({"detail": "If an account exists for that email, a reset link has been sent."})

        try:
            employee = Employee.objects.get(email=email)
        except Employee.DoesNotExist:
            return generic_response

        # Only an already-activated, active account can be reset this way — a not-yet-invited
        # employee (no usable password yet) or a deactivated one has no business receiving a
        # reset link; matches LoginView's own status/has_usable_password checks.
        if employee.status == EmployeeStatus.ACTIVE and employee.has_usable_password():
            send_reset_email(employee)

        return generic_response


class ResendInvitationView(APIView):
    """POST /api/employees/<id>/resend-invitation/ — admin-only. For an employee who was created
    but never activated their account; issuing a new INVITE token automatically invalidates any
    prior unused one (see tokens.create_token), so this can't leave two valid links floating."""

    permission_classes = [IsAuthenticated, IsAdminRole]

    def post(self, request, pk):
        employee = get_object_or_404(Employee, pk=pk)
        if employee.status == EmployeeStatus.INACTIVE:
            return Response(
                {"detail": "This employee is deactivated — reactivate them before resending an invitation."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if employee.has_usable_password():
            return Response(
                {"detail": "This employee already has a password — use Send Password Reset instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        invite_employee(employee)
        log_audit(request.user, "Resent invitation", "Employee", employee.name, f"Invitation sent to {employee.email}")
        return Response({"detail": "Invitation resent."})


class AdminSendPasswordResetView(APIView):
    """POST /api/employees/<id>/send-password-reset/ — admin-only. For an active employee who
    already has a password but needs it reset by HR (locked out, forgot it and can't self-serve,
    etc.) — the mirror image of ResendInvitationView's guard."""

    permission_classes = [IsAuthenticated, IsAdminRole]

    def post(self, request, pk):
        employee = get_object_or_404(Employee, pk=pk)
        if not employee.has_usable_password():
            return Response(
                {"detail": "This employee hasn't activated their account yet — use Resend Invitation instead."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if employee.status != EmployeeStatus.ACTIVE:
            return Response({"detail": "This employee is deactivated."}, status=status.HTTP_400_BAD_REQUEST)
        send_reset_email(employee)
        log_audit(
            request.user, "Sent password reset link", "Employee", employee.name,
            f"Password reset link sent to {employee.email}",
        )
        return Response({"detail": "Password reset link sent."})


class EmployeeListCreateView(generics.ListCreateAPIView):
    """GET: ADMIN-only full directory (matches the source app's role gating — a regular employee
    can't pull the whole roster). POST: ADMIN creates an employee, no password, sends a real
    invite — identical contract to bootstrap_admin's own employee creation, just triggered through
    the API instead of the command line."""

    queryset = Employee.objects.select_related("department", "manager").all()
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get_serializer_class(self):
        return EmployeeCreateSerializer if self.request.method == "POST" else EmployeeSerializer

    def perform_create(self, serializer):
        employee = serializer.save(joined_at=timezone.now().date())
        employee.set_unusable_password()
        employee.save(update_fields=["password"])
        invite_employee(employee)
        log_audit(self.request.user, "Added employee", "Employee", employee.name, f"Invitation sent to {employee.email}")
        self._created_employee = employee

    def create(self, request, *args, **kwargs):
        response = super().create(request, *args, **kwargs)
        response.data = EmployeeSerializer(self._created_employee).data
        response.status_code = status.HTTP_201_CREATED
        return response


class EmployeeDetailView(generics.RetrieveUpdateAPIView):
    """GET/PATCH /api/employees/<id>/ — ADMIN only, matching EmployeeListCreateView's gating.
    No DELETE: employees are deactivated (status=INACTIVE via PATCH), never hard-deleted — the
    same "deactivate not delete" design the source app uses throughout."""

    queryset = Employee.objects.select_related("department", "manager").all()
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get_serializer_class(self):
        return EmployeeUpdateSerializer if self.request.method in ("PATCH", "PUT") else EmployeeSerializer

    def perform_update(self, serializer):
        previous_status = serializer.instance.status
        previous_checklist = serializer.instance.onboarding_checklist
        employee = serializer.save()
        # Mutually exclusive with the generic "Edited employee" label below — matches the source
        # app's employees/[id]/route.ts exactly: a status change in the payload gets its own
        # specific audit action instead of also logging a redundant "Edited employee".
        if "status" in serializer.validated_data and employee.status != previous_status:
            action = "Deactivated employee" if employee.status == EmployeeStatus.INACTIVE else "Reactivated employee"
        else:
            action = "Edited employee"
        log_audit(self.request.user, action, "Employee", employee.name)

        # Onboarding checklist reassignment is a distinct, auditable fact in its own right (Phase
        # 6) — logged as a separate entry rather than folded into the label above, so "who
        # assigned this employee to which checklist and when" stays queryable on its own. Old
        # TaskCompletion rows from the previous checklist are deliberately left untouched here —
        # only the FK changes; see onboarding.services.list_employee_onboarding_progress for how
        # stale completions are excluded from progress without ever being deleted.
        if "onboarding_checklist" in serializer.validated_data and employee.onboarding_checklist_id != (
            previous_checklist.id if previous_checklist else None
        ):
            before = previous_checklist.name if previous_checklist else "none"
            after = employee.onboarding_checklist.name if employee.onboarding_checklist else "none"
            log_audit(
                self.request.user,
                "Changed onboarding checklist",
                "Employee",
                employee.name,
                f"{before} → {after}",
            )

    def update(self, request, *args, **kwargs):
        response = super().update(request, *args, **kwargs)
        response.data = EmployeeSerializer(self.get_object()).data
        return response


MAX_IMPORT_ROWS = 500


class EmployeeImportView(APIView):
    """POST /api/employees/import/ — bulk equivalent of EmployeeListCreateView.perform_create.

    Mirrors the source app's POST /api/employees/import exactly: the request body is a pre-parsed,
    pre-validated JSON array (spreadsheet parsing and name->id resolution both happen client-side,
    in the browser, via the `xlsx` package — this endpoint never receives a raw file). Every row is
    still re-validated here from scratch, via the same EmployeeCreateSerializer a single create
    already uses, since the request body is untrusted input regardless of what the client claims
    it already checked. Each row is its own transaction.atomic() unit — one bad or failing row
    must not roll back rows that already succeeded, matching the source's plain per-row loop with
    no batch-wide transaction."""

    permission_classes = [IsAuthenticated, IsAdminRole]

    def post(self, request):
        rows = request.data.get("rows")
        if not isinstance(rows, list) or len(rows) == 0:
            return Response({"detail": "rows must be a non-empty array."}, status=status.HTTP_400_BAD_REQUEST)
        if len(rows) > MAX_IMPORT_ROWS:
            return Response(
                {"detail": f"A single import can contain at most {MAX_IMPORT_ROWS} rows."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        results = []
        created = 0
        for index, row in enumerate(rows):
            serializer = EmployeeCreateSerializer(data=row if isinstance(row, dict) else {})
            if not serializer.is_valid():
                message = "; ".join(f"{field}: {errors[0]}" for field, errors in serializer.errors.items())
                results.append({"index": index, "status": "skipped", "message": message or "Invalid row."})
                continue

            with transaction.atomic():
                employee = serializer.save(joined_at=timezone.now().date())
                employee.set_unusable_password()
                employee.save(update_fields=["password"])
                invite_employee(employee)
                log_audit(request.user, "Added employee", "Employee", employee.name, f"Invitation sent to {employee.email}")
            created += 1
            results.append({"index": index, "status": "created"})

        return Response({"created": created, "skipped": len(results) - created, "results": results})
