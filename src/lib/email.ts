import nodemailer, { type Transporter } from "nodemailer";

// Dev-only fallback so the app still runs (and this feature is fully testable) without real SMTP
// credentials configured — same pattern as SESSION_SECRET in session.ts: warn once, then degrade to
// something safe (here, printing the email instead of silently swallowing it) rather than failing.
const SMTP_HOST = process.env.SMTP_HOST;
const EMAIL_FROM = process.env.EMAIL_FROM || "Agrileaf <no-reply@agrileaf.in>";
export const APP_URL = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");

let warnedNoSmtp = false;
let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transporter;
}

async function sendMail(to: string, subject: string, html: string, text: string): Promise<void> {
  const transport = getTransporter();
  if (!transport) {
    if (!warnedNoSmtp) {
      console.warn(
        "[email] SMTP_HOST is not set — printing emails to the console instead of sending them. For local development, use the Mailpit service in docker-compose.yml instead of relying on this fallback. Set SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS in your environment to send real email."
      );
      warnedNoSmtp = true;
    }
    // The single-use token is never printed, even here — this fallback exists so a missing SMTP
    // config is visible and debuggable (who it was for, that it was attempted), not so the token
    // itself can be read out of logs. Use Mailpit (local) or configure real SMTP to get the link.
    const redactedText = text.replace(/token=[^&\s]+/g, "token=[redacted]");
    console.log(`\n[email] To: ${to}\n[email] Subject: ${subject}\n[email] ${redactedText}\n`);
    return;
  }
  await transport.sendMail({ from: EMAIL_FROM, to, subject, html, text });
}

function layout(heading: string, bodyHtml: string, buttonLabel: string, url: string): string {
  return `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937;">
      <p style="font-size:14px;font-weight:600;letter-spacing:0.02em;color:#16a34a;margin:0 0 24px;">AGRILEAF</p>
      <h1 style="font-size:20px;margin:0 0 16px;">${heading}</h1>
      ${bodyHtml}
      <a href="${url}" style="display:inline-block;margin:24px 0;padding:10px 20px;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;">${buttonLabel}</a>
      <p style="font-size:12px;color:#6b7280;word-break:break-all;">If the button doesn't work, copy and paste this link into your browser:<br />${url}</p>
    </div>
  `;
}

export async function sendInvitationEmail(params: { to: string; name: string; link: string; expiresInHours: number }): Promise<void> {
  const { to, name, link, expiresInHours } = params;
  const html = layout(
    "You're invited to Agrileaf",
    `<p style="font-size:14px;line-height:1.6;">Hi ${name},</p>
     <p style="font-size:14px;line-height:1.6;">An account has been created for you on Agrileaf. Set up your password to get started.</p>
     <p style="font-size:13px;color:#6b7280;">This link expires in ${expiresInHours} hours and can only be used once.</p>`,
    "Set Up Your Account",
    link
  );
  const text = `Hi ${name}, an account has been created for you on Agrileaf. Set up your password here (expires in ${expiresInHours} hours, single use): ${link}`;
  await sendMail(to, "You're invited to Agrileaf", html, text);
}

export async function sendPasswordResetEmail(params: { to: string; name: string; link: string; expiresInHours: number }): Promise<void> {
  const { to, name, link, expiresInHours } = params;
  const html = layout(
    "Reset your password",
    `<p style="font-size:14px;line-height:1.6;">Hi ${name},</p>
     <p style="font-size:14px;line-height:1.6;">We received a request to reset your Agrileaf password. If you didn't make this request, you can safely ignore this email.</p>
     <p style="font-size:13px;color:#6b7280;">This link expires in ${expiresInHours === 1 ? "1 hour" : `${expiresInHours} hours`} and can only be used once.</p>`,
    "Reset Your Password",
    link
  );
  const text = `Hi ${name}, reset your Agrileaf password here (expires in ${expiresInHours}h, single use): ${link}. If you didn't request this, ignore this email.`;
  await sendMail(to, "Reset your Agrileaf password", html, text);
}
