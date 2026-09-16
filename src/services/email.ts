import nodemailer from 'nodemailer';

// ── Config ───────────────────────────────────────────────────────────────────

const SITE_URL = (process.env.FRONTEND_URL || 'https://partystorm.ng').replace(/\/$/, '');
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@partystorm.ng';
const DEFAULT_FROM =
  process.env.EMAIL_FROM || `PartyStorm <noreply@partystorm.ng>`;

/**
 * Public asset host for email images (PNG only — SVG is blocked by Gmail).
 * - Set EMAIL_ASSET_BASE=https://partystorm.ng when sending mail with a localhost FRONTEND_URL
 * - Otherwise uses FRONTEND_URL (works for /dev/emails preview on :5181)
 */
const ASSET_BASE = (process.env.EMAIL_ASSET_BASE || SITE_URL).replace(/\/$/, '');

/** Optional full logo URL (PNG/JPG only). Else uses email-icon.png + wordmark. */
const LOGO_URL = process.env.EMAIL_LOGO_URL || '';
const ICON_URL = `${ASSET_BASE}/email-icon.png`;

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

// ── Shared layout (flat, mobile-friendly — minimal nesting / borders) ────────

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
    : '';
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
  <style type="text/css">
    @media only screen and (max-width: 600px) {
      body, .email-bg { background-color: #ffffff !important; }
      .email-outer { padding: 0 !important; background-color: #ffffff !important; }
      .email-shell { width: 100% !important; max-width: 100% !important; border-radius: 0px !important; border: none !important; box-shadow: none !important; }
      .email-pad { padding-left: 16px !important; padding-right: 16px !important; }
      .email-header-pad { padding: 16px 16px 8px 16px !important; }
      .email-body-pad { padding: 8px 16px 16px 16px !important; }
      .email-footer-pad { padding: 24px 16px !important; }
      .email-hero-title { font-size: 24px !important; line-height: 1.25 !important; }
    }
  </style>
  <!--[if mso]>
  <style type="text/css">body,table,td{font-family:Arial,sans-serif!important;}</style>
  <![endif]-->
</head>
<body class="email-bg" style="margin:0;padding:0;background-color:#f4f5f7;-webkit-text-size-adjust:100%;">
  ${preheader}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="email-bg" style="background-color:#f4f5f7;margin:0;border-collapse:collapse;">
    <tr>
      <td class="email-outer" align="center" style="padding:24px 8px;font-family:${FONT};">
        <table class="email-shell" role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;margin:0 auto;border-collapse:collapse;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;">
          <!-- Header -->
          <tr>
            <td class="email-pad email-header-pad" style="background-color:#ffffff;padding:20px 24px 8px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                <tr>
                  <td style="vertical-align:middle;padding:4px 0;">
                    ${brandMarkHtml()}
                  </td>
                  ${
                    headerRight
                      ? `<td align="right" style="vertical-align:middle;padding:4px 0 4px 12px;">
                    <p style="margin:0;font-size:13px;line-height:1.5;font-weight:500;font-family:${FONT};color:#7b7d81;text-align:right;">
                      ${headerRight}
                    </p>
                  </td>`
                      : ''
                  }
                </tr>
              </table>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td class="email-pad email-body-pad" style="background-color:#ffffff;padding:8px 24px 16px 24px;font-family:${FONT};color:#14171e;font-size:15px;line-height:1.6;text-align:left;">
              ${opts.bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td class="email-pad email-footer-pad" style="background-color:#ffffff;padding:24px 24px;text-align:center;font-family:${FONT};">
              <p style="margin:0 auto 16px auto;max-width:280px;font-size:13px;line-height:1.5;color:#7b7d81;text-align:center;">
                PartyStorm is events and tickets across Nigeria. Discover nights out, book securely, and manage your passes in one place.
              </p>
              <p style="margin:0 0 16px 0;font-size:12px;line-height:1.5;text-align:center;">
                <a href="${SITE_URL}/events" style="color:#7b7d81;text-decoration:none;">Events</a>
                <span style="color:#d4d4d8;">&nbsp;·&nbsp;</span>
                <a href="${SITE_URL}/support" style="color:#7b7d81;text-decoration:none;">Support</a>
                <span style="color:#d4d4d8;">&nbsp;·&nbsp;</span>
                <a href="${SITE_URL}/help" style="color:#7b7d81;text-decoration:none;">Help</a>
              </p>
              <p style="margin:0 0 8px 0;font-size:11px;line-height:1.5;color:#7b7d81;text-align:center;">
                <a href="${SITE_URL}" style="color:#7b7d81;text-decoration:none;">partystorm.ng</a>
                &nbsp;·&nbsp;
                <a href="mailto:${SUPPORT_EMAIL}" style="color:#7b7d81;text-decoration:none;">${SUPPORT_EMAIL}</a>
              </p>
              <p style="margin:0;font-size:11px;line-height:1.5;color:#7b7d81;text-align:center;">
                ${reason}<br />
                © ${year} PartyStorm
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

/**
 * Header brand. Uses PNG (email-safe). Falls back to HTML wordmark if image blocked.
 * Never uses SVG — Gmail/Outlook strip SVG images.
 */
export function brandMarkHtml(): string {
  if (LOGO_URL) {
    return `
    <a href="${SITE_URL}" style="text-decoration:none;display:inline-block;">
      <img src="${LOGO_URL}" alt="partystorm" width="148" height="34" style="display:block;border:0;outline:none;height:34px;width:auto;max-width:168px;" />
    </a>`;
  }

  // Rose circle mark (PNG) + wordmark text — text always shows even if img fails
  return `
    <a href="${SITE_URL}" style="text-decoration:none;color:#14171e;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
        <tr>
          <td style="vertical-align:middle;padding-right:10px;width:32px;">
            <img src="${ICON_URL}" width="32" height="32" alt="" style="display:block;border:0;outline:none;width:32px;height:32px;" />
          </td>
          <td style="vertical-align:middle;">
            <span style="font-family:${FONT};font-size:18px;font-weight:800;color:#f43f5e;letter-spacing:-0.04em;line-height:1;">partystorm</span>
          </td>
        </tr>
      </table>
    </a>`;
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

/** Gray rounded content card (Barebones-style #f3f4f6 panels) */
export function emailCard(
  innerHtml: string,
  opts?: { padding?: string; align?: 'left' | 'center' }
): string {
  const padding = opts?.padding || '28px 20px';
  const align = opts?.align || 'left';
  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f3f4f6;border-radius:10px;margin:0 0 16px 0;border-collapse:collapse;">
      <tr>
        <td style="padding:${padding};font-family:${FONT};text-align:${align};">
          ${innerHtml}
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

export type TicketPassForEmail = {
  /** Display id e.g. TKT-000042 */
  label: string;
  /** Value encoded in the QR (qrCode from DB) */
  qrCode: string;
  /** Per-pass type (VIP, Regular, …) — used when an order has mixed types */
  ticketType?: string;
  accentColor?: string | null;
};

function resolveAccent(
  ticketStyle?: string | null,
  accentColor?: string | null
): string {
  const ACCENTS: Record<string, string> = {
    rose: '#f43f5e',
    gold: '#eeb111',
    emerald: '#10b981',
    purple: '#8b5cf6',
    midnight: '#1e293b',
    ocean: '#0ea5e9',
  };
  if (accentColor) return accentColor;
  const raw = (ticketStyle || 'classic-rose').toLowerCase();
  const match = raw.match(/^(classic|boarding|stub)-([a-z]+)$/);
  if (match && ACCENTS[match[2]]) return ACCENTS[match[2]];
  if (ACCENTS[raw]) return ACCENTS[raw];
  return ACCENTS.rose;
}

/** Side notches (email-safe ticket look) */
function ticketNotchRow(opts: {
  contentHtml: string;
  /** Parent bg so notch “cutouts” blend (email body is white) */
  cutoutBg?: string;
}): string {
  const cut = opts.cutoutBg || '#ffffff';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border-collapse:collapse;background:#f3f4f6;border-radius:14px;">
      <tr>
        <!-- Left notches -->
        <td width="14" style="width:14px;vertical-align:top;background:#f3f4f6;">
          <table role="presentation" width="14" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>
            <tr>
              <td align="left" style="font-size:0;line-height:0;">
                <div style="width:14px;height:14px;border-radius:7px;background:${cut};margin-left:-7px;"></div>
              </td>
            </tr>
            <tr><td style="height:48px;line-height:48px;font-size:0;">&nbsp;</td></tr>
            <tr>
              <td align="left" style="font-size:0;line-height:0;">
                <div style="width:14px;height:14px;border-radius:7px;background:${cut};margin-left:-7px;"></div>
              </td>
            </tr>
          </table>
        </td>
        <!-- Main -->
        <td style="vertical-align:top;padding:4px 0;">
          ${opts.contentHtml}
        </td>
        <!-- Right notches -->
        <td width="14" style="width:14px;vertical-align:top;background:#f3f4f6;">
          <table role="presentation" width="14" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="height:28px;line-height:28px;font-size:0;">&nbsp;</td></tr>
            <tr>
              <td align="right" style="font-size:0;line-height:0;">
                <div style="width:14px;height:14px;border-radius:7px;background:${cut};margin-right:-7px;margin-left:auto;"></div>
              </td>
            </tr>
            <tr><td style="height:48px;line-height:48px;font-size:0;">&nbsp;</td></tr>
            <tr>
              <td align="right" style="font-size:0;line-height:0;">
                <div style="width:14px;height:14px;border-radius:7px;background:${cut};margin-right:-7px;margin-left:auto;"></div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
}

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
    /** Single QR (legacy). Prefer `passes` when buying multiple. */
    qrCode?: string;
    /** One entry per ticket — each gets its own QR; include ticketType when mixed */
    passes?: TicketPassForEmail[];
    ticketStyle?: string | null;
    accentColor?: string | null;
  }
) => {
  const accent = resolveAccent(ticketData.ticketStyle, ticketData.accentColor);

  const passes: TicketPassForEmail[] =
    ticketData.passes && ticketData.passes.length > 0
      ? ticketData.passes.map((p) => ({
          ...p,
          ticketType: p.ticketType || ticketData.ticketType,
          accentColor: p.accentColor ?? ticketData.accentColor,
        }))
      : [
          {
            label: ticketData.ticketId,
            qrCode: ticketData.qrCode || ticketData.ticketId,
            ticketType: ticketData.ticketType,
            accentColor: ticketData.accentColor,
          },
        ];

  const typeNames = Array.from(
    new Set(passes.map((p) => p.ticketType || ticketData.ticketType).filter(Boolean))
  );
  const mixedTypes = typeNames.length > 1;

  // Group passes by ticket type for clearer mixed-type orders
  const groups: { type: string; accent: string; passes: TicketPassForEmail[] }[] = [];
  for (const pass of passes) {
    const type = pass.ticketType || ticketData.ticketType || 'General';
    const gAccent = resolveAccent(ticketData.ticketStyle, pass.accentColor || ticketData.accentColor);
    let group = groups.find((g) => g.type === type);
    if (!group) {
      group = { type, accent: gAccent, passes: [] };
      groups.push(group);
    }
    group.passes.push(pass);
  }

  const qrBlock = (
    pass: TicketPassForEmail,
    index: number,
    total: number,
    typeAccent: string,
    typeName: string
  ) => {
    const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=M&margin=10&data=${encodeURIComponent(
      pass.qrCode
    )}`;
    const heading =
      total > 1
        ? `${typeName} · ${index + 1}/${total}`
        : typeName;
    return `
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${
        index < total - 1 ? '10px' : '0'
      } 0;background:#ffffff;border-radius:10px;border-collapse:collapse;">
        <tr>
          <td align="center" style="padding:16px 12px;">
            <p style="margin:0 0 8px 0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${typeAccent};">
              ${heading}
            </p>
            <img
              src="${qrImg}"
              width="160"
              height="160"
              alt="QR for ${pass.label}"
              style="display:block;margin:0 auto;border:0;outline:none;width:160px;height:160px;background:#ffffff;"
            />
            <p style="margin:8px 0 0 0;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#71717a;">
              ${pass.label}
            </p>
          </td>
        </tr>
      </table>`;
  };

  const typeCards = groups
    .map((group) => {
      const body = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
          <tr>
            <td style="padding:16px 12px 8px 8px;">
              <p style="margin:0 0 4px 0;font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${group.accent};">
                ${group.type}
              </p>
              <p style="margin:0 0 6px 0;font-size:18px;font-weight:700;letter-spacing:-0.03em;color:#14171e;line-height:1.25;">
                ${ticketData.eventTitle}
              </p>
              <p style="margin:0;font-size:12px;color:#52525b;line-height:1.45;">
                ${ticketData.eventDate}<br />
                ${ticketData.eventLocation}
              </p>
              <p style="margin:8px 0 0 0;font-size:12px;color:#71717a;">
                ${group.passes.length} pass${group.passes.length > 1 ? 'es' : ''}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 8px 12px 8px;">
              ${group.passes
                .map((p, i) =>
                  qrBlock(p, i, group.passes.length, group.accent, group.type)
                )
                .join('')}
            </td>
          </tr>
        </table>`;

      return ticketNotchRow({
        contentHtml: body,
        cutoutBg: '#ffffff',
      });
    })
    .join('');

  const summaryTypes = mixedTypes
    ? typeNames.join(' · ')
    : ticketData.ticketType;

  const passListText = passes
    .map(
      (p, i) =>
        `  ${i + 1}. [${p.ticketType || ticketData.ticketType}] ${p.label} — QR: ${p.qrCode}`
    )
    .join('\n');

  return {
    subject: `Your tickets for ${ticketData.eventTitle}`,
    html: emailLayout({
      eyebrow: 'Ticket confirmation',
      preheader: `Your tickets for ${ticketData.eventTitle} are confirmed. Show each QR at the gate.`,
      reason: `Ticket confirmation for ${userEmail}.`,
      bodyHtml: `
        ${emailHeroTitle(
          passes.length > 1 ? `${passes.length} tickets confirmed` : "You're in",
          mixedTypes ? summaryTypes : 'Tickets confirmed'
        )}
        <p style="margin:0 auto 8px auto;max-width:420px;font-size:15px;line-height:1.55;color:#43454b;text-align:center;">
          Your pass${passes.length > 1 ? 'es' : ''} for <strong style="color:#14171e;">${ticketData.eventTitle}</strong> ${
            passes.length > 1 ? 'are' : 'is'
          } ready.
          ${
            mixedTypes
              ? 'Each ticket type is grouped below with its own QR codes.'
              : passes.length > 1
                ? 'Each ticket has its own QR — scan one per guest.'
                : 'Save this email or open My tickets on your phone at the door.'
          }
        </p>
        ${typeCards}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 16px 0;border-collapse:collapse;">
          <tr>
            <td width="50%" style="padding:8px 0;">
              <p style="margin:0;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;">Qty</p>
              <p style="margin:4px 0 0 0;font-size:16px;font-weight:700;color:#14171e;">${ticketData.quantity}</p>
            </td>
            <td width="50%" align="right" style="padding:8px 0;">
              <p style="margin:0;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;">Total</p>
              <p style="margin:4px 0 0 0;font-size:18px;font-weight:700;color:${accent};">₦${Number(
                ticketData.totalPrice || 0
              ).toLocaleString()}</p>
            </td>
          </tr>
        </table>
        <p style="margin:0 0 4px 0;font-size:13px;color:#52525b;text-align:center;line-height:1.5;">
          Brighten your screen and present each QR to staff.
        </p>
        ${emailButton(`${SITE_URL}/my-tickets`, 'View my tickets')}
      `,
    }),
    text: `Your ticket(s) for ${ticketData.eventTitle} are confirmed.
${passListText}
Date: ${ticketData.eventDate}
Venue: ${ticketData.eventLocation}
Qty: ${ticketData.quantity} · Total: ₦${Number(ticketData.totalPrice || 0).toLocaleString()}
View: ${SITE_URL}/my-tickets`,
  };
};

export const generatePasswordResetEmail = (
  userEmail: string,
  resetLink: string,
  expiresIn: number = 1
) => {
  return {
    subject: 'Reset your PartyStorm password',
    html: emailLayout({
      eyebrow: 'Password reset',
      preheader: 'Reset your PartyStorm password',
      reason: `Password reset requested for ${userEmail}.`,
      bodyHtml: emailCard(
        `
        <img src="${ICON_URL}" width="48" height="48" alt="partystorm" style="display:block;margin:0 auto 20px auto;border:0;outline:none;width:48px;height:48px;" />
        <h1 style="margin:0 0 16px 0;font-size:28px;font-weight:600;letter-spacing:-0.04em;line-height:1.3;font-family:${FONT};color:#14171e;text-align:center;">
          Reset your password
        </h1>
        <p style="margin:0 auto 24px auto;max-width:380px;font-size:16px;line-height:1.5;font-weight:420;color:#43454b;text-align:center;font-family:${FONT};">
          Someone requested a link to change your password. You can do that with the button below.
        </p>
        ${emailButton(resetLink, 'Change password')}
        <p style="margin:24px auto 0 auto;max-width:400px;font-size:13px;line-height:1.5;color:#7b7d81;text-align:center;font-family:${FONT};">
          This link expires in <strong style="color:#43454b;">${expiresIn} hour(s)</strong>.
          If you didn&apos;t request this, ignore this email. Your password won&apos;t change until you create a new one.
        </p>
        <p style="margin:20px 0 0 0;font-size:11px;line-height:1.5;color:#a1a1aa;word-break:break-all;text-align:center;">
          ${resetLink}
        </p>
        `,
        { padding: '48px 28px', align: 'center' }
      ),
    }),
    text: `Reset your PartyStorm password: ${resetLink}. Expires in ${expiresIn} hour(s). If you didn't request this, ignore this email.`,
  };
};

export const generateWelcomeEmail = (userName: string) => {
  const feature = (title: string, body: string) => `
    <td width="50%" style="width:50%;vertical-align:top;padding:0 8px 20px 8px;">
      <p style="margin:0 0 10px 0;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:#f43f5e;"></span>
      </p>
      <p style="margin:0 0 6px 0;font-size:15px;font-weight:600;color:#14171e;font-family:${FONT};text-align:left;">
        ${title}
      </p>
      <p style="margin:0;font-size:14px;line-height:1.5;color:#43454b;font-family:${FONT};text-align:left;">
        ${body}
      </p>
    </td>`;

  return {
    subject: 'Welcome to PartyStorm',
    html: emailLayout({
      eyebrow: 'Welcome',
      preheader: 'Welcome aboard. Discover events, book tickets, and manage your passes on PartyStorm.',
      bodyHtml: `
        ${emailCard(
          `
          <p style="margin:0 0 16px 0;font-size:13px;line-height:1.5;font-weight:500;color:#7b7d81;text-align:center;font-family:${FONT};">
            Thanks for joining us
          </p>
          <h1 style="margin:0 0 16px 0;font-size:36px;font-weight:600;letter-spacing:-0.8px;line-height:1.1;font-family:${FONT};color:#14171e;text-align:center;">
            Welcome to PartyStorm
          </h1>
          <p style="margin:0 auto;max-width:420px;font-size:16px;line-height:1.5;color:#43454b;text-align:center;font-family:${FONT};">
            Hi ${userName}, you&apos;re all set. PartyStorm helps you find events across Nigeria, buy tickets securely, and keep every QR pass in one place.
          </p>
          `,
          { padding: '32px 20px 36px 20px', align: 'center' }
        )}

        ${emailCard(
          `
          <h2 style="margin:0 0 20px 0;font-size:26px;font-weight:600;letter-spacing:-0.5px;line-height:1.25;font-family:${FONT};color:#14171e;text-align:left;">
            Getting started
          </h2>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
            <tr>
              ${feature(
                'Browse events',
                'Explore concerts, nightlife, conferences, and more near you. Filter by city, date, and category.'
              )}
              ${feature(
                'Book in minutes',
                'Guest or account checkout with Paystack. Get a confirmation email and QR pass right away.'
              )}
            </tr>
            <tr>
              ${feature(
                'My tickets',
                'Open your passes anytime, recover lost tickets by email, and brighten your screen at the gate.'
              )}
              ${feature(
                'Host events',
                'Become an organizer to publish events, sell tickets, scan at the door, and get paid.'
              )}
            </tr>
          </table>
          ${emailButton(`${SITE_URL}/events`, 'Browse events')}
          `,
          { padding: '28px 20px 32px 20px', align: 'left' }
        )}

        ${emailCard(
          `
          <p style="margin:0 0 20px 0;font-size:26px;font-weight:600;letter-spacing:-0.5px;line-height:1.25;font-family:${FONT};color:#14171e;text-align:center;">
            What you can do next
          </p>
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;max-width:440px;margin:0 auto;">
            <tr>
              <td style="padding:0 0 12px 0;font-size:15px;line-height:1.5;color:#43454b;font-family:${FONT};text-align:left;">
                1. Complete your profile so ticket recovery is easy
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 12px 0;font-size:15px;line-height:1.5;color:#43454b;font-family:${FONT};text-align:left;">
                2. Save events you like and share links with friends
              </td>
            </tr>
            <tr>
              <td style="padding:0 0 12px 0;font-size:15px;line-height:1.5;color:#43454b;font-family:${FONT};text-align:left;">
                3. On event day, open <strong>My tickets</strong> and show your QR
              </td>
            </tr>
            <tr>
              <td style="padding:0;font-size:15px;line-height:1.5;color:#43454b;font-family:${FONT};text-align:left;">
                4. Need help? Visit Support or reply to ${SUPPORT_EMAIL}
              </td>
            </tr>
          </table>
          ${emailButton(`${SITE_URL}/my-tickets`, 'Go to my tickets')}
          `,
          { padding: '32px 20px', align: 'center' }
        )}

        ${emailCard(
          `
          <img src="${ICON_URL}" width="40" height="40" alt="" style="display:block;margin:0 auto 16px auto;border:0;outline:none;width:40px;height:40px;" />
          <p style="margin:0 0 20px 0;font-size:22px;font-weight:600;letter-spacing:-0.04em;line-height:1.3;font-family:${FONT};color:#43454b;text-align:center;">
            Ready when you are<br />
            <span style="color:#14171e;">Discover your next night out on PartyStorm.</span>
          </p>
          ${emailButton(`${SITE_URL}/events`, 'Explore events', { variant: 'rose' })}
          `,
          { padding: '36px 24px', align: 'center' }
        )}
      `,
    }),
    text: `Welcome to PartyStorm, ${userName}!

You're all set. Here's what you can do:
- Browse events: ${SITE_URL}/events
- Book tickets with secure checkout
- Manage QR passes in My tickets: ${SITE_URL}/my-tickets
- Host your own events: ${SITE_URL}/for-organizers

Need help? ${SUPPORT_EMAIL}
`,
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

export const generatePreEventReminderEmail = (data: {
  attendeeName?: string;
  orgName: string;
  eventTitle: string;
  startDate: string;
  location?: string | null;
  eventUrl: string;
  ticketsUrl: string;
}) => {
  const greet = data.attendeeName?.trim() || 'there';
  const subject = `⏰ Reminder: ${data.eventTitle} is starting soon!`;

  return {
    subject,
    html: emailLayout({
      eyebrow: `Event Reminder · ${data.orgName}`,
      preheader: `Get ready! ${data.eventTitle} starts on ${data.startDate}`,
      reason: `You are receiving this reminder because you have a ticket for ${data.eventTitle}.`,
      bodyHtml: `
        ${emailHeroTitle('Event Starts Soon!')}
        <p style="margin:0 0 16px 0;color:#374151;font-size:15px;line-height:1.6;">
          Hi ${greet}, get ready! <strong>${data.eventTitle}</strong> hosted by <strong>${data.orgName}</strong> is right around the corner.
        </p>

        <div style="background-color:#fff1f2;border:1px solid #fecdd3;border-radius:12px;padding:20px;margin:20px 0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding-bottom:10px;">
                <span style="font-size:11px;font-weight:700;color:#f43f5e;text-transform:uppercase;letter-spacing:0.5px;">Date & Time</span>
                <p style="margin:2px 0 0 0;font-size:15px;font-weight:700;color:#111827;">${data.startDate}</p>
              </td>
            </tr>
            ${
              data.location
                ? `<tr>
              <td>
                <span style="font-size:11px;font-weight:700;color:#f43f5e;text-transform:uppercase;letter-spacing:0.5px;">Venue / Location</span>
                <p style="margin:2px 0 0 0;font-size:14px;font-weight:600;color:#374151;">${data.location}</p>
              </td>
            </tr>`
                : ''
            }
          </table>
        </div>

        <p style="margin:0 0 16px 0;color:#4b5563;font-size:14px;line-height:1.5;">
          Have your ticket QR code ready on your phone for smooth entry at the gate.
        </p>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr>
            <td align="center">
              ${emailButton(data.ticketsUrl, 'View My Ticket QR Code')}
            </td>
          </tr>
        </table>
      `,
    }),
    text: `Hi ${greet},\n\nReminder: ${data.eventTitle} starts on ${data.startDate}.\nLocation: ${data.location || 'Online'}\n\nView your QR code: ${data.ticketsUrl}\nEvent details: ${data.eventUrl}`,
  };
};

export const generatePostEventThankYouEmail = (data: {
  attendeeName?: string;
  orgName: string;
  eventTitle: string;
  eventUrl: string;
}) => {
  const greet = data.attendeeName?.trim() || 'there';
  const subject = `💖 Thank you for attending ${data.eventTitle}!`;

  return {
    subject,
    html: emailLayout({
      eyebrow: `Thank You · ${data.orgName}`,
      preheader: `Thank you for joining us at ${data.eventTitle}`,
      reason: `You attended ${data.eventTitle} hosted by ${data.orgName}.`,
      bodyHtml: `
        ${emailHeroTitle('Thank You for Coming!')}
        <p style="margin:0 0 16px 0;color:#374151;font-size:15px;line-height:1.6;">
          Hi ${greet}, thank you for being a part of <strong>${data.eventTitle}</strong>! We hope you had an unforgettable experience.
        </p>

        <div style="background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin:20px 0;text-align:center;">
          <p style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#111827;">We'd love your feedback</p>
          <p style="margin:0;font-size:13px;color:#6b7280;">Stay connected with ${data.orgName} for future event announcements and updates.</p>
        </div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
          <tr>
            <td align="center">
              ${emailButton(data.eventUrl, 'Explore More Events')}
            </td>
          </tr>
        </table>
      `,
    }),
    text: `Hi ${greet},\n\nThank you for attending ${data.eventTitle} hosted by ${data.orgName}!\n\nExplore more events: ${data.eventUrl}`,
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
        ticketId: 'TKT-000042 · TKT-000043 · TKT-000044',
        eventTitle: 'Afrobeats Night Lagos',
        eventDate: 'Saturday, Aug 15, 2026, 08:00 PM',
        eventLocation: 'Eko Convention Centre, Lagos',
        ticketType: 'VIP',
        quantity: 3,
        totalPrice: 35000,
        ticketStyle: 'classic-rose',
        passes: [
          {
            label: 'TKT-000042',
            qrCode: 'QR-PREVIEW-VIP-000042',
            ticketType: 'VIP',
            accentColor: '#f43f5e',
          },
          {
            label: 'TKT-000043',
            qrCode: 'QR-PREVIEW-VIP-000043',
            ticketType: 'VIP',
            accentColor: '#f43f5e',
          },
          {
            label: 'TKT-000044',
            qrCode: 'QR-PREVIEW-REG-000044',
            ticketType: 'Regular',
            accentColor: '#0ea5e9',
          },
        ],
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
  emailCard,
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
