import nodemailer from 'nodemailer';

// ── Config ───────────────────────────────────────────────────────────────────

const SITE_URL = (process.env.FRONTEND_URL || 'https://partystorm.ng').replace(/\/$/, '');
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@partystorm.ng';
const DEFAULT_FROM =
  process.env.EMAIL_FROM || `PartyStorm <noreply@partystorm.ng>`;
/** Prefer custom logo URL; falls back to app icon + wordmark HTML. */
const LOGO_URL = process.env.EMAIL_LOGO_URL || '';
const ICON_URL = `${SITE_URL}/icons/icon.svg`;

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Organizer / person inbox — replies go here */
  replyTo?: string;
  /** Override display name, e.g. "Acme via PartyStorm" */
  fromName?: string;
}

export type EmailTemplate = {
  subject: string;
  html: string;
  text?: string;
};

// ── Shared layout (Barebones-style: light chrome + gray content card) ────────

const FONT =
  "Inter,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif";

export function emailLayout(opts: {
  eyebrow?: string;
  bodyHtml: string;
  preheader?: string;
  reason?: string;
}): string {
  const year = new Date().getFullYear();
  const preheader = opts.preheader
    ? `<div style="display:none;overflow:hidden;line-height:1px;opacity:0;max-height:0;max-width:0;">${opts.preheader}</div>`
    : '';
  const headerRight = opts.eyebrow
    ? `<span style="color:#7b7d81;">${opts.eyebrow}</span>`
    : `<span style="color:#7b7d81;">partystorm</span>`;
  const reason =
    opts.reason ||
    'You received this email because of activity on your PartyStorm account or tickets.';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <meta name="color-scheme" content="light only" />
  <title>PartyStorm</title>
</head>
<body style="margin:0;padding:0;background-color:#f3f4f6;">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;margin:0;">
    <tr>
      <td align="center" style="padding:32px 12px;font-family:${FONT};">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;width:100%;margin:0 auto;">
          <tr>
            <td style="background-color:#ffffff;padding:16px 24px 24px 24px;">
              <!-- Header: mark left · label right -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:12px;">
                <tr>
                  <td style="width:50%;vertical-align:middle;padding:7px 0;">
                    ${brandMarkHtml()}
                  </td>
                  <td align="right" style="width:50%;vertical-align:middle;padding:7px 0;">
                    <p style="margin:0;font-size:13px;line-height:1.5;font-weight:500;letter-spacing:-0.02em;font-family:${FONT};text-align:right;">
                      ${headerRight}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- Content card -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;border-radius:10px;margin-bottom:8px;">
                <tr>
                  <td style="padding:28px 24px;font-family:${FONT};color:#14171e;font-size:15px;line-height:1.6;text-align:left;">
                    ${opts.bodyHtml}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color:#ffffff;padding:40px 24px 40px 24px;text-align:center;font-family:${FONT};">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 20px auto;">
                <tr>
                  <td style="text-align:center;">
                    <a href="${SITE_URL}" style="text-decoration:none;">
                      <img src="${ICON_URL}" width="40" height="40" alt="partystorm" style="display:block;margin:0 auto;border:0;outline:none;border-radius:10px;" />
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 auto 20px auto;max-width:320px;font-size:13px;line-height:1.5;font-weight:420;letter-spacing:-0.02em;color:#7b7d81;text-align:center;">
                PartyStorm is events and tickets across Nigeria. Discover nights out, book securely, and manage your passes in one place.
              </p>
              <p style="margin:0 0 16px 0;font-size:12px;line-height:1.5;text-align:center;">
                <a href="${SITE_URL}/events" style="color:#7b7d81;text-decoration:none;font-weight:500;padding:0 8px;">Events</a>
                <span style="color:#d4d4d8;">·</span>
                <a href="${SITE_URL}/support" style="color:#7b7d81;text-decoration:none;font-weight:500;padding:0 8px;">Support</a>
                <span style="color:#d4d4d8;">·</span>
                <a href="${SITE_URL}/help" style="color:#7b7d81;text-decoration:none;font-weight:500;padding:0 8px;">Help</a>
              </p>
              <p style="margin:0 0 8px 0;font-size:11px;line-height:1.5;color:#7b7d81;text-align:center;">
                <a href="${SITE_URL}" style="color:#7b7d81;text-decoration:none;">partystorm.ng</a>
                &nbsp;·&nbsp;
                <a href="mailto:${SUPPORT_EMAIL}" style="color:#7b7d81;text-decoration:none;">${SUPPORT_EMAIL}</a>
              </p>
              <p style="margin:0;font-size:11px;line-height:1.5;color:#7b7d81;text-align:center;">
                ${reason}<br />
                © ${year} PartyStorm. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Header brand: small icon + wordmark (left). Optional EMAIL_LOGO_URL. */
export function brandMarkHtml(): string {
  if (LOGO_URL) {
    return `
    <a href="${SITE_URL}" style="text-decoration:none;display:inline-block;">
      <img src="${LOGO_URL}" alt="partystorm" width="140" height="32" style="display:block;border:0;outline:none;height:32px;width:auto;max-width:160px;" />
    </a>`;
  }

  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td style="vertical-align:middle;padding-right:8px;width:28px;">
          <a href="${SITE_URL}" style="text-decoration:none;">
            <img src="${ICON_URL}" width="23" height="23" alt="" style="display:block;border:0;outline:none;border-radius:6px;" />
          </a>
        </td>
        <td style="vertical-align:middle;">
          <a href="${SITE_URL}" style="font-family:${FONT};font-size:15px;font-weight:700;color:#14171e;text-decoration:none;letter-spacing:-0.03em;">partystorm</a>
        </td>
      </tr>
    </table>`;
}

/** Primary CTA — dark rounded button (Barebones-style), rose accent available via variant */
export function emailButton(
  href: string,
  label: string,
  opts?: { variant?: 'dark' | 'rose' }
): string {
  const bg = opts?.variant === 'rose' ? '#f43f5e' : '#14171e';
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto 0 auto;">
      <tr>
        <td align="center" style="border-radius:8px;background:${bg};">
          <a href="${href}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${FONT};font-size:15px;font-weight:500;letter-spacing:-0.02em;color:#ffffff;text-decoration:none;border-radius:8px;line-height:1.4;">
            ${label}
          </a>
        </td>
      </tr>
    </table>`;
}

/** Soft section title used inside the gray content card */
export function emailHeroTitle(title: string, subtitle?: string): string {
  return `
    ${subtitle ? `<p style="margin:0 0 12px 0;font-size:13px;line-height:1.5;font-weight:500;color:#7b7d81;text-align:center;">${subtitle}</p>` : ''}
    <h1 style="margin:0 0 16px 0;font-size:32px;font-weight:600;letter-spacing:-0.64px;line-height:1.15;font-family:${FONT};color:#14171e;text-align:center;">
      ${title}
    </h1>`;
}

// ── Transport: Resend, Google Gmail SMTP, or custom SMTP ─────────────────────

let smtpTransporter: nodemailer.Transporter | null = null;

/**
 * EMAIL_PROVIDER:
 *   - "resend" (default when RESEND_API_KEY is set)
 *   - "gmail"  → Google SMTP via EMAIL_USER + EMAIL_PASS (App Password)
 *   - "smtp"   → custom SMTP_HOST / SMTP_PORT
 * If unset: Resend when key present, else Gmail/SMTP when EMAIL_USER+PASS set.
 */
function resolveEmailProvider(): 'resend' | 'gmail' | 'smtp' {
  const forced = (process.env.EMAIL_PROVIDER || '').toLowerCase().trim();
  if (forced === 'gmail' || forced === 'google') return 'gmail';
  if (forced === 'smtp') return 'smtp';
  if (forced === 'resend') return 'resend';
  if (process.env.RESEND_API_KEY) return 'resend';
  if (process.env.SMTP_HOST) return 'smtp';
  return 'gmail';
}

function getSmtpTransporter(): nodemailer.Transporter | null {
  if (smtpTransporter) return smtpTransporter;
  const user = process.env.EMAIL_USER;
  const pass = process.env.EMAIL_PASS;
  if (!user || !pass) return null;

  const provider = resolveEmailProvider();

  if (provider === 'gmail' || (!process.env.SMTP_HOST && provider !== 'smtp')) {
    // Google Workspace / Gmail — use App Password (not account password)
    smtpTransporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });
  } else {
    smtpTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: { user, pass },
    });
  }
  return smtpTransporter;
}

function resolveFrom(options: EmailOptions): string {
  if (options.fromName) {
    const addr =
      process.env.EMAIL_FROM_ADDRESS ||
      (DEFAULT_FROM.match(/<([^>]+)>/)?.[1] ?? 'noreply@partystorm.ng');
    return `"${options.fromName.replace(/"/g, '')}" <${addr}>`;
  }
  return DEFAULT_FROM;
}

/**
 * Send email via Resend API or Google/custom SMTP.
 */
export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  const from = resolveFrom(options);
  const provider = resolveEmailProvider();

  try {
    if (provider === 'resend') {
      const resendKey = process.env.RESEND_API_KEY;
      if (!resendKey) {
        console.warn('[Email] EMAIL_PROVIDER=resend but RESEND_API_KEY is missing');
        return false;
      }

      const payload: Record<string, unknown> = {
        from,
        to: [options.to],
        subject: options.subject,
        html: options.html,
      };
      if (options.text) payload.text = options.text;
      if (options.replyTo) payload.reply_to = options.replyTo;

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.error('[Email] Resend failed:', res.status, errBody);
        return false;
      }

      const data = (await res.json()) as { id?: string };
      console.log('[Email] ✅ Resend:', { to: options.to, subject: options.subject, id: data.id });
      return true;
    }

    const transport = getSmtpTransporter();
    if (!transport) {
      console.warn(
        `[Email] Provider=${provider} but EMAIL_USER/EMAIL_PASS missing. Not sent to:`,
        options.to
      );
      return false;
    }

    const result = await transport.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
      replyTo: options.replyTo,
    });

    console.log('[Email] ✅ SMTP:', {
      provider,
      to: options.to,
      subject: options.subject,
      messageId: result.messageId,
    });
    return true;
  } catch (error) {
    console.error('[Email] Send failed:', error);
    return false;
  }
};

// ── Templates ────────────────────────────────────────────────────────────────

export const generateOTPEmail = (userEmail: string, otp: string, expiresIn: number = 10) => {
  const expiryTime = new Date(Date.now() + expiresIn * 60 * 1000).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return {
    subject: `Your PartyStorm OTP: ${otp}`,
    html: emailLayout({
      eyebrow: 'Secure your account',
      preheader: `Your PartyStorm code is ${otp}`,
      reason: `This code was requested for ${userEmail}. If that wasn't you, you can ignore this email.`,
      bodyHtml: `
        <p style="margin:0 0 16px 0;">Hi there. Here's your one-time password:</p>
        <div style="background:#fff1f2;padding:20px;border-radius:12px;text-align:center;border:2px dashed #f43f5e;margin:8px 0 16px;">
          <span style="font-size:32px;font-weight:800;color:#f43f5e;letter-spacing:6px;">${otp}</span>
        </div>
        <p style="margin:0 0 12px 0;padding:12px;background:#fef2f2;border-radius:8px;border-left:3px solid #fda4af;font-size:13px;color:#9f1239;">
          Expires in <strong>${expiresIn} minutes</strong> (around ${expiryTime}).
        </p>
        <p style="margin:0;color:#52525b;font-size:13px;">Do not share this code. PartyStorm staff will never ask for your OTP.</p>
      `,
    }),
    text: `Your PartyStorm OTP is: ${otp}. It expires in ${expiresIn} minutes. Do not share this code.`,
  };
};

export const generateTicketConfirmationEmail = (
  userEmail: string,
  ticketData: {
    ticketId: string;
    eventTitle: string;
    eventDate: string;
    eventLocation: string;
    ticketType: string;
    quantity: number;
    totalPrice: number;
    qrCode?: string;
    ticketStyle?: string | null;
    accentColor?: string | null;
  }
) => {
  const ACCENTS: Record<string, string> = {
    rose: '#f43f5e',
    gold: '#eeb111',
    emerald: '#10b981',
    purple: '#8b5cf6',
    midnight: '#1e293b',
    ocean: '#0ea5e9',
  };

  const raw = (ticketData.ticketStyle || 'classic-rose').toLowerCase();
  let accentKey = 'rose';
  const match = raw.match(/^(classic|boarding|stub)-([a-z]+)$/);
  if (match) {
    accentKey = match[2];
  } else if (ACCENTS[raw]) {
    accentKey = raw;
  }
  const accent = ticketData.accentColor || ACCENTS[accentKey] || ACCENTS.rose;

  const qrPayload = ticketData.qrCode || ticketData.ticketId;
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&ecc=M&margin=12&data=${encodeURIComponent(
    qrPayload
  )}`;

  const passCard = `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 20px 0;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e4e4e7;">
      <tr>
        <td style="padding:20px 20px 12px 20px;border-bottom:1px solid #f4f4f5;">
          <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;color:${accent};">
            ${ticketData.ticketType}
          </p>
          <p style="margin:0 0 10px 0;font-size:22px;font-weight:700;letter-spacing:-0.03em;color:#14171e;line-height:1.2;">
            ${ticketData.eventTitle}
          </p>
          <p style="margin:0;font-size:13px;color:#52525b;line-height:1.5;">
            ${ticketData.eventDate}<br />
            ${ticketData.eventLocation}
          </p>
        </td>
      </tr>
      <tr>
        <td align="center" style="padding:24px 20px 8px 20px;background:#fafafa;">
          <p style="margin:0 0 12px 0;font-size:11px;font-weight:600;letter-spacing:0.1em;text-transform:uppercase;color:#71717a;">
            Scan at the gate
          </p>
          <img
            src="${qrImg}"
            width="200"
            height="200"
            alt="Ticket QR code"
            style="display:block;margin:0 auto;border:0;border-radius:12px;background:#ffffff;padding:10px;box-sizing:border-box;"
          />
          <p style="margin:12px 0 0 0;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#71717a;letter-spacing:0.02em;">
            ${ticketData.ticketId}
          </p>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px 20px 20px;background:#fafafa;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td width="50%" style="padding-right:8px;">
                <p style="margin:0;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;">Qty</p>
                <p style="margin:4px 0 0 0;font-size:16px;font-weight:700;color:#14171e;">${ticketData.quantity}</p>
              </td>
              <td width="50%" style="padding-left:8px;text-align:right;">
                <p style="margin:0;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;">Total</p>
                <p style="margin:4px 0 0 0;font-size:18px;font-weight:700;color:${accent};">₦${Number(
                  ticketData.totalPrice || 0
                ).toLocaleString()}</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;

  return {
    subject: `Your tickets for ${ticketData.eventTitle}`,
    html: emailLayout({
      eyebrow: 'Ticket confirmation',
      preheader: `Your tickets for ${ticketData.eventTitle} are confirmed. Show the QR at the gate.`,
      reason: `Ticket confirmation for ${userEmail}.`,
      bodyHtml: `
        ${emailHeroTitle('You\'re in', 'Tickets confirmed')}
        <p style="margin:0 auto 8px auto;max-width:420px;font-size:15px;line-height:1.55;color:#43454b;text-align:center;">
          Your pass for <strong style="color:#14171e;">${ticketData.eventTitle}</strong> is ready.
          Save this email or open My tickets on your phone at the door.
        </p>
        ${passCard}
        <p style="margin:0 0 4px 0;font-size:13px;color:#52525b;text-align:center;line-height:1.5;">
          Brighten your screen and present the QR to staff. Keep your ticket ID handy as backup.
        </p>
        ${emailButton(`${SITE_URL}/my-tickets`, 'View my tickets')}
      `,
    }),
    text: `Your ticket for ${ticketData.eventTitle} is confirmed.
Ticket ID: ${ticketData.ticketId}
QR: ${qrPayload}
Date: ${ticketData.eventDate}
Venue: ${ticketData.eventLocation}
View: ${SITE_URL}/my-tickets`,
  };
};

export const generatePasswordResetEmail = (
  userEmail: string,
  resetLink: string,
  expiresIn: number = 1
) => {
  return {
    subject: 'Reset Your PartyStorm Password',
    html: emailLayout({
      eyebrow: 'Password reset',
      preheader: 'Reset your PartyStorm password',
      reason: `Password reset requested for ${userEmail}.`,
      bodyHtml: `
        <p style="margin:0 0 16px 0;">We received a request to reset your password. Use the button below to choose a new one.</p>
        ${emailButton(resetLink, 'Reset password')}
        <p style="margin:0 0 12px 0;padding:12px;background:#fef2f2;border-radius:8px;border-left:3px solid #fda4af;font-size:13px;color:#9f1239;">
          This link expires in <strong>${expiresIn} hour(s)</strong>.
        </p>
        <p style="margin:0 0 8px 0;font-size:13px;color:#52525b;">If you didn't request this, ignore this email. Your password will stay the same.</p>
        <p style="margin:0;font-size:11px;color:#a1a1aa;word-break:break-all;">${resetLink}</p>
      `,
    }),
    text: `Reset your PartyStorm password: ${resetLink}. Expires in ${expiresIn} hour(s).`,
  };
};

export const generateWelcomeEmail = (userName: string) => {
  return {
    subject: 'Welcome to PartyStorm',
    html: emailLayout({
      eyebrow: 'Welcome',
      preheader: 'Welcome aboard. Discover events and book tickets on PartyStorm.',
      bodyHtml: `
        ${emailHeroTitle(`Welcome to PartyStorm`, 'Thanks for joining us')}
        <p style="margin:0 auto 20px auto;max-width:420px;font-size:16px;line-height:1.5;font-weight:420;letter-spacing:-0.02em;color:#43454b;text-align:center;">
          Hi ${userName}, you&apos;re all set. Browse events near you, save favorites, and keep your tickets in one place.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:420px;margin:0 auto 8px auto;">
          <tr>
            <td style="padding:0 0 14px 0;font-size:15px;line-height:1.5;color:#43454b;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:#f43f5e;margin-right:10px;vertical-align:middle;"></span>
              Discover events near you
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 14px 0;font-size:15px;line-height:1.5;color:#43454b;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:#f43f5e;margin-right:10px;vertical-align:middle;"></span>
              Book tickets with secure checkout
            </td>
          </tr>
          <tr>
            <td style="padding:0 0 14px 0;font-size:15px;line-height:1.5;color:#43454b;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:#f43f5e;margin-right:10px;vertical-align:middle;"></span>
              Manage passes from My tickets
            </td>
          </tr>
          <tr>
            <td style="padding:0;font-size:15px;line-height:1.5;color:#43454b;">
              <span style="display:inline-block;width:8px;height:8px;border-radius:999px;background:#f43f5e;margin-right:10px;vertical-align:middle;"></span>
              Host your own events as an organizer
            </td>
          </tr>
        </table>
        ${emailButton(`${SITE_URL}/events`, 'Browse events')}
      `,
    }),
    text: `Welcome to PartyStorm, ${userName}! Discover events at ${SITE_URL}/events`,
  };
};

export const generateVendorApplicationEmail = (
  userEmail: string,
  applicationData: {
    eventTitle: string;
    businessName: string;
    stallType: string;
  }
) => {
  return {
    subject: `Vendor Application Received for ${applicationData.eventTitle}`,
    html: emailLayout({
      eyebrow: 'Vendor application',
      preheader: `We received your vendor application for ${applicationData.eventTitle}`,
      reason: `Vendor application update for ${userEmail}.`,
      bodyHtml: `
        <p style="margin:0 0 16px 0;">We received your vendor application for <strong>${applicationData.eventTitle}</strong>.</p>
        <div style="background:#fafafa;padding:16px;border-radius:8px;border-left:4px solid #f43f5e;">
          <p style="margin:0;font-size:11px;color:#71717a;text-transform:uppercase;">Business</p>
          <p style="margin:4px 0 12px;font-size:16px;font-weight:600;">${applicationData.businessName}</p>
          <p style="margin:0;font-size:11px;color:#71717a;text-transform:uppercase;">Stall type</p>
          <p style="margin:4px 0 0;font-size:16px;font-weight:600;">${applicationData.stallType}</p>
        </div>
        <p style="margin:16px 0 0;font-size:13px;color:#52525b;">The organizer will review your application. Check status from your dashboard.</p>
      `,
    }),
    text: `Vendor application received for ${applicationData.eventTitle} (${applicationData.businessName} / ${applicationData.stallType}).`,
  };
};

export const generateStaffInviteEmail = (data: {
  firstName: string;
  email: string;
  temporaryPassword?: string | null;
  loginUrl: string;
  staffHomeUrl: string;
}) => {
  const hasPassword = Boolean(data.temporaryPassword);
  return {
    subject: hasPassword
      ? "You're invited to PartyStorm Staff"
      : "You've been added to PartyStorm Staff",
    html: emailLayout({
      eyebrow: 'Staff invite',
      preheader: 'Your PartyStorm staff access is ready',
      reason: `Staff invite for ${data.email}.`,
      bodyHtml: `
        <p style="margin:0 0 12px 0;">Hi ${data.firstName},</p>
        <p style="margin:0 0 16px 0;color:#52525b;">
          You've been set up as PartyStorm staff. Sign in, then switch to <strong>Staff mode</strong> to scan tickets and run walk-in sales.
        </p>
        ${
          hasPassword
            ? `<div style="background:#fafafa;padding:16px;border-radius:8px;border:1px solid #e4e4e7;margin:0 0 16px;">
                <p style="margin:0 0 8px;font-size:11px;color:#71717a;text-transform:uppercase;">Login</p>
                <p style="margin:0 0 4px;"><strong>Email:</strong> ${data.email}</p>
                <p style="margin:0;"><strong>Temporary password:</strong> <span style="font-family:ui-monospace,monospace;">${data.temporaryPassword}</span></p>
                <p style="margin:12px 0 0;font-size:12px;color:#9f1239;">Change this password after your first login.</p>
              </div>`
            : `<p style="margin:0 0 16px;color:#52525b;">Use your existing PartyStorm password. No new password was created.</p>`
        }
        ${emailButton(data.loginUrl, hasPassword ? 'Sign in' : 'Open PartyStorm')}
        <p style="margin:0;font-size:12px;color:#71717a;text-align:center;">
          Staff home: <a href="${data.staffHomeUrl}" style="color:#f43f5e;">${data.staffHomeUrl}</a>
        </p>
      `,
    }),
    text: hasPassword
      ? `Hi ${data.firstName}, PartyStorm Staff invite. Login: ${data.email} / ${data.temporaryPassword}. Staff: ${data.staffHomeUrl}`
      : `Hi ${data.firstName}, you've been added to PartyStorm Staff. ${data.staffHomeUrl}`,
  };
};

/**
 * Organizer message to attendees (use with sendEmail replyTo: organizerEmail).
 */
export const generateOrganizerMessageEmail = (data: {
  attendeeName?: string;
  orgName: string;
  eventTitle: string;
  subjectLine: string;
  bodyText: string;
  eventUrl?: string;
}) => {
  const greet = data.attendeeName?.trim() || 'there';
  const safeBody = data.bodyText
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

  return {
    subject: data.subjectLine,
    html: emailLayout({
      eyebrow: `${data.orgName} · ${data.eventTitle}`,
      preheader: data.subjectLine,
      reason: `Sent by ${data.orgName} via PartyStorm about ${data.eventTitle}. Reply goes to the organizer.`,
      bodyHtml: `
        <p style="margin:0 0 12px 0;">Hi ${greet},</p>
        <p style="margin:0 0 16px 0;color:#3f3f46;line-height:1.6;">${safeBody}</p>
        ${
          data.eventUrl
            ? emailButton(data.eventUrl, 'View event')
            : ''
        }
        <p style="margin:16px 0 0;font-size:12px;color:#a1a1aa;">
          Message from <strong>${data.orgName}</strong> via PartyStorm.
        </p>
      `,
    }),
    text: `Hi ${greet},\n\n${data.bodyText}\n\n— ${data.orgName} via PartyStorm${data.eventUrl ? `\n${data.eventUrl}` : ''}`,
  };
};

export const generateSupportReceivedEmail = (data: {
  name?: string | null;
  subject: string;
  ticketId: number;
  supportUrl: string;
}) => {
  const greet = data.name?.trim() || 'there';
  return {
    subject: `We received your request (#${data.ticketId})`,
    html: emailLayout({
      eyebrow: 'Support',
      preheader: `We received your support request #${data.ticketId}`,
      bodyHtml: `
        <p style="margin:0 0 12px 0;">Hi ${greet},</p>
        <p style="margin:0 0 16px 0;color:#52525b;">Thanks for contacting PartyStorm. We got your request and will follow up by email.</p>
        <div style="background:#fafafa;padding:16px;border-radius:8px;border:1px solid #e4e4e7;margin:0 0 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#71717a;text-transform:uppercase;">Ticket #${data.ticketId}</p>
          <p style="margin:0;font-size:15px;font-weight:600;">${data.subject}</p>
        </div>
        <p style="margin:0 0 16px;font-size:13px;color:#71717a;">Typical response: 24-48 hours on business days.</p>
        ${emailButton(data.supportUrl, 'Open support')}
      `,
    }),
    text: `Hi ${greet}, we received support request #${data.ticketId}: ${data.subject}. ${data.supportUrl}`,
  };
};

export const generateSupportReplyEmail = (data: {
  name?: string | null;
  subject: string;
  ticketId: number;
  replyBody: string;
  needsMoreInfo?: boolean;
  supportUrl: string;
}) => {
  const greet = data.name?.trim() || 'there';
  const headline = data.needsMoreInfo
    ? 'We need a bit more information'
    : 'New reply from PartyStorm Support';
  return {
    subject: data.needsMoreInfo
      ? `More info needed (#${data.ticketId}): ${data.subject}`
      : `Support update (#${data.ticketId}): ${data.subject}`,
    html: emailLayout({
      eyebrow: headline,
      preheader: `Support update on ticket #${data.ticketId}`,
      bodyHtml: `
        <p style="margin:0 0 12px 0;">Hi ${greet},</p>
        <p style="margin:0 0 16px 0;color:#52525b;">
          ${
            data.needsMoreInfo
              ? 'Our team needs a little more detail to help with your request:'
              : 'Our support team replied to your request:'
          }
        </p>
        <div style="background:#fff;padding:16px;border-radius:8px;border-left:4px solid #f43f5e;margin:0 0 16px;">
          <p style="margin:0 0 8px;font-size:12px;color:#71717a;">Ticket #${data.ticketId} · ${data.subject}</p>
          <p style="margin:0;font-size:14px;white-space:pre-wrap;line-height:1.5;">${data.replyBody}</p>
        </div>
        ${emailButton(data.supportUrl, 'View ticket')}
      `,
    }),
    text: `Hi ${greet}, PartyStorm Support #${data.ticketId}:\n\n${data.replyBody}\n\n${data.supportUrl}`,
  };
};

export const generateSupportResolvedEmail = (data: {
  name?: string | null;
  subject: string;
  ticketId: number;
  note?: string | null;
  supportUrl: string;
}) => {
  const greet = data.name?.trim() || 'there';
  return {
    subject: `Resolved (#${data.ticketId}): ${data.subject}`,
    html: emailLayout({
      eyebrow: 'Resolved',
      preheader: `Support ticket #${data.ticketId} was resolved`,
      bodyHtml: `
        <p style="margin:0 0 12px 0;">Hi ${greet},</p>
        <p style="margin:0 0 16px 0;color:#52525b;">We've marked your support request as <strong>resolved</strong>.</p>
        <div style="background:#fafafa;padding:16px;border-radius:8px;border:1px solid #e4e4e7;margin:0 0 16px;">
          <p style="margin:0 0 4px;font-size:11px;color:#71717a;text-transform:uppercase;">Ticket #${data.ticketId}</p>
          <p style="margin:0;font-size:15px;font-weight:600;">${data.subject}</p>
          ${
            data.note?.trim()
              ? `<p style="margin:12px 0 0;font-size:14px;white-space:pre-wrap;line-height:1.5;">${data.note.trim()}</p>`
              : ''
          }
        </div>
        ${emailButton(data.supportUrl, 'Open support')}
      `,
    }),
    text: `Hi ${greet}, ticket #${data.ticketId} (${data.subject}) was resolved.${data.note ? `\n\n${data.note}` : ''}\n\n${data.supportUrl}`,
  };
};

// ── Preview registry ─────────────────────────────────────────────────────────

export const EMAIL_PREVIEW_IDS = [
  'otp',
  'welcome',
  'ticket',
  'password-reset',
  'vendor',
  'staff-invite',
  'organizer-message',
  'support-received',
  'support-reply',
  'support-resolved',
] as const;

export type EmailPreviewId = (typeof EMAIL_PREVIEW_IDS)[number];

export function getEmailPreview(id: EmailPreviewId): EmailTemplate {
  switch (id) {
    case 'otp':
      return generateOTPEmail('guest@example.com', '482910', 10);
    case 'welcome':
      return generateWelcomeEmail('Ada');
    case 'ticket':
      return generateTicketConfirmationEmail('guest@example.com', {
        ticketId: 'TKT-000042',
        eventTitle: 'Afrobeats Night Lagos',
        eventDate: 'Saturday, Aug 15, 2026, 08:00 PM',
        eventLocation: 'Eko Convention Centre, Lagos',
        ticketType: 'VIP',
        quantity: 2,
        totalPrice: 25000,
        qrCode: 'QR-PREVIEW-AFROBEATS-000042',
        ticketStyle: 'classic-rose',
      });
    case 'password-reset':
      return generatePasswordResetEmail(
        'guest@example.com',
        `${SITE_URL}/change-password?token=preview`,
        1
      );
    case 'vendor':
      return generateVendorApplicationEmail('vendor@example.com', {
        eventTitle: 'Street Food Carnival',
        businessName: 'Suya Spot',
        stallType: 'Food truck',
      });
    case 'staff-invite':
      return generateStaffInviteEmail({
        firstName: 'Tunde',
        email: 'tunde@example.com',
        temporaryPassword: 'TempPass123!',
        loginUrl: `${SITE_URL}/login`,
        staffHomeUrl: `${SITE_URL}/staff`,
      });
    case 'organizer-message':
      return generateOrganizerMessageEmail({
        attendeeName: 'Ada',
        orgName: 'Kano Live',
        eventTitle: 'Afrobeats Night Lagos',
        subjectLine: 'Reminder: doors open at 7 PM',
        bodyText:
          'Hi! Just a quick reminder that doors open at 7 PM tomorrow. Bring a valid ID and your QR pass.\n\nSee you there!',
        eventUrl: `${SITE_URL}/events/afrobeats-night-lagos`,
      });
    case 'support-received':
      return generateSupportReceivedEmail({
        name: 'Ada',
        subject: 'Cannot find my ticket',
        ticketId: 1204,
        supportUrl: `${SITE_URL}/support`,
      });
    case 'support-reply':
      return generateSupportReplyEmail({
        name: 'Ada',
        subject: 'Cannot find my ticket',
        ticketId: 1204,
        replyBody: 'Please try Recover tickets with the email you used at checkout.',
        supportUrl: `${SITE_URL}/support`,
      });
    case 'support-resolved':
      return generateSupportResolvedEmail({
        name: 'Ada',
        subject: 'Cannot find my ticket',
        ticketId: 1204,
        note: 'Marked resolved after ticket recovery succeeded.',
        supportUrl: `${SITE_URL}/support`,
      });
    default:
      return generateWelcomeEmail('there');
  }
}

export default {
  sendEmail,
  emailLayout,
  emailButton,
  emailHeroTitle,
  generateOTPEmail,
  generateTicketConfirmationEmail,
  generatePasswordResetEmail,
  generateWelcomeEmail,
  generateVendorApplicationEmail,
  generateStaffInviteEmail,
  generateOrganizerMessageEmail,
  generateSupportReceivedEmail,
  generateSupportReplyEmail,
  generateSupportResolvedEmail,
  getEmailPreview,
  EMAIL_PREVIEW_IDS,
};
