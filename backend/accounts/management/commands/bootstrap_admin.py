"""One-time bootstrap: creates the first HR Admin so a fresh Django database doesn't need any
manual database editing. There's no in-app way to do this — every employee-creation path
(EmployeeListCreateView) requires an already-authenticated ADMIN, which a brand-new database
doesn't have. Mirrors scripts/bootstrap-admin.ts's exact safety guarantees, plus one deliberate
change from the original Phase 1 version (see UAT readiness Phase G):

  - Refuses to run unless ALLOW_BOOTSTRAP_ADMIN=true is explicitly set for this invocation — NOT
    gated on DEBUG. DEBUG only controls whether stack traces are shown to clients; tying a
    database-write command to it meant this command could never run in a correctly-hardened
    DEBUG=False UAT/production environment. ALLOW_BOOTSTRAP_ADMIN is a separate, one-shot opt-in
    an operator sets only for this single command invocation (see DEPLOYMENT.md), e.g.:
      docker compose exec -e ALLOW_BOOTSTRAP_ADMIN=true backend python manage.py bootstrap_admin ...
    It is never left set in the environment's normal running configuration, so it adds a real,
    deliberate step beyond merely having container exec access.
  - Refuses to run if any ADMIN employee already exists — unchanged, still the primary guard
    against creating more than one bootstrap admin, and applies regardless of the flag above.
  - Never reachable via a URL — management commands aren't routable in Django, and entrypoint.sh
    only ever runs `migrate`, never this command, so it can't auto-fire on container start either.
  - Creates the employee with an unusable password (never a real/known one, never printed or
    logged) and sends a real invitation email through the exact same code path a normal
    HR-created employee uses — the recipient sets their own password via that link.

Usage:
  python manage.py bootstrap_admin --name "Priya Sharma" --email "priya@example.com"
  python manage.py bootstrap_admin                              (prompts interactively instead)
"""

from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.utils import timezone

from accounts.emails import invite_employee
from accounts.models import Employee, EmployeeStatus, Role
from departments.models import Department


class Command(BaseCommand):
    help = "Creates the first HR Admin. Requires ALLOW_BOOTSTRAP_ADMIN=true for this invocation."

    def add_arguments(self, parser):
        parser.add_argument("--name", type=str, default=None)
        parser.add_argument("--email", type=str, default=None)

    def handle(self, *args, **options):
        if not settings.ALLOW_BOOTSTRAP_ADMIN:
            raise CommandError(
                "Refusing to run: ALLOW_BOOTSTRAP_ADMIN is not set to true. This command must be "
                "explicitly opted into for a single invocation — see DEPLOYMENT.md's 'First HR "
                "Admin' section. Do not enable DEBUG to work around this."
            )

        existing_admin = Employee.objects.filter(role=Role.ADMIN).first()
        if existing_admin is not None:
            raise CommandError(f"Refusing to run: an HR Admin already exists ({existing_admin.name} <{existing_admin.email}>).")

        name = (options["name"] or input("HR Admin full name: ")).strip()
        email = (options["email"] or input("HR Admin email address: ")).strip().lower()

        if not name:
            raise CommandError("A name is required.")
        try:
            validate_email(email)
        except ValidationError as exc:
            raise CommandError("That doesn't look like a valid email address.") from exc
        if Employee.objects.filter(email=email).exists():
            raise CommandError(f"An employee with email {email} already exists.")

        department = Department.objects.first()
        if department is None:
            department = Department.objects.create(name="General")
            self.stdout.write('No department existed yet — created a placeholder department "General".')

        employee = Employee(
            name=name,
            email=email,
            role=Role.ADMIN,
            title="HR Administrator",
            department=department,
            manager=None,
            joined_at=timezone.now().date(),
            status=EmployeeStatus.ACTIVE,
        )
        # Intentionally never set here — left unusable, exactly like insertEmployee() in the
        # source script. The recipient chooses it themselves via the real invite link below.
        employee.set_unusable_password()
        employee.save()

        invite_employee(employee)

        self.stdout.write(self.style.SUCCESS(f'Created HR Admin "{name}" <{email}>.'))
        self.stdout.write(
            "An invitation email was sent to that address — open it and follow the link to set a "
            "password. No password was generated or printed by this command. (Local dev using this "
            "stack's own Mailpit — see docker-compose.backend.yml — check http://localhost:8026.)"
        )
