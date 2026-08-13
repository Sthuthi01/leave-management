from django.test import TestCase

from accounts.models import Employee, PasswordSetupToken, Role, TokenPurpose
from accounts.tokens import check_token, consume_token, create_token
from departments.models import Department


class ResetTokenPurposeTest(TestCase):
    """Phase 1.5 P1 decision: no endpoint mints a RESET token yet (that's a real new feature,
    deferred to Phase 2 — see the note in tokens.py), but the underlying purpose-agnostic
    primitives already fully support it. These tests exercise TokenPurpose.RESET directly through
    create_token/check_token/consume_token to prove that claim, rather than leaving it asserted
    only in a comment."""

    def setUp(self):
        department = Department.objects.create(name="Engineering")
        self.employee = Employee.objects.create_user(
            email="employee@example.com", name="Employee", password="Pass1234567",
            role=Role.EMPLOYEE, title="Engineer", department=department,
        )

    def test_reset_token_can_be_created_checked_and_consumed(self):
        raw_token = create_token(self.employee, TokenPurpose.RESET)

        token, reason = check_token(raw_token)
        self.assertIsNotNone(token)
        self.assertIsNone(reason)
        self.assertEqual(token.purpose, TokenPurpose.RESET)

        consumed_employee = consume_token(raw_token)
        self.assertEqual(consumed_employee, self.employee)

        # Single-use: a second consume attempt must fail.
        self.assertIsNone(consume_token(raw_token))

    def test_reissuing_a_reset_token_invalidates_the_prior_one(self):
        first_token = create_token(self.employee, TokenPurpose.RESET)
        create_token(self.employee, TokenPurpose.RESET)

        token, reason = check_token(first_token)
        self.assertIsNone(token)
        self.assertEqual(reason, "USED")

    def test_invite_and_reset_purposes_do_not_interfere_with_each_other(self):
        invite_token = create_token(self.employee, TokenPurpose.INVITE)
        reset_token = create_token(self.employee, TokenPurpose.RESET)

        # Issuing a RESET token must not invalidate a still-pending INVITE token for the same
        # employee, and vice versa — they're tracked independently via the `purpose` column.
        invite_check, _ = check_token(invite_token)
        reset_check, _ = check_token(reset_token)
        self.assertIsNotNone(invite_check)
        self.assertIsNotNone(reset_check)
        self.assertEqual(
            PasswordSetupToken.objects.filter(employee=self.employee, used_at__isnull=True).count(), 2
        )
