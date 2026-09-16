import { Request, Response } from 'express';
import { prisma } from '../prisma';
import {
  applyWebhookStatuses,
  getWhatsAppConfig,
  sendTicketWhatsApp,
  testWhatsAppConnection,
  updateWhatsAppConfig,
  verifyWebhookSignature,
  webhookVerifyToken,
} from '../services/whatsapp';

export const verifyWhatsAppWebhook = (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  const expected = webhookVerifyToken();
  if (!expected) {
    console.error('[WhatsApp] Webhook verify token is not configured');
    res.sendStatus(403);
    return;
  }
  if (mode === 'subscribe' && token === expected) {
    res.status(200).send(challenge);
    return;
  }
  res.sendStatus(403);
};

export const receiveWhatsAppWebhook = async (req: Request, res: Response) => {
  const raw = (req as any).rawBody as Buffer | undefined;
  const signature = req.header('x-hub-signature-256') || undefined;
  if (!raw || !verifyWebhookSignature(raw, signature)) {
    console.error('[WhatsApp] Rejected webhook with invalid signature');
    res.sendStatus(401);
    return;
  }
  res.sendStatus(200);
  try {
    await applyWebhookStatuses(req.body);
  } catch (err) {
    console.error('[WhatsApp] Webhook processing failed:', err);
  }
};

export const getWhatsAppAdminConfig = async (_req: Request, res: Response) => {
  const config = await getWhatsAppConfig();
  res.json(config);
};

export const putWhatsAppAdminConfig = async (req: Request, res: Response) => {
  const config = await updateWhatsAppConfig(req.body || {});
  res.json(config);
};

export const getWhatsAppMessages = async (req: Request, res: Response) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const messages = await prisma.whatsAppMessage.findMany({
    where: status && status !== 'all' ? { status: status as any } : undefined,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(messages);
};

export const retryWhatsAppMessage = async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const message = await prisma.whatsAppMessage.findUnique({ where: { id } });
  if (!message) {
    res.status(404).json({ message: 'WhatsApp message not found' });
    return;
  }
  if (message.kind !== 'TICKET' || !message.ticketId) {
    res.status(400).json({ message: 'Only ticket deliveries can be retried' });
    return;
  }
  if (message.attempts >= 5) {
    res.status(400).json({ message: 'Retry limit reached' });
    return;
  }
  const ticket = await prisma.ticket.findUnique({
    where: { id: message.ticketId },
    include: { event: true, ticketType: true },
  });
  if (!ticket?.qrCode) {
    res.status(404).json({ message: 'Ticket no longer has a QR code' });
    return;
  }
  const result = await sendTicketWhatsApp({
    phone: message.toPhone,
    eventTitle: ticket.event.title,
    eventWhen: ticket.event.startDate
      ? new Date(ticket.event.startDate).toLocaleDateString()
      : 'TBA',
    eventLocation: ticket.event.location || 'TBA',
    ticketLabel: `TKT-${ticket.id.toString().padStart(6, '0')}`,
    ticketType: ticket.ticketType?.name || 'Ticket',
    qrCode: ticket.qrCode,
    orderId: message.orderId,
    ticketId: ticket.id,
    messageId: message.id,
  });
  res.json(result);
};

export const testWhatsAppAdminConnection = async (_req: Request, res: Response) => {
  const result = await testWhatsAppConnection();
  res.status(result.ok ? 200 : 400).json(result);
};
