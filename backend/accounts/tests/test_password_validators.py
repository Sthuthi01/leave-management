from django.core.exceptions import ValidationError
from django.contrib.auth.password_validation import validate_password
from django.test import TestCase


class PasswordValidatorsTest(TestCase):
    def test_valid_password_accepted(self):
        # 10+ chars, has a letter, has a number, not a common password.
        validate_password("Sunshine42")

    def test_all_numeric_password_rejected(self):
        with self.assertRaises(ValidationError) as ctx:
            validate_password("12345678901")
        self.assertIn("entirely numeric", " ".join(ctx.exception.messages))

    def test_password_without_a_letter_rejected(self):
        # Not all-numeric (symbols present), but still has zero letters — must fail the new
        # letter requirement specifically, not the pre-existing all-numeric check.
        with self.assertRaises(ValidationError) as ctx:
            validate_password("123456789!")
        self.assertIn("Password must include at least one letter.", ctx.exception.messages)

    def test_password_without_a_digit_rejected(self):
        # Matches the source app's password_schema regex requirement (src/lib/password-rules.ts),
        # restored in Prompt 5 item 6 alongside the pre-existing letter requirement.
        with self.assertRaises(ValidationError) as ctx:
            validate_password("Sunshineabc")
        self.assertIn("Password must include at least one number.", ctx.exception.messages)

    def test_short_password_still_rejected(self):
        # Pre-existing MinimumLengthValidator behavior must be untouched.
        with self.assertRaises(ValidationError) as ctx:
            validate_password("Ab1defg2")
        self.assertTrue(any("at least 10 characters" in m for m in ctx.exception.messages))

    def test_common_password_still_rejected(self):
        # Pre-existing CommonPasswordValidator behavior must be untouched.
        with self.assertRaises(ValidationError) as ctx:
            validate_password("password123")
        self.assertTrue(any("too common" in m for m in ctx.exception.messages))
