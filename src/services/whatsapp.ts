import crypto from 'crypto';
import QRCode from 'qrcode';
import { prisma } from '../prisma';
import { normalizePhone } from '../utils/validation';

export type WhatsAppPublicConfig = {
  enabled: boolean;
  sendTickets: boolean;
  sendOtp: boolean;
  ticketTemplate: string;
  otpTemplate: string;
  templateLanguage: string;
  currency: string;
  ticketPrice: number;
  otpPrice: number;
  credentialsConfigured: boolean;
  phoneNumberIdSet: boolean;
  businessAccountIdSet: boolean;
  appIdSet: boolean;
  webhookVerifyTokenSet: boolean;
  appSecretSet: boolean;
  apiVersion: string;
  source: 'db';
};

type GraphError = Error & { status?: number; retryable?: boolean };

function envFlag(name: string, fallback: boolean) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function secrets() {
  return {
    token: process.env.WHATSAPP_ACCESS_TOKEN?.trim() || process.env.WHATSAPP_TOKEN?.trim() || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || '',
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || '',
    appId: process.env.META_APP_ID?.trim() || '',
    appSecret: process.env.META_APP_SECRET?.trim() || process.env.WHATSAPP_APP_SECRET?.trim() || '',
    verifyToken:
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN?.trim() ||
      process.env.WHATSAPP_VERIFY_TOKEN?.trim() ||
      '',
    apiVersion: process.env.WHATSAPP_API_VERSION?.trim() || 'v21.0',
  };
}

function seedDefaults() {
  const env = secrets();
  const credentialsConfigured = Boolean(env.token && env.phoneNumberId);
  return {
    enabled: envFlag('WHATSAPP_ENABLED', credentialsConfigured),
    sendTickets: envFlag('WHATSAPP_SEND_TICKETS', true),
    sendOtp: envFlag('WHATSAPP_SEND_OTP', true),
    ticketTemplate: process.env.WHATSAPP_TICKET_TEMPLATE?.trim() || 'partystorm_ticket_confirm',
    otpTemplate: process.env.WHATSAPP_OTP_TEMPLATE?.trim() || 'partystorm_otp',
    templateLanguage: process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || 'en',
    currency: 'NGN',
    ticketPrice: 10,
    otpPrice: 10,
  };
}

function money(value: unknown, fallback: number) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0) return fallback;
  return Math.round(amount * 100) / 100;
}

export function toGraphPhone(phone: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return normalized.replace(/^\+/, '');
}

function publicConfig(row: {
  enabled: boolean;
  sendTickets: boolean;
  sendOtp: boolean;
  ticketTemplate: string;
  otpTemplate: string;
  templateLanguage: string;
  currency: string;
  ticketPrice: number;
  otpPrice: number;
}): WhatsAppPublicConfig {
  const env = secrets();
  return {
    enabled: row.enabled,
    sendTickets: row.sendTickets,
    sendOtp: row.sendOtp,
    ticketTemplate: row.ticketTemplate,
    otpTemplate: row.otpTemplate,
    templateLanguage: row.templateLanguage,
    currency: row.currency,
    ticketPrice: row.ticketPrice,
    otpPrice: row.otpPrice,
    credentialsConfigured: Boolean(env.token && env.phoneNumberId),
    phoneNumberIdSet: Boolean(env.phoneNumberId),
    businessAccountIdSet: Boolean(env.businessAccountId),
    appIdSet: Boolean(env.appId),
    webhookVerifyTokenSet: Boolean(env.verifyToken),
    appSecretSet: Boolean(env.appSecret),
    apiVersion: env.apiVersion,
    source: 'db',
  };
}

export async function getWhatsAppConfig(): Promise<WhatsAppPublicConfig> {
  const defaults = seedDefaults();
  const row = await prisma.whatsAppConfig.upsert({
    where: { id: 1 },
    update: {},
    create: { id: 1, ...defaults },
  });
  return publicConfig(row);
}

export async function updateWhatsAppConfig(input: {
  enabled?: boolean;
  sendTickets?: boolean;
  sendOtp?: boolean;
  ticketTemplate?: string;
  otpTemplate?: string;
  templateLanguage?: string;
  currency?: string;
  ticketPrice?: number;
  otpPrice?: number;
}) {
  const clean = (value: unknown, fallback: string) => {
    const text = String(value ?? '').trim();
    return text.slice(0, 80) || fallback;
  };
  const defaults = seedDefaults();
  const row = await prisma.whatsAppConfig.upsert({
    where: { id: 1 },
    update: {
      ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}),
      ...(typeof input.sendTickets === 'boolean' ? { sendTickets: input.sendTickets } : {}),
      ...(typeof input.sendOtp === 'boolean' ? { sendOtp: input.sendOtp } : {}),
      ...(input.ticketTemplate != null
        ? { ticketTemplate: clean(input.ticketTemplate, defaults.ticketTemplate) }
        : {}),
      ...(input.otpTemplate != null ? { otpTemplate: clean(input.otpTemplate, defaults.otpTemplate) } : {}),
      ...(input.templateLanguage != null
        ? { templateLanguage: clean(input.templateLanguage, defaults.templateLanguage) }
        : {}),
      ...(input.currency != null ? { currency: clean(input.currency, defaults.currency).toUpperCase() } : {}),
      ...(input.ticketPrice != null ? { ticketPrice: money(input.ticketPrice, defaults.ticketPrice) } : {}),
      ...(input.otpPrice != null ? { otpPrice: money(input.otpPrice, defaults.otpPrice) } : {}),
    },
    create: {
      id: 1,
      enabled: typeof input.enabled === 'boolean' ? input.enabled : defaults.enabled,
      sendTickets: typeof input.sendTickets === 'boolean' ? input.sendTickets : defaults.sendTickets,
      sendOtp: typeof input.sendOtp === 'boolean' ? input.sendOtp : defaults.sendOtp,
      ticketTemplate: clean(input.ticketTemplate, defaults.ticketTemplate),
      otpTemplate: clean(input.otpTemplate, defaults.otpTemplate),
      templateLanguage: clean(input.templateLanguage, defaults.templateLanguage),
      currency: clean(input.currency, defaults.currency).toUpperCase(),
      ticketPrice: money(input.ticketPrice, defaults.ticketPrice),
      otpPrice: money(input.otpPrice, defaults.otpPrice),
    },
  });
  return publicConfig(row);
}

function graphError(message: string, status?: number): GraphError {
  const err = new Error(message) as GraphError;
  err.status = status;
  err.retryable = status === 429 || (status != null && status >= 500);
  return err;
}

async function graphFetch(path: string, init: RequestInit) {
  const env = secrets();
  if (!env.token || !env.phoneNumberId) {
    throw graphError('WhatsApp Cloud API credentials are not configured');
  }
  const url = `https://graph.facebook.com/${env.apiVersion}/${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.token}`,
      ...(init.headers || {}),
    },
  });
  const body = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    const message = body?.error?.message || `WhatsApp API error (${response.status})`;
    throw graphError(message, response.status);
  }
  return body;
}

async function uploadQrImage(png: Buffer) {
  const env = secrets();
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/png');
  form.append('file', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'ticket-qr.png');
  const body = await graphFetch(`${env.phoneNumberId}/media`, { method: 'POST', body: form });
  if (!body?.id) throw graphError('WhatsApp media upload did not return an id');
  return String(body.id);
}

async function sendTemplate(to: string, name: string, language: string, components: unknown[]) {
  const env = secrets();
  const body = await graphFetch(`${env.phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'template',
      template: { name, language: { code: language }, components },
    }),
  });
  const wamid = body?.messages?.[0]?.id as string | undefined;
  if (!wamid) throw graphError('WhatsApp did not return a message id');
  return wamid;
}

export async function testWhatsAppConnection() {
  const env = secrets();
  if (!env.token || !env.phoneNumberId) {
    return { ok: false, message: 'Set WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID on the server.' };
  }
  try {
    const body = (await graphFetch(
      `${env.phoneNumberId}?fields=display_phone_number,verified_name`,
      { method: 'GET' }
    )) as any;
    return {
      ok: true,
      displayPhoneNumber: body.display_phone_number || null,
      verifiedName: body.verified_name || null,
      businessAccountIdSet: Boolean(env.businessAccountId),
    };
  } catch (err: any) {
    return { ok: false, message: err?.message || 'Connection failed' };
  }
}

export async function sendTicketWhatsApp(params: {
  phone: string;
  eventTitle: string;
  eventWhen: string;
  eventLocation: string;
  ticketLabel: string;
  ticketType: string;
  qrCode: string;
  orderId?: number | null;
  ticketId?: number | null;
  messageId?: number;
}) {
  const config = await getWhatsAppConfig();
  if (!config.enabled || !config.sendTickets) return { skipped: true as const };
  if (!config.credentialsConfigured) {
    console.warn('[WhatsApp] Ticket send skipped: credentials missing');
    return { skipped: true as const };
  }

  const to = toGraphPhone(params.phone);
  if (!to) return { skipped: true as const };

  const record = params.messageId
    ? await prisma.whatsAppMessage.update({
        where: { id: params.messageId },
        data: { attempts: { increment: 1 }, status: 'QUEUED', lastError: null },
      })
    : await prisma.whatsAppMessage.create({
        data: {
          kind: 'TICKET',
          toPhone: to,
          templateName: config.ticketTemplate,
          status: 'QUEUED',
          orderId: params.orderId ?? null,
          ticketId: params.ticketId ?? null,
          attempts: 1,
          price: config.ticketPrice,
          currency: config.currency,
        },
      });

  try {
    const png = await QRCode.toBuffer(params.qrCode, { type: 'png', width: 512, margin: 1 });
    const mediaId = await uploadQrImage(png);
    const detail = `${params.eventWhen} · ${params.eventLocation}`.slice(0, 200);
    const pass = `${params.ticketType} · ${params.ticketLabel}`.slice(0, 200);
    const wamid = await sendTemplate(to, config.ticketTemplate, config.templateLanguage, [
      { type: 'header', parameters: [{ type: 'image', image: { id: mediaId } }] },
      {
        type: 'body',
        parameters: [
          { type: 'text', text: params.eventTitle.slice(0, 200) },
          { type: 'text', text: detail },
          { type: 'text', text: pass },
        ],
      },
    ]);
    await prisma.whatsAppMessage.update({
      where: { id: record.id },
      data: { status: 'SENT', wamid, lastError: null },
    });
    console.log(`[WhatsApp] Ticket template sent to ${to} (${wamid})`);
    return { skipped: false as const, id: record.id, wamid };
  } catch (err: any) {
    const message = err?.message || 'WhatsApp send failed';
    await prisma.whatsAppMessage.update({
      where: { id: record.id },
      data: { status: 'FAILED', lastError: message.slice(0, 2000) },
    });
    console.error('[WhatsApp] Ticket send failed:', message);
    return { skipped: false as const, id: record.id, error: message };
  }
}

export async function sendWhatsAppOtp(phone: string, code: string) {
  const config = await getWhatsAppConfig();
  if (!config.enabled || !config.sendOtp) {
    throw graphError('WhatsApp OTP is turned off');
  }
  if (!config.credentialsConfigured) {
    throw graphError('WhatsApp Cloud API credentials are not configured');
  }
  const to = toGraphPhone(phone);
  if (!to) throw graphError('Invalid phone number');

  const record = await prisma.whatsAppMessage.create({
    data: {
      kind: 'OTP',
      toPhone: to,
      templateName: config.otpTemplate,
      status: 'QUEUED',
      attempts: 1,
      price: config.otpPrice,
      currency: config.currency,
    },
  });

  try {
    const wamid = await sendTemplate(to, config.otpTemplate, config.templateLanguage, [
      { type: 'body', parameters: [{ type: 'text', text: code }] },
      {
        type: 'button',
        sub_type: 'url',
        index: '0',
        parameters: [{ type: 'text', text: code }],
      },
    ]);
    await prisma.whatsAppMessage.update({
      where: { id: record.id },
      data: { status: 'SENT', wamid },
    });
    console.log(`[WhatsApp] OTP template sent to ${to}`);
    return true;
  } catch (err: any) {
    const message = err?.message || 'WhatsApp OTP failed';
    await prisma.whatsAppMessage.update({
      where: { id: record.id },
      data: { status: 'FAILED', lastError: message.slice(0, 2000) },
    });
    console.error('[WhatsApp] OTP send failed:', message);
    throw graphError(message, err?.status);
  }
}

/** Send tickets that do not already have a queued or successful WhatsApp delivery. */
export async function deliverUnsentTicketsViaWhatsApp(params: {
  phone?: string | null;
  orderId?: number | null;
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  tickets: Array<{ id: number; qrCode: string; ticketTypeName?: string | null }>;
}) {
  const withQr = params.tickets.filter((ticket) => ticket.qrCode);
  if (!params.phone || withQr.length === 0) return;
  const existing = await prisma.whatsAppMessage.findMany({
    where: {
      kind: 'TICKET',
      ticketId: { in: withQr.map((ticket) => ticket.id) },
      status: { in: ['QUEUED', 'SENT', 'DELIVERED', 'READ'] },
    },
    select: { ticketId: true },
  });
  const covered = new Set(existing.map((row) => row.ticketId));
  const missing = withQr.filter((ticket) => !covered.has(ticket.id));
  if (missing.length === 0) return;
  await deliverTicketsViaWhatsApp({ ...params, tickets: missing });
}

export async function deliverTicketsViaWhatsApp(params: {
  phone?: string | null;
  orderId?: number | null;
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  tickets: Array<{ id: number; qrCode: string; ticketTypeName?: string | null }>;
}) {
  if (!params.phone || params.tickets.length === 0) return;
  for (const ticket of params.tickets) {
    if (!ticket.qrCode) continue;
    await sendTicketWhatsApp({
      phone: params.phone,
      eventTitle: params.eventTitle,
      eventWhen: params.eventDate,
      eventLocation: params.eventLocation,
      ticketLabel: `TKT-${ticket.id.toString().padStart(6, '0')}`,
      ticketType: ticket.ticketTypeName || 'Ticket',
      qrCode: ticket.qrCode,
      orderId: params.orderId,
      ticketId: ticket.id,
    });
  }
}

export function verifyWebhookSignature(rawBody: Buffer, signatureHeader?: string) {
  const secret = secrets().appSecret;
  if (!secret || !signatureHeader) return false;
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;
  const left = Buffer.from(expected);
  const right = Buffer.from(signatureHeader);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function webhookVerifyToken() {
  return secrets().verifyToken;
}

export async function applyWebhookStatuses(payload: any) {
  const entries = Array.isArray(payload?.entry) ? payload.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const statuses = change?.value?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const status of statuses) {
        const wamid = status?.id;
        if (!wamid) continue;
        const mapped =
          status.status === 'read'
            ? 'READ'
            : status.status === 'delivered'
              ? 'DELIVERED'
              : status.status === 'sent'
                ? 'SENT'
                : status.status === 'failed'
                  ? 'FAILED'
                  : null;
        if (!mapped) continue;
        const errorText = status.errors?.[0]?.title || status.errors?.[0]?.message || null;
        await prisma.whatsAppMessage.updateMany({
          where: { wamid },
          data: {
            status: mapped,
            ...(errorText ? { lastError: String(errorText).slice(0, 2000) } : {}),
          },
        });
        if (mapped === 'FAILED') {
          console.error(`[WhatsApp] Delivery failed for ${wamid}: ${errorText || 'unknown'}`);
        }
      }
    }
  }
}
