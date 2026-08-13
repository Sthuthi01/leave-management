"""Mirrors src/lib/email.ts + src/lib/invitation-service.ts's inviteEmployee(): builds a
/set-password?token=... link pointing at the React frontend, and sends it via Django's mail
backend (SMTP to the same Mailpit container the Next.js app uses locally, or console output if
SMTP_HOST is unset — see settings.py's EMAIL_BACKEND selection)."""

from django.conf import settings
from django.core.mail import EmailMultiAlternatives

from .models import TokenPurpose
from .tokens import INVITE_TOKEN_TTL_HOURS, RESET_TOKEN_TTL_HOURS, create_token


def _layout(heading: str, body_html: str, button_label: str, url: str) -> str:
    # Same visual shape as the source app's src/lib/email.ts layout() — green AGRILEAF wordmark,
    # heading, body copy, a styled CTA button, and a plain-text fallback link underneath it.
    return f"""
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937;">
      <p style="font-size:14px;font-weight:600;letter-spacing:0.02em;color:#16a34a;margin:0 0 24px;">AGRILEAF</p>
      <h1 style="font-size:20px;margin:0 0 16px;">{heading}</h1>
      {body_html}
      <a href="{url}" style="display:inline-block;margin:24px 0;padding:10px 20px;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">{button_label}</a>
      <p style="font-size:12px;color:#6b7280;word-break:break-all;">If the button doesn't work, copy and paste this link into your browser:<br />{url}</p>
    </div>
    """


def _send(to: str, subject: str, text_body: str, html_body: str) -> None:
    # multipart/alternative: the plain-text part is unchanged from before (also what still prints
    # to the console in the no-SMTP dev fallback), the HTML part is the new, presentation-only
    # addition — same content and links either way, just formatted for HTML-capable mail clients.
    message = EmailMultiAlternatives(subject=subject, body=text_body, from_email=settings.DEFAULT_FROM_EMAIL, to=[to])
    message.attach_alternative(html_body, "text/html")
    message.send()


def invite_employee(employee) -> None:
    """Used both when an ADMIN creates an employee and by bootstrap_admin — same code path either
    way, so a bootstrapped first admin gets a real invite indistinguishable from a normal one."""
    raw_token = create_token(employee, TokenPurpose.INVITE)
    link = f"{settings.APP_URL}/set-password?token={raw_token}"
    text_body = (
        f"Hi {employee.name},\n\n"
        "An account has been created for you on Agrileaf. Set up your password to get started.\n\n"
        f"This link expires in {INVITE_TOKEN_TTL_HOURS} hours and can only be used once:\n{link}\n"
    )
    html_body = _layout(
        "You're invited to Agrileaf",
        f"""<p style="font-size:14px;line-height:1.6;">Hi {employee.name},</p>
        <p style="font-size:14px;line-height:1.6;">An account has been created for you on Agrileaf. Set up your password to get started.</p>
        <p style="font-size:13px;color:#6b7280;">This link expires in {INVITE_TOKEN_TTL_HOURS} hours and can only be used once.</p>""",
        "Set Up Your Account",
        link,
    )
    _send(employee.email, "You're invited to Agrileaf", text_body, html_body)


def send_reset_email(employee) -> None:
    """Phase 2: used by both the self-service ForgotPasswordView and the admin-triggered
    AdminSendPasswordResetView — same code path either way, same as invite_employee() above.
    Points at the same /set-password page the frontend already has (SetPasswordView.GET reports
    back `purpose: "RESET"` so the page can say "Reset your password" instead of "Set up your
    account" — no new frontend route needed)."""
    raw_token = create_token(employee, TokenPurpose.RESET)
    link = f"{settings.APP_URL}/set-password?token={raw_token}"
    text_body = (
        f"Hi {employee.name},\n\n"
        "A password reset was requested for your Agrileaf account.\n\n"
        f"This link expires in {RESET_TOKEN_TTL_HOURS} hour(s) and can only be used once:\n{link}\n\n"
        "If you didn't request this, you can safely ignore this email — your password hasn't been changed.\n"
    )
    html_body = _layout(
        "Reset your password",
        f"""<p style="font-size:14px;line-height:1.6;">Hi {employee.name},</p>
        <p style="font-size:14px;line-height:1.6;">We received a request to reset your Agrileaf password. If you didn't make this request, you can safely ignore this email.</p>
        <p style="font-size:13px;color:#6b7280;">This link expires in {RESET_TOKEN_TTL_HOURS} hour(s) and can only be used once.</p>""",
        "Reset Your Password",
        link,
    )
    _send(employee.email, "Reset your Agrileaf password", text_body, html_body)
