import nodemailer from 'nodemailer';

// ── Config ───────────────────────────────────────────────────────────────────

const SITE_URL = (process.env.FRONTEND_URL || 'https://partystorm.ng').replace(/\/$/, '');
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'partystormevents@gmail.com';
const SUPPORT_WHATSAPP = (process.env.SUPPORT_WHATSAPP || '2347030152798').replace(/\D/g, '');
const SUPPORT_INSTAGRAM_URL =
  process.env.SUPPORT_INSTAGRAM_URL || 'https://www.instagram.com/partystorm.ng';
const WHATSAPP_URL = `https://wa.me/${SUPPORT_WHATSAPP}`;
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

export interface EmailAttachment {
  filename: string;
  content: Buffer;
  contentType?: string;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Organizer / person inbox — replies go here */
  replyTo?: string;
  /** Override display name, e.g. "Acme via PartyStorm" */
  fromName?: string;
  /** Optional file attachments (e.g. ticket PDFs) */
  attachments?: EmailAttachment[];
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
      .email-pad { padding-left: 10px !important; padding-right: 10px !important; }
      .email-header-pad { padding: 12px 10px 6px 10px !important; }
      .email-body-pad { padding: 4px 10px 10px 10px !important; }
      .email-footer-pad { padding: 12px 10px 14px 10px !important; }
      .email-hero-title { font-size: 22px !important; line-height: 1.25 !important; }
      .ticket-photo-pad { padding: 12px 12px 14px 12px !important; }
      .ticket-stub-pad { padding: 12px 10px 14px 10px !important; }
      .ticket-title { font-size: 18px !important; }
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
            <td class="email-pad email-header-pad" style="background-color:#ffffff;padding:16px 20px 6px 20px;">
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
            <td class="email-pad email-body-pad" style="background-color:#ffffff;padding:6px 20px 12px 20px;font-family:${FONT};color:#14171e;font-size:15px;line-height:1.6;text-align:left;">
              ${opts.bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td class="email-pad email-footer-pad" style="background-color:#ffffff;padding:16px 24px 20px 24px;text-align:center;font-family:${FONT};border-top:1px solid #f0f0f2;">
              <p style="margin:0 auto 10px auto;max-width:300px;font-size:12px;line-height:1.45;color:#7b7d81;text-align:center;">
                Events &amp; tickets across Nigeria — book, get your QR, and show up.
              </p>
              <p style="margin:0 0 8px 0;font-size:12px;line-height:1.5;text-align:center;">
                <a href="${WHATSAPP_URL}" style="color:#25D366;text-decoration:none;font-weight:600;">WhatsApp</a>
                <span style="color:#d4d4d8;">&nbsp;·&nbsp;</span>
                <a href="${SUPPORT_INSTAGRAM_URL}" style="color:#7b7d81;text-decoration:none;font-weight:600;">Instagram</a>
                <span style="color:#d4d4d8;">&nbsp;·&nbsp;</span>
                <a href="${SITE_URL}/support" style="color:#7b7d81;text-decoration:none;">Support</a>
              </p>
              <p style="margin:0;font-size:11px;line-height:1.5;color:#a1a1aa;text-align:center;">
                <a href="${SITE_URL}" style="color:#a1a1aa;text-decoration:none;">partystorm.ng</a>
                &nbsp;·&nbsp;© ${year} PartyStorm
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
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:12px auto 0 auto;">
      <tr>
        <td align="center" style="border-radius:8px;background:${bg};">
          <a href="${href}" target="_blank" style="display:inline-block;padding:12px 22px;font-family:${FONT};font-size:14px;font-weight:600;letter-spacing:-0.02em;color:#ffffff;text-decoration:none;border-radius:8px;line-height:1.4;">
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
      if (options.attachments?.length) {
        payload.attachments = options.attachments.map((a) => ({
          filename: a.filename,
          content: a.content.toString('base64'),
          content_type: a.contentType || 'application/octet-stream',
        }));
      }

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
      console.log('[Email] ✅ Resend:', {
        to: options.to,
        subject: options.subject,
        id: data.id,
        attachments: options.attachments?.length || 0,
      });
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
      attachments: options.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
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
    rose: '#d85060',
    gold: '#c49a1a',
    emerald: '#059669',
    purple: '#6d5a9a',
    midnight: '#1e293b',
    ocean: '#0284c7',
  };
  if (accentColor && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(accentColor.trim())) {
    return accentColor.trim();
  }
  const raw = (ticketStyle || 'classic-rose').toLowerCase();
  const match = raw.match(/^(classic|boarding|stub|cinema|folio)-([a-z]+)$/);
  if (match && ACCENTS[match[2]]) return ACCENTS[match[2]];
  if (ACCENTS[raw]) return ACCENTS[raw];
  return ACCENTS.rose;
}

function inkOnHex(hex: string): '#ffffff' | '#0a0a0a' {
  const raw = hex.replace('#', '');
  if (raw.length < 6) return '#ffffff';
  const r = parseInt(raw.slice(0, 2), 16);
  const g = parseInt(raw.slice(2, 4), 16);
  const b = parseInt(raw.slice(4, 6), 16);
  const luma = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luma > 0.55 ? '#0a0a0a' : '#ffffff';
}

function splitEventTitle(title: string): { first: string; rest: string } {
  const parts = (title || 'Event').trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] || 'Event', rest: '' };
  return { first: parts[0], rest: parts.slice(1).join(' ') };
}

function layoutCopyFromStyle(ticketStyle?: string | null): {
  headline: string;
  sublabel: string;
  venueLabel: string;
} {
  const raw = (ticketStyle || '').toLowerCase();
  const layout = raw.split('-')[0];
  const map: Record<string, { headline: string; sublabel: string; venueLabel: string }> = {
    classic: { headline: 'COME AND JOIN', sublabel: 'Admit one', venueLabel: 'LIVE AT' },
    boarding: { headline: "YOU'RE INVITED", sublabel: 'First class', venueLabel: 'VENUE' },
    stub: { headline: 'LIVE SHOW', sublabel: 'Admit one', venueLabel: 'LIVE AT' },
    cinema: { headline: 'NOW SHOWING', sublabel: 'Admit one', venueLabel: 'SCREEN' },
    folio: { headline: 'EXHIBITION', sublabel: 'Admit one', venueLabel: 'VENUE' },
  };
  return map[layout] || map.classic;
}

/** One pass styled like the frontend EventTicketCard (stacked photo + accent QR). */
function frontendTicketPassHtml(opts: {
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  eventTime?: string | null;
  eventImageUrl?: string | null;
  organizerLogoUrl?: string | null;
  ticketTypeName: string;
  label: string;
  qrCode: string;
  accent: string;
  ticketStyle?: string | null;
  index: number;
  total: number;
}): string {
  const accent = opts.accent;
  const onAccent = inkOnHex(accent);
  const badgeBg = onAccent === '#ffffff' ? '#0a0a0a' : '#ffffff';
  const badgeFg = onAccent === '#ffffff' ? '#ffffff' : '#0a0a0a';
  const copy = layoutCopyFromStyle(opts.ticketStyle);
  const split = splitEventTitle(opts.eventTitle);
  const banner =
    opts.eventImageUrl?.trim() ||
    'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=1200&q=80';
  const qrImg = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&ecc=M&margin=8&data=${encodeURIComponent(
    opts.qrCode,
  )}`;
  const typeLabel =
    opts.total > 1
      ? `${opts.ticketTypeName} · ${opts.index + 1}/${opts.total}`
      : opts.ticketTypeName;
  const hostLogo = opts.organizerLogoUrl?.trim()
    ? `<img src="${opts.organizerLogoUrl.trim()}" width="36" height="36" alt="" style="display:block;border:0;outline:none;width:36px;height:36px;border-radius:8px;object-fit:cover;background:#ffffff;" />`
    : '';

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px 0;border-collapse:separate;border-spacing:0;border-radius:16px;overflow:hidden;border:1px solid #e5e7eb;background:#171717;">
      <!-- Photo header -->
      <tr>
        <td background="${banner}" bgcolor="#171717" style="background-image:url('${banner}');background-size:cover;background-position:center;background-color:#171717;">
          <!--[if gte mso 9]>
          <v:rect xmlns:v="urn:schemas-microsoft-com:vml" fill="true" stroke="false" style="width:552px;">
          <v:fill type="frame" src="${banner}" color="#171717" />
          <v:textbox style="mso-fit-shape-to-text:true" inset="0,0,0,0">
          <![endif]-->
          <div style="background:linear-gradient(to top, rgba(0,0,0,0.92) 0%, rgba(0,0,0,0.55) 55%, rgba(0,0,0,0.35) 100%);">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
              <tr>
                <td class="ticket-photo-pad" style="padding:14px 14px 16px 14px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
                    <tr>
                      <td style="vertical-align:middle;">
                        <p style="margin:0;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:rgba(255,255,255,0.7);font-family:${FONT};">
                          ${copy.headline}
                        </p>
                      </td>
                      ${
                        hostLogo
                          ? `<td align="right" width="40" style="vertical-align:middle;padding-left:8px;">${hostLogo}</td>`
                          : ''
                      }
                    </tr>
                  </table>
                  <p class="ticket-title" style="margin:10px 0 0 0;font-size:22px;font-weight:800;letter-spacing:-0.02em;line-height:1.15;text-transform:uppercase;font-family:${FONT};">
                    <span style="color:${accent};">${split.first}</span>${
                      split.rest
                        ? ` <span style="color:#ffffff;">${split.rest}</span>`
                        : ''
                    }
                  </p>
                  <p style="margin:10px 0 0 0;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);font-family:${FONT};">
                    ${copy.venueLabel}
                  </p>
                  <p style="margin:4px 0 0 0;font-size:13px;font-weight:700;line-height:1.35;color:#ffffff;font-family:${FONT};">
                    ${opts.eventLocation || 'Venue TBA'}
                  </p>
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:12px;border-collapse:collapse;border-top:1px solid rgba(255,255,255,0.12);">
                    <tr>
                      <td style="padding-top:10px;vertical-align:top;width:50%;">
                        <p style="margin:0;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);font-family:${FONT};">Date</p>
                        <p style="margin:4px 0 0 0;font-size:12px;font-weight:700;color:#ffffff;font-family:${FONT};">${opts.eventDate || 'TBA'}</p>
                      </td>
                      ${
                        opts.eventTime
                          ? `<td style="padding-top:10px;vertical-align:top;width:50%;">
                        <p style="margin:0;font-size:9px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:rgba(255,255,255,0.5);font-family:${FONT};">Time</p>
                        <p style="margin:4px 0 0 0;font-size:12px;font-weight:700;color:#ffffff;font-family:${FONT};">${opts.eventTime}</p>
                      </td>`
                          : ''
                      }
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </div>
          <!--[if gte mso 9]>
          </v:textbox></v:rect>
          <![endif]-->
        </td>
      </tr>
      <!-- Perforation -->
      <tr>
        <td bgcolor="#171717" style="padding:0;background-color:#171717;font-size:0;line-height:0;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">
            <tr>
              <td width="12" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>
              <td style="border-top:2px dashed rgba(255,255,255,0.35);font-size:0;line-height:0;height:2px;">&nbsp;</td>
              <td width="12" style="width:12px;font-size:0;line-height:0;">&nbsp;</td>
            </tr>
          </table>
        </td>
      </tr>
      <!-- Accent stub / QR -->
      <tr>
        <td class="ticket-stub-pad" bgcolor="${accent}" style="background-color:${accent};padding:14px 14px 16px 14px;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 10px auto;border-collapse:collapse;">
            <tr>
              <td bgcolor="${badgeBg}" style="background-color:${badgeBg};border-radius:999px;padding:5px 12px;">
                <p style="margin:0;font-size:10px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:${badgeFg};font-family:${FONT};">
                  ${typeLabel}
                </p>
              </td>
            </tr>
          </table>
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;border-collapse:collapse;background:#ffffff;border-radius:12px;">
            <tr>
              <td style="padding:8px;background:#ffffff;border-radius:12px;">
                <img
                  src="${qrImg}"
                  width="140"
                  height="140"
                  alt="QR for ${opts.label}"
                  style="display:block;margin:0 auto;border:0;outline:none;width:140px;height:140px;background:#ffffff;"
                />
              </td>
            </tr>
          </table>
          <p style="margin:12px 0 0 0;font-size:10px;font-weight:800;letter-spacing:0.14em;text-transform:uppercase;color:${onAccent};opacity:0.9;font-family:${FONT};">
            Do not share ticket
          </p>
          <p style="margin:4px 0 0 0;font-size:11px;font-weight:700;color:${onAccent};font-family:${FONT};">
            ${copy.sublabel}
          </p>
          <p style="margin:6px 0 0 0;font-size:11px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:${onAccent};opacity:0.75;">
            ${opts.label}
          </p>
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
    eventTime?: string | null;
    eventImageUrl?: string | null;
    organizerLogoUrl?: string | null;
  }
) => {
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
  const summaryTypes = mixedTypes ? typeNames.join(' · ') : ticketData.ticketType;

  const ticketCards = passes
    .map((pass, i) =>
      frontendTicketPassHtml({
        eventTitle: ticketData.eventTitle,
        eventDate: ticketData.eventDate,
        eventLocation: ticketData.eventLocation,
        eventTime: ticketData.eventTime,
        eventImageUrl: ticketData.eventImageUrl,
        organizerLogoUrl: ticketData.organizerLogoUrl,
        ticketTypeName: pass.ticketType || ticketData.ticketType,
        label: pass.label,
        qrCode: pass.qrCode,
        accent: resolveAccent(ticketData.ticketStyle, pass.accentColor || ticketData.accentColor),
        ticketStyle: ticketData.ticketStyle,
        index: i,
        total: passes.length,
      }),
    )
    .join('');

  const passListText = passes
    .map(
      (p, i) =>
        `  ${i + 1}. [${p.ticketType || ticketData.ticketType}] ${p.label} — QR: ${p.qrCode}`,
    )
    .join('\n');

  return {
    subject: `Your tickets for ${ticketData.eventTitle}`,
    html: emailLayout({
      eyebrow: 'Tickets',
      preheader: `Your tickets for ${ticketData.eventTitle} are ready.`,
      reason: `Ticket confirmation for ${userEmail}.`,
      bodyHtml: `
        <h1 style="margin:0 0 6px 0;font-size:24px;font-weight:700;letter-spacing:-0.03em;line-height:1.2;font-family:${FONT};color:#14171e;text-align:center;">
          You're in
        </h1>
        <p style="margin:0 auto 14px auto;max-width:400px;font-size:13px;line-height:1.45;color:#71717a;text-align:center;">
          ${ticketData.eventTitle}${mixedTypes ? ` · ${summaryTypes}` : ''} · ${ticketData.quantity} pass${
            ticketData.quantity === 1 ? '' : 'es'
          } · ₦${Number(ticketData.totalPrice || 0).toLocaleString()}
        </p>
        ${ticketCards}
        <p style="margin:0 0 8px 0;font-size:12px;color:#a1a1aa;text-align:center;">
          PDF attached · do not share your QR
        </p>
        ${emailButton(`${SITE_URL}/my-tickets`, 'View my tickets')}
      `,
    }),
    text: `Your ticket(s) for ${ticketData.eventTitle} are confirmed.
${passListText}
Date: ${ticketData.eventDate}
Venue: ${ticketData.eventLocation}
Qty: ${ticketData.quantity} · Total: ₦${Number(ticketData.totalPrice || 0).toLocaleString()}
PDF ticket(s) attached for download.
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

const escapeHtml = (value: string) =>
  String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Inbox for new host applications (falls back to support / SMTP user). */
export function getAdminNotifyEmail(): string | null {
  const addr = (
    process.env.ADMIN_NOTIFY_EMAIL ||
    process.env.SUPPORT_EMAIL ||
    process.env.EMAIL_USER ||
    ''
  ).trim();
  return addr || null;
}

export const generateHostApplicationReceivedEmail = (data: {
  firstName: string;
  organizationName: string;
}) => {
  const name = escapeHtml(data.firstName || 'there');
  const org = escapeHtml(data.organizationName);
  return {
    subject: 'We received your host application',
    html: emailLayout({
      eyebrow: 'Host application',
      preheader: `Your application for ${data.organizationName} is in review.`,
      bodyHtml: `
        ${emailCard(
          `
          <p style="margin:0 0 16px 0;font-size:13px;line-height:1.5;font-weight:500;color:#7b7d81;text-align:center;font-family:${FONT};">
            Application received
          </p>
          <h1 style="margin:0 0 16px 0;font-size:32px;font-weight:600;letter-spacing:-0.64px;line-height:1.15;font-family:${FONT};color:#14171e;text-align:center;">
            You&apos;re on the host list
          </h1>
          <p style="margin:0 auto;max-width:420px;font-size:16px;line-height:1.5;color:#43454b;text-align:center;font-family:${FONT};">
            Hi ${name}, we received your application for <strong>${org}</strong>. Our team will review it and email you when it&apos;s approved or if we need more detail.
          </p>
          ${emailButton(`${SITE_URL}/organizer`, 'Open organizer dashboard')}
          `,
          { padding: '32px 20px 36px 20px', align: 'center' }
        )}
      `,
    }),
    text: `Hi ${data.firstName || 'there'}, we received your PartyStorm host application for ${data.organizationName}. We'll email you once it's reviewed.\n\n${SITE_URL}/organizer`,
  };
};

export const generateHostApplicationAdminNoticeEmail = (data: {
  firstName: string;
  lastName: string;
  email: string;
  organizationName: string;
  description?: string | null;
  contactInfo?: string | null;
}) => {
  const org = escapeHtml(data.organizationName);
  const applicant = escapeHtml(`${data.firstName} ${data.lastName}`.trim());
  const email = escapeHtml(data.email);
  const description = data.description?.trim()
    ? escapeHtml(data.description.trim())
    : '—';
  const contact = data.contactInfo?.trim() ? escapeHtml(data.contactInfo.trim()) : '—';
  return {
    subject: `New host application: ${data.organizationName}`,
    html: emailLayout({
      eyebrow: 'Admin',
      preheader: `${data.firstName} applied to host as ${data.organizationName}`,
      bodyHtml: `
        ${emailCard(
          `
          <h1 style="margin:0 0 16px 0;font-size:28px;font-weight:600;letter-spacing:-0.5px;line-height:1.2;font-family:${FONT};color:#14171e;text-align:left;">
            New host to review
          </h1>
          <p style="margin:0 0 8px 0;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;">Organization</p>
          <p style="margin:0 0 16px 0;font-size:16px;font-weight:600;color:#14171e;">${org}</p>
          <p style="margin:0 0 8px 0;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;">Applicant</p>
          <p style="margin:0 0 16px 0;font-size:15px;color:#43454b;">${applicant}<br/>${email}</p>
          <p style="margin:0 0 8px 0;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;">About</p>
          <p style="margin:0 0 16px 0;font-size:15px;line-height:1.5;color:#43454b;white-space:pre-wrap;">${description}</p>
          <p style="margin:0 0 8px 0;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;">Contact</p>
          <p style="margin:0;font-size:15px;color:#43454b;">${contact}</p>
          ${emailButton(`${SITE_URL}/admin/organizations`, 'Review applications')}
          `,
          { padding: '28px 20px 32px 20px', align: 'left' }
        )}
      `,
    }),
    text: `New host application: ${data.organizationName}\nApplicant: ${data.firstName} ${data.lastName} <${data.email}>\nAbout: ${data.description || '—'}\nContact: ${data.contactInfo || '—'}\n\n${SITE_URL}/admin/organizations`,
  };
};

export const generateHostApplicationApprovedEmail = (data: {
  firstName: string;
  organizationName: string;
}) => {
  const name = escapeHtml(data.firstName || 'there');
  const org = escapeHtml(data.organizationName);
  return {
    subject: 'Your PartyStorm host account is approved',
    html: emailLayout({
      eyebrow: 'Host approved',
      preheader: `${data.organizationName} is verified. You can publish events.`,
      bodyHtml: `
        ${emailCard(
          `
          <h1 style="margin:0 0 16px 0;font-size:32px;font-weight:600;letter-spacing:-0.64px;line-height:1.15;font-family:${FONT};color:#14171e;text-align:center;">
            You&apos;re verified
          </h1>
          <p style="margin:0 auto;max-width:420px;font-size:16px;line-height:1.5;color:#43454b;text-align:center;font-family:${FONT};">
            Hi ${name}, <strong>${org}</strong> is approved. You can publish events, sell tickets, and get paid through PartyStorm.
          </p>
          ${emailButton(`${SITE_URL}/organizer/events/create`, 'Create an event', { variant: 'rose' })}
          `,
          { padding: '32px 20px 36px 20px', align: 'center' }
        )}
      `,
    }),
    text: `Hi ${data.firstName || 'there'}, ${data.organizationName} is approved on PartyStorm. Create an event: ${SITE_URL}/organizer/events/create`,
  };
};

export const generateHostApplicationRejectedEmail = (data: {
  firstName: string;
  organizationName: string;
  reason: string;
}) => {
  const name = escapeHtml(data.firstName || 'there');
  const org = escapeHtml(data.organizationName);
  const reason = escapeHtml(data.reason);
  return {
    subject: 'Update on your PartyStorm host application',
    html: emailLayout({
      eyebrow: 'Host application',
      preheader: `We could not approve ${data.organizationName} yet.`,
      bodyHtml: `
        ${emailCard(
          `
          <h1 style="margin:0 0 16px 0;font-size:28px;font-weight:600;letter-spacing:-0.5px;line-height:1.2;font-family:${FONT};color:#14171e;text-align:center;">
            Application not approved
          </h1>
          <p style="margin:0 auto 20px auto;max-width:420px;font-size:16px;line-height:1.5;color:#43454b;text-align:center;font-family:${FONT};">
            Hi ${name}, we reviewed <strong>${org}</strong> and cannot verify it yet.
          </p>
          <p style="margin:0 0 8px 0;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.06em;text-align:left;">Reason</p>
          <p style="margin:0;font-size:15px;line-height:1.5;color:#43454b;white-space:pre-wrap;text-align:left;">${reason}</p>
          ${emailButton(`${SITE_URL}/become-organizer`, 'Update and resubmit')}
          `,
          { padding: '32px 20px 36px 20px', align: 'center' }
        )}
      `,
    }),
    text: `Hi ${data.firstName || 'there'}, we could not approve ${data.organizationName} yet.\n\nReason: ${data.reason}\n\nUpdate and resubmit: ${SITE_URL}/become-organizer`,
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

export const generateMultiDayCheckInEmail = (data: {
  attendeeName?: string;
  orgName: string;
  eventTitle: string;
  checkInDay: string;
  ticketTypeName: string;
  qrCode: string;
  location?: string | null;
  startDate: string;
  endDate: string;
  isAllDaysPass: boolean;
  ticketsUrl: string;
}) => {
  const greet = data.attendeeName?.trim() || 'there';
  const subject = `Entry Confirmed: ${data.eventTitle} (${data.checkInDay})`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(data.qrCode)}`;

  return {
    subject,
    html: emailLayout({
      eyebrow: `Gate Check-In · ${data.orgName}`,
      preheader: `You are checked in for ${data.checkInDay} at ${data.eventTitle}.`,
      reason: `You received this email because your ticket was scanned at the gate for ${data.eventTitle}.`,
      bodyHtml: `
        ${emailHeroTitle("You're Checked In!", 'Gate Check-In Confirmed')}
        <p style="margin:0 auto 16px auto;max-width:440px;font-size:15px;line-height:1.55;color:#43454b;text-align:center;">
          Hi <strong>${greet}</strong>, you've successfully checked in for <strong>${data.checkInDay}</strong> at <strong>${data.eventTitle}</strong>.
        </p>

        <!-- Ticket Check-In Card -->
        <div style="background-color:#ffffff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;margin:20px 0;box-shadow:0 1px 3px rgba(0,0,0,0.04);">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td style="padding-bottom:12px;border-bottom:1px solid #f3f4f6;">
                <span style="font-size:11px;font-weight:700;color:#f43f5e;text-transform:uppercase;letter-spacing:0.5px;">Event</span>
                <p style="margin:2px 0 0 0;font-size:16px;font-weight:800;color:#111827;">${data.eventTitle}</p>
                <p style="margin:2px 0 0 0;font-size:13px;color:#6b7280;">Hosted by ${data.orgName}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                  <tr>
                    <td style="vertical-align:top;width:50%;">
                      <span style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Checked In For</span>
                      <p style="margin:2px 0 0 0;font-size:14px;font-weight:700;color:#059669;">${data.checkInDay}</p>
                    </td>
                    <td style="vertical-align:top;width:50%;">
                      <span style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Ticket Tier</span>
                      <p style="margin:2px 0 0 0;font-size:14px;font-weight:700;color:#111827;">${data.ticketTypeName}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            ${
              data.location
                ? `<tr>
              <td style="padding:12px 0;border-bottom:1px solid #f3f4f6;">
                <span style="font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px;">Venue / Location</span>
                <p style="margin:2px 0 0 0;font-size:14px;font-weight:600;color:#374151;">${data.location}</p>
              </td>
            </tr>`
                : ''
            }
          </table>

          ${
            data.isAllDaysPass
              ? `<div style="margin-top:16px;padding:12px 14px;background-color:#ecfdf5;border:1px solid #a7f3d0;border-radius:10px;">
                  <p style="margin:0;font-size:13px;line-height:1.5;color:#065f46;">
                    <strong>Multi-Day Pass Notice:</strong> Your pass is valid for the full event duration (${data.startDate} – ${data.endDate}). Please keep your QR pass handy for gate entry tomorrow and upcoming days!
                  </p>
                </div>`
              : `<div style="margin-top:16px;padding:12px 14px;background-color:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;">
                  <p style="margin:0;font-size:13px;line-height:1.5;color:#4b5563;">
                    Enjoy today's event! If you need any assistance, speak to event staff at the gate or information desk.
                  </p>
                </div>`
          }

          <!-- QR Code Display -->
          <div style="text-align:center;padding-top:20px;">
            <p style="margin:0 0 8px 0;font-size:12px;font-weight:600;color:#6b7280;">Your Pass QR Code</p>
            <img src="${qrUrl}" alt="Ticket QR Pass" width="160" height="160" style="display:inline-block;border-radius:10px;border:1px solid #e5e7eb;padding:6px;background:#ffffff;" />
            <p style="margin:6px 0 0 0;font-family:monospace;font-size:12px;color:#9ca3af;">${data.qrCode}</p>
          </div>
        </div>

        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0;">
          <tr>
            <td align="center">
              ${emailButton(data.ticketsUrl, 'View My Tickets on PartyStorm')}
            </td>
          </tr>
        </table>
      `,
    }),
    text: `Hi ${greet},\n\nYou're checked in for ${data.checkInDay} at ${data.eventTitle}.\nTicket Tier: ${data.ticketTypeName}\n${data.location ? `Venue: ${data.location}\n` : ''}${
      data.isAllDaysPass
        ? `Multi-day Pass: Your ticket remains valid for all event days (${data.startDate} – ${data.endDate}). Keep your pass for upcoming days!\n`
        : ''
    }\nQR Code: ${data.qrCode}\nView tickets: ${data.ticketsUrl}`,
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
  'host-received',
  'host-admin',
  'host-approved',
  'host-rejected',
  'multiday-checkin',
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
        eventDate: '15TH | AUGUST | 2026',
        eventTime: '8:00 PM',
        eventLocation: 'Eko Convention Centre, Lagos',
        eventImageUrl:
          'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=1200&q=80',
        organizerLogoUrl:
          'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=100&q=80',
        ticketType: 'VIP',
        quantity: 3,
        totalPrice: 35000,
        ticketStyle: 'classic-rose',
        accentColor: '#d85060',
        passes: [
          {
            label: 'TKT-000042',
            qrCode: 'QR-PREVIEW-VIP-000042',
            ticketType: 'VIP',
            accentColor: '#d85060',
          },
          {
            label: 'TKT-000043',
            qrCode: 'QR-PREVIEW-VIP-000043',
            ticketType: 'VIP',
            accentColor: '#d85060',
          },
          {
            label: 'TKT-000044',
            qrCode: 'QR-PREVIEW-REG-000044',
            ticketType: 'Regular',
            accentColor: '#0284c7',
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
    case 'host-received':
      return generateHostApplicationReceivedEmail({
        firstName: 'Ada',
        organizationName: 'Kano Live',
      });
    case 'host-admin':
      return generateHostApplicationAdminNoticeEmail({
        firstName: 'Ada',
        lastName: 'Bello',
        email: 'ada@example.com',
        organizationName: 'Kano Live',
        description: 'Nightlife and live music in Kano.',
        contactInfo: 'https://kanolive.ng',
      });
    case 'host-approved':
      return generateHostApplicationApprovedEmail({
        firstName: 'Ada',
        organizationName: 'Kano Live',
      });
    case 'host-rejected':
      return generateHostApplicationRejectedEmail({
        firstName: 'Ada',
        organizationName: 'Kano Live',
        reason: 'Please add a public website or Instagram and a clear business description, then resubmit.',
      });
    case 'multiday-checkin':
      return generateMultiDayCheckInEmail({
        attendeeName: 'Ada Lovelace',
        orgName: 'Lagos Tech Week',
        eventTitle: 'Lagos Tech Week 2026',
        checkInDay: 'Saturday, Aug 15, 2026',
        ticketTypeName: 'All Access VIP Pass',
        qrCode: 'QR-PASS-MULTIDAY-001',
        location: 'Landmark Centre, Victoria Island, Lagos',
        startDate: 'Friday, Aug 14, 2026',
        endDate: 'Sunday, Aug 16, 2026',
        isAllDaysPass: true,
        ticketsUrl: `${SITE_URL}/my-tickets`,
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
  generateHostApplicationReceivedEmail,
  generateHostApplicationAdminNoticeEmail,
  generateHostApplicationApprovedEmail,
  generateHostApplicationRejectedEmail,
  generateVendorApplicationEmail,
  generateStaffInviteEmail,
  generateOrganizerMessageEmail,
  generateMultiDayCheckInEmail,
  generateSupportReceivedEmail,
  generateSupportReplyEmail,
  generateSupportResolvedEmail,
  getEmailPreview,
  EMAIL_PREVIEW_IDS,
};
