import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import {
  sendEmail,
  generateSupportReceivedEmail,
} from '../services/email';

const frontendBase = () =>
  (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/$/, '');

const isValidEmail = (email: string) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim());

export const createSupportTicket = async (req: AuthRequest, res: Response) => {
  try {
    const { subject, body, category, contactEmail, contactName } = req.body;

    if (!subject?.trim() || !body?.trim()) {
      return res.status(400).json({ message: 'Subject and message are required' });
    }

    let email =
      (typeof contactEmail === 'string' && contactEmail.trim()) ||
      (req.userId
        ? (
            await prisma.user.findUnique({
              where: { id: req.userId },
              select: { email: true },
            })
          )?.email
        : null);

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        message: 'A valid contact email is required so we can reply to you.',
      });
    }

    email = email.trim().toLowerCase();

    let name = typeof contactName === 'string' ? contactName.trim() : '';
    if (!name && req.userId) {
      const user = await prisma.user.findUnique({
        where: { id: req.userId },
        select: { firstName: true, lastName: true },
      });
      if (user) name = `${user.firstName} ${user.lastName}`.trim();
    }

    const ticket = await prisma.supportTicket.create({
      data: {
        userId: req.userId ?? null,
        contactEmail: email,
        contactName: name || null,
        subject: subject.trim(),
        category: category || 'GENERAL',
        messages: {
          create: {
            authorId: req.userId ?? null,
            authorRole: req.userId ? 'USER' : 'GUEST',
            body: body.trim(),
          },
        },
      },
      include: {
        messages: true,
      },
    });

    const tpl = generateSupportReceivedEmail({
      name: name || null,
      subject: ticket.subject,
      ticketId: ticket.id,
      supportUrl: `${frontendBase()}/support`,
    });
    void sendEmail({ to: email, subject: tpl.subject, html: tpl.html, text: tpl.text });

    return res.status(201).json({
      message: 'Support ticket created',
      ticket,
      emailSent: true,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getMySupportTickets = async (req: AuthRequest, res: Response) => {
  try {
    const me = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { email: true },
    });
    const tickets = await prisma.supportTicket.findMany({
      where: {
        OR: [
          { userId: req.userId! },
          ...(me?.email ? [{ contactEmail: me.email }] : []),
        ],
      },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, createdAt: true, authorRole: true },
        },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return res.json(tickets);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getMySupportTicketById = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { email: true },
    });

    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id,
        OR: [
          { userId: req.userId! },
          ...(user?.email ? [{ contactEmail: user.email }] : []),
        ],
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            author: { select: { id: true, firstName: true, lastName: true, role: true } },
          },
        },
      },
    });

    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    return res.json(ticket);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const replyToMySupportTicket = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { body } = req.body;

    if (!body?.trim()) {
      return res.status(400).json({ message: 'Message is required' });
    }

    const user = await prisma.user.findUnique({
      where: { id: req.userId! },
      select: { email: true },
    });
    const ticket = await prisma.supportTicket.findFirst({
      where: {
        id,
        OR: [
          { userId: req.userId! },
          ...(user?.email ? [{ contactEmail: user.email }] : []),
        ],
      },
    });

    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    if (ticket.status === 'CLOSED') {
      return res.status(400).json({ message: 'This ticket is closed' });
    }

    const message = await prisma.supportTicketMessage.create({
      data: {
        ticketId: id,
        authorId: req.userId!,
        authorRole: 'USER',
        body: body.trim(),
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    await prisma.supportTicket.update({
      where: { id },
      data: { status: 'OPEN', updatedAt: new Date() },
    });

    return res.json({ message: 'Reply sent', reply: message });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};
