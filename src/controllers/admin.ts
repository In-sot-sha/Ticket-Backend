import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { PLATFORM_FEE_RATE, platformFeeForUnit } from '../constants/fees';
import { loadPaystackSettlementSnapshot } from '../services/paystack';
import { clearStalePromotions } from '../services/promotions';
import {
  sendEmail,
  generateSupportReplyEmail,
  generateSupportResolvedEmail,
  generateHostApplicationApprovedEmail,
  generateHostApplicationRejectedEmail,
} from '../services/email';

const frontendBase = () =>
  (process.env.FRONTEND_URL || 'http://localhost:5181').replace(/\/$/, '');

const paidOrderFilter = { status: 'PAID' as const };

export const getDashboardStats = async (_req: AuthRequest, res: Response) => {
  try {
    const [totalUsers, pendingHosts, verifiedHosts, totalEvents, totalTickets, revenueAgg, vendorAgg, openTickets, pendingOps] =
      await Promise.all([
        prisma.user.count(),
        prisma.organization.count({ where: { isVerified: false, rejectedAt: null } }),
        prisma.organization.count({ where: { isVerified: true } }),
        prisma.event.count(),
        prisma.ticket.count(),
        prisma.order.aggregate({
          where: paidOrderFilter,
          _sum: { totalAmount: true, platformFee: true, processingFee: true, netAmount: true },
          _count: true,
        }),
        prisma.vendorApplication.aggregate({
          where: { paymentStatus: 'PAID' },
          _sum: { paymentAmount: true, platformFee: true, processingFee: true, netAmount: true },
          _count: true,
        }),
        prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
        prisma.opsProject.count({ where: { status: 'REQUESTED' } }),
      ]);

    const totalOrdersCount = (revenueAgg._count ?? 0) + (vendorAgg._count ?? 0);
    const totalGmv = (revenueAgg._sum.totalAmount ?? 0) + (vendorAgg._sum.paymentAmount ?? 0);
    const platformRevenue = (revenueAgg._sum.platformFee ?? 0) + (vendorAgg._sum.platformFee ?? 0);
    const processingFees = (revenueAgg._sum.processingFee ?? 0) + (vendorAgg._sum.processingFee ?? 0);
    const organizerPayouts = (revenueAgg._sum.netAmount ?? 0) + (vendorAgg._sum.netAmount ?? 0);

    return res.json({
      totalUsers,
      pendingHosts,
      verifiedHosts,
      totalEvents,
      totalTickets,
      totalOrders: totalOrdersCount,
      totalGmv,
      platformRevenue,
      processingFees,
      organizerPayouts,
      openSupportTickets: openTickets,
      pendingOpsRequests: pendingOps,
      platformFeePercent: PLATFORM_FEE_RATE * 100,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getTransactions = async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const eventIdRaw = req.query.eventId as string | undefined;
    const eventId =
      eventIdRaw && eventIdRaw !== 'all' && !Number.isNaN(Number(eventIdRaw))
        ? Number(eventIdRaw)
        : undefined;
    const q = ((req.query.q as string) || '').trim().toLowerCase();
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (status && status !== 'all') where.status = status as any;
    if (eventId) where.eventId = eventId;

    // For vendor applications, filter status by paymentStatus
    const vendorWhere: Record<string, unknown> = {};
    if (status && status !== 'all') vendorWhere.paymentStatus = status as any;
    if (eventId) vendorWhere.eventId = eventId;

    const [orders, vendorApps] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          event: {
            select: {
              id: true,
              title: true,
              organization: { select: { id: true, name: true } },
            },
          },
          tickets: {
            select: {
              id: true,
              qrCode: true,
              status: true,
              amountPaid: true,
              ticketType: { select: { id: true, name: true, price: true } },
            },
          },
          _count: { select: { tickets: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.vendorApplication.findMany({
        where: vendorWhere,
        include: {
          user: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          event: {
            select: {
              id: true,
              title: true,
              organization: { select: { id: true, name: true } },
            },
          },
          vendorType: {
            select: { id: true, name: true },
          },
        },
        orderBy: { appliedAt: 'desc' },
      }),
    ]);

    // Format all to a common transaction representation
    const formattedOrders = orders.map((o: any) => ({
      id: `T-${o.id}`,
      txId: o.id,
      type: 'TICKET',
      totalAmount: o.totalAmount,
      platformFee: o.platformFee,
      processingFee: o.processingFee,
      netAmount: o.netAmount,
      status: o.status,
      purchaseType: o.purchaseType,
      discountAmount: o.discountAmount ?? 0,
      discountReason: o.discountReason ?? null,
      originalAmount: o.originalAmount ?? null,
      paymentReference: o.paymentReference,
      tickets: o.tickets || [],
      createdAt: o.createdAt,
      detail: `${o._count.tickets} ticket${o._count.tickets !== 1 ? 's' : ''}`,
      buyer: o.user
        ? { id: o.user.id, name: `${o.user.firstName} ${o.user.lastName}`.trim(), email: o.user.email }
        : null,
      event: o.event
        ? {
            id: o.event.id,
            title: o.event.title,
            organization: o.event.organization?.name ?? null,
          }
        : null,
    }));

    const formattedVendors = vendorApps.map((v: any) => ({
      id: `V-${v.id}`,
      txId: v.id,
      type: 'VENDOR',
      totalAmount: v.paymentAmount ?? 0,
      platformFee: v.platformFee ?? 0,
      processingFee: v.processingFee ?? 0,
      netAmount: v.netAmount ?? 0,
      status: v.paymentStatus,
      purchaseType: 'ONLINE',
      paymentReference: v.paymentReference,
      vendorType: v.vendorType?.name ?? null,
      tickets: [],
      createdAt: v.appliedAt,
      detail: `Vendor Booth (${v.vendorType?.name ?? 'General'})`,
      buyer: v.user
        ? { id: v.user.id, name: `${v.user.firstName} ${v.user.lastName}`.trim(), email: v.user.email }
        : null,
      event: v.event
        ? {
            id: v.event.id,
            title: v.event.title,
            organization: v.event.organization?.name ?? null,
          }
        : null,
    }));

    // Merge and sort by date descending
    let merged = [...formattedOrders, ...formattedVendors].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    if (q) {
      merged = merged.filter((tx) => {
        const vendorType = 'vendorType' in tx ? (tx as { vendorType?: string | null }).vendorType : null;
        const hay = [
          String(tx.txId),
          tx.id,
          tx.status,
          tx.type,
          tx.detail,
          tx.paymentReference,
          tx.buyer?.name,
          tx.buyer?.email,
          tx.event?.title,
          tx.event?.organization,
          vendorType,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }

    const total = merged.length;
    const paginated = merged.slice(skip, skip + limit);

    return res.json({
      transactions: paginated,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getRevenue = async (_req: AuthRequest, res: Response) => {
  try {
    const [aggOrders, aggVendors, monthlyOrders, monthlyVendors, byEventOrders, byEventVendors] = await Promise.all([
      prisma.order.aggregate({
        where: paidOrderFilter,
        _sum: { totalAmount: true, platformFee: true, processingFee: true, netAmount: true },
        _count: true,
      }),
      prisma.vendorApplication.aggregate({
        where: { paymentStatus: 'PAID' },
        _sum: { paymentAmount: true, platformFee: true, processingFee: true, netAmount: true },
        _count: true,
      }),
      prisma.order.findMany({
        where: paidOrderFilter,
        select: { createdAt: true, totalAmount: true, platformFee: true, netAmount: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.vendorApplication.findMany({
        where: { paymentStatus: 'PAID' },
        select: { appliedAt: true, paymentAmount: true, platformFee: true, netAmount: true },
        orderBy: { appliedAt: 'asc' },
      }),
      prisma.order.findMany({
        where: paidOrderFilter,
        select: {
          totalAmount: true,
          platformFee: true,
          netAmount: true,
          event: { select: { id: true, title: true } },
        },
      }),
      prisma.vendorApplication.findMany({
        where: { paymentStatus: 'PAID' },
        select: {
          paymentAmount: true,
          platformFee: true,
          netAmount: true,
          event: { select: { id: true, title: true } },
        },
      }),
    ]);

    const totalOrdersCount = aggOrders._count + aggVendors._count;
    const totalGmv = (aggOrders._sum.totalAmount ?? 0) + (aggVendors._sum.paymentAmount ?? 0);
    const platformRevenue = (aggOrders._sum.platformFee ?? 0) + (aggVendors._sum.platformFee ?? 0);
    const processingFees = (aggOrders._sum.processingFee ?? 0) + (aggVendors._sum.processingFee ?? 0);
    const organizerPayouts = (aggOrders._sum.netAmount ?? 0) + (aggVendors._sum.netAmount ?? 0);

    const monthlyMap = new Map<string, { gmv: number; platformFee: number; netAmount: number; orders: number }>();
    for (const o of monthlyOrders) {
      const key = `${o.createdAt.getFullYear()}-${String(o.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const cur = monthlyMap.get(key) ?? { gmv: 0, platformFee: 0, netAmount: 0, orders: 0 };
      cur.gmv += o.totalAmount;
      cur.platformFee += o.platformFee;
      cur.netAmount += o.netAmount;
      cur.orders += 1;
      monthlyMap.set(key, cur);
    }
    for (const v of monthlyVendors) {
      const key = `${v.appliedAt.getFullYear()}-${String(v.appliedAt.getMonth() + 1).padStart(2, '0')}`;
      const cur = monthlyMap.get(key) ?? { gmv: 0, platformFee: 0, netAmount: 0, orders: 0 };
      cur.gmv += v.paymentAmount ?? 0;
      cur.platformFee += v.platformFee ?? 0;
      cur.netAmount += v.netAmount ?? 0;
      cur.orders += 1;
      monthlyMap.set(key, cur);
    }

    const eventMap = new Map<number, { eventId: number; title: string; gmv: number; platformFee: number; orders: number }>();
    for (const o of byEventOrders) {
      if (!o.event) continue;
      const cur = eventMap.get(o.event.id) ?? {
        eventId: o.event.id,
        title: o.event.title,
        gmv: 0,
        platformFee: 0,
        orders: 0,
      };
      cur.gmv += o.totalAmount;
      cur.platformFee += o.platformFee;
      cur.orders += 1;
      eventMap.set(o.event.id, cur);
    }
    for (const v of byEventVendors) {
      if (!v.event) continue;
      const cur = eventMap.get(v.event.id) ?? {
        eventId: v.event.id,
        title: v.event.title,
        gmv: 0,
        platformFee: 0,
        orders: 0,
      };
      cur.gmv += v.paymentAmount ?? 0;
      cur.platformFee += v.platformFee ?? 0;
      cur.orders += 1;
      eventMap.set(v.event.id, cur);
    }

    return res.json({
      summary: {
        totalOrders: totalOrdersCount,
        totalGmv,
        platformRevenue,
        processingFees,
        organizerPayouts,
        platformFeePercent: PLATFORM_FEE_RATE * 100,
      },
      monthly: Array.from(monthlyMap.entries()).map(([month, data]) => ({ month, ...data })),
      byEvent: Array.from(eventMap.values()).sort((a, b) => b.platformFee - a.platformFee),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getSupportTickets = async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined;

    const tickets = await prisma.supportTicket.findMany({
      where: status && status !== 'all' ? { status: status as any } : {},
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true, createdAt: true, authorRole: true },
        },
        _count: { select: { messages: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });

    return res.json(tickets);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getSupportTicketById = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);

    const ticket = await prisma.supportTicket.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
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

async function sendSupportReplyNotification(params: {
  ticket: { id: number; contactName: string | null; contactEmail: string; subject: string };
  body: string;
  status: string;
  needsMoreInfo?: boolean;
}): Promise<boolean> {
  const to = params.ticket.contactEmail?.trim();
  if (!to) return false;
  const supportUrl = `${frontendBase()}/support`;
  if (params.status === 'RESOLVED') {
    const tpl = generateSupportResolvedEmail({
      name: params.ticket.contactName,
      subject: params.ticket.subject,
      ticketId: params.ticket.id,
      note: params.body,
      supportUrl,
    });
    return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
  }
  const tpl = generateSupportReplyEmail({
    name: params.ticket.contactName,
    subject: params.ticket.subject,
    ticketId: params.ticket.id,
    replyBody: params.body,
    needsMoreInfo: Boolean(params.needsMoreInfo),
    supportUrl,
  });
  return sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
}

export const replyToSupportTicket = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { body, status, needsMoreInfo } = req.body;

    if (!body?.trim()) {
      return res.status(400).json({ message: 'Reply message is required' });
    }

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    if (ticket.status === 'CLOSED') {
      return res.status(400).json({ message: 'This ticket is closed. Re-open it to send responses.' });
    }

    const allowedStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    const newStatus =
      status && allowedStatuses.includes(status)
        ? status
        : needsMoreInfo
          ? 'IN_PROGRESS'
          : 'IN_PROGRESS';

    const [message] = await prisma.$transaction([
      prisma.supportTicketMessage.create({
        data: {
          ticketId: id,
          authorId: req.userId!,
          authorRole: 'ADMIN',
          body: body.trim(),
          emailSent: false,
        },
        include: {
          author: { select: { id: true, firstName: true, lastName: true, role: true } },
        },
      }),
      prisma.supportTicket.update({
        where: { id },
        data: { status: newStatus as any, updatedAt: new Date() },
      }),
    ]);

    const emailSent = await sendSupportReplyNotification({
      ticket,
      body: body.trim(),
      status: newStatus,
      needsMoreInfo: Boolean(needsMoreInfo),
    });

    const reply = await prisma.supportTicketMessage.update({
      where: { id: message.id },
      data: {
        emailSent,
        emailSentAt: emailSent ? new Date() : null,
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    return res.json({
      message: emailSent ? 'Reply sent' : 'Reply saved but email was not delivered',
      reply,
      emailSent,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/** Resend notification email for an admin reply when the original send failed. */
export const resendSupportReplyEmail = async (req: AuthRequest, res: Response) => {
  try {
    const ticketId = Number(req.params.id);
    const messageId = Number(req.params.messageId);

    const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });
    if (ticket.status === 'CLOSED') {
      return res.status(400).json({ message: 'This ticket is closed. Re-open it to resend emails.' });
    }

    const message = await prisma.supportTicketMessage.findFirst({
      where: { id: messageId, ticketId },
    });
    if (!message) return res.status(404).json({ message: 'Reply not found' });
    if (message.authorRole !== 'ADMIN') {
      return res.status(400).json({ message: 'Only staff replies can be resent by email' });
    }
    if (message.emailSent === true) {
      return res.status(400).json({ message: 'This reply email was already sent' });
    }
    if (!ticket.contactEmail?.trim()) {
      return res.status(400).json({ message: 'No contact email on this ticket' });
    }

    const emailSent = await sendSupportReplyNotification({
      ticket,
      body: message.body,
      status: ticket.status === 'RESOLVED' ? 'RESOLVED' : 'IN_PROGRESS',
    });

    const reply = await prisma.supportTicketMessage.update({
      where: { id: message.id },
      data: {
        emailSent,
        emailSentAt: emailSent ? new Date() : null,
      },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    });

    if (!emailSent) {
      return res.status(502).json({
        message: 'Email still failed to send. Check SMTP / Resend settings.',
        reply,
        emailSent: false,
      });
    }

    return res.json({ message: 'Email resent successfully', reply, emailSent: true });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateSupportTicket = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status, priority, notifyMessage } = req.body;

    const existing = await prisma.supportTicket.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ message: 'Ticket not found' });

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (status) data.status = status;
    if (priority) data.priority = priority;

    const ticket = await prisma.supportTicket.update({
      where: { id },
      data,
    });

    const to = ticket.contactEmail;
    const statusChanged = status && status !== existing.status;
    if (to && statusChanged && (status === 'RESOLVED' || status === 'CLOSED')) {
      const tpl = generateSupportResolvedEmail({
        name: ticket.contactName,
        subject: ticket.subject,
        ticketId: ticket.id,
        note:
          typeof notifyMessage === 'string' && notifyMessage.trim()
            ? notifyMessage.trim()
            : status === 'CLOSED'
              ? 'This ticket has been closed.'
              : 'We’ve resolved your request. If you still need help, open a new support request.',
        supportUrl: `${frontendBase()}/support`,
      });
      void sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
    }

    return res.json({ message: 'Ticket updated', ticket, emailSent: Boolean(to && statusChanged) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getHostApplications = async (req: AuthRequest, res: Response) => {
  try {
    const status = (req.query.status as string) || 'pending';

    const where =
      status === 'pending'
        ? { isVerified: false, rejectedAt: null }
        : status === 'rejected'
          ? { isVerified: false, rejectedAt: { not: null } }
          : status === 'verified'
            ? { isVerified: true }
            : {};

    const organizations = await prisma.organization.findMany({
      where,
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            role: true,
            createdAt: true,
          },
        },
        _count: {
          select: { events: true, members: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return res.json(organizations);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const createHostOrganization = async (req: AuthRequest, res: Response) => {
  try {
    const name = String(req.body.name || '').trim();
    const description = req.body.description ? String(req.body.description).trim() : '';
    const website = req.body.website ? String(req.body.website).trim() : null;
    const logo = req.body.logo ? String(req.body.logo).trim() : null;
    const socials = req.body.socials ? String(req.body.socials).trim() : null;
    const ownerId = Number(req.body.ownerId);

    if (!name) {
      return res.status(400).json({ message: 'Organization name is required' });
    }
    if (!description) {
      return res.status(400).json({ message: 'Description is required' });
    }
    if (!socials) {
      return res.status(400).json({ message: 'Add at least 1 social profile' });
    }
    if (!Number.isInteger(ownerId) || ownerId <= 0) {
      return res.status(400).json({ message: 'Select an owner' });
    }

    const owner = await prisma.user.findUnique({ where: { id: ownerId } });
    if (!owner) {
      return res.status(404).json({ message: 'Owner not found' });
    }
    if (owner.isGuest) {
      return res.status(400).json({ message: 'A guest account cannot own an organization' });
    }

    const duplicate = await prisma.organization.findFirst({
      where: { ownerId, name },
    });
    if (duplicate) {
      return res.status(400).json({ message: 'This person already has an organization with that name' });
    }

    const organization = await prisma.$transaction(async (tx) => {
      const created = await tx.organization.create({
        data: {
          name,
          description,
          website: website || null,
          logo: logo || null,
          socials: socials || null,
          ownerId,
          isVerified: true,
        },
      });

      await tx.organizationMember.create({
        data: {
          userId: ownerId,
          organizationId: created.id,
          role: 'admin',
        },
      });

      if (owner.role === 'USER' || owner.role === 'VENDOR') {
        await tx.user.update({
          where: { id: ownerId },
          data: { role: 'ORGANIZER' },
        });
      }

      return tx.organization.findUnique({
        where: { id: created.id },
        include: {
          owner: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              phone: true,
              role: true,
              createdAt: true,
            },
          },
          _count: { select: { events: true, members: true } },
        },
      });
    });

    if (owner.email) {
      const tpl = generateHostApplicationApprovedEmail({
        firstName: owner.firstName,
        organizationName: name,
      });
      void sendEmail({
        to: owner.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      }).catch((err) => console.error('[Host] Created-org approval email failed:', err));
    }

    return res.status(201).json({
      message: 'Organization created and approved',
      organization,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const verifyHostApplication = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);

    const organization = await prisma.organization.findUnique({
      where: { id },
      include: { owner: true },
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    if (organization.isVerified) {
      return res.status(400).json({ message: 'Organization is already verified' });
    }

    const updated = await prisma.organization.update({
      where: { id },
      data: {
        isVerified: true,
        rejectionReason: null,
        rejectedAt: null,
      },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            role: true,
          },
        },
      },
    });

    if (updated.owner?.email) {
      const tpl = generateHostApplicationApprovedEmail({
        firstName: updated.owner.firstName,
        organizationName: updated.name,
      });
      void sendEmail({
        to: updated.owner.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      }).catch((err) => console.error('[Host] Approval email failed:', err));
    }

    return res.json({
      message: 'Host application approved',
      organization: updated,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const rejectHostApplication = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { reason } = req.body;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({ message: 'A rejection reason is required' });
    }

    const organization = await prisma.organization.findUnique({
      where: { id },
      include: {
        owner: true,
        _count: { select: { events: true } },
      },
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    if (organization.isVerified) {
      return res.status(400).json({ message: 'Cannot reject an already verified organization' });
    }

    if (organization.rejectedAt) {
      return res.status(400).json({ message: 'This application has already been rejected' });
    }

    const updated = await prisma.organization.update({
      where: { id },
      data: {
        rejectionReason: String(reason).trim(),
        rejectedAt: new Date(),
      },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            role: true,
          },
        },
      },
    });

    if (updated.owner?.email) {
      const tpl = generateHostApplicationRejectedEmail({
        firstName: updated.owner.firstName,
        organizationName: updated.name,
        reason: String(reason).trim(),
      });
      void sendEmail({
        to: updated.owner.email,
        subject: tpl.subject,
        html: tpl.html,
        text: tpl.text,
      }).catch((err) => console.error('[Host] Rejection email failed:', err));
    }

    return res.json({
      message: 'Host application rejected',
      organization: updated,
      reason: String(reason).trim(),
      userId: organization.ownerId,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getUsers = async (req: AuthRequest, res: Response) => {
  try {
    const search = (req.query.search as string) || '';
    const role = req.query.role as string | undefined;

    const users = await prisma.user.findMany({
      where: {
        ...(role && role !== 'all' ? { role: role as any } : {}),
        ...(search
          ? {
              OR: [
                { email: { contains: search } },
                { firstName: { contains: search } },
                { lastName: { contains: search } },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isVerified: true,
        isGuest: true,
        isStaff: true,
        createdAt: true,
        ownedOrganizations: {
          select: { id: true, name: true, isVerified: true },
        },
        staffProfile: true,
        _count: {
          select: { tickets: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    return res.json(users);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateUserRole = async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.id);
    const { role } = req.body;

    const allowedRoles = ['USER', 'ORGANIZER', 'VENDOR', 'ADMIN'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ message: 'Invalid role' });
    }

    if (userId === req.userId && role !== 'ADMIN') {
      return res.status(400).json({ message: 'You cannot demote your own admin account' });
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { role },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      },
    });

    return res.json({ message: 'User role updated', user });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getAdminEvents = async (req: AuthRequest, res: Response) => {
  try {
    await clearStalePromotions();
    const search = (req.query.search as string) || '';
    const events = await prisma.event.findMany({
      where: {
        ...(search
          ? {
              OR: [
                { title: { contains: search } },
                { description: { contains: search } },
              ],
            }
          : {}),
      },
      include: {
        organization: {
          select: { id: true, name: true },
        },
        ticketTypes: {
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true,
            isPaused: true,
            platformFeeNaira: true,
            _count: { select: { tickets: true } },
          },
        },
        _count: {
          select: { tickets: true, orders: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return res.json(events);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const promoteEvent = async (req: AuthRequest, res: Response) => {
  try {
    const eventId = Number(req.params.id);
    const { isPromoted, promotedUntil } = req.body;

    if (isNaN(eventId) || eventId <= 0) {
      return res.status(400).json({ message: 'Invalid event ID' });
    }

    const existing = await prisma.event.findUnique({
      where: { id: eventId },
      select: { startDate: true, endDate: true },
    });
    if (!existing) {
      return res.status(404).json({ message: 'Event not found' });
    }

    if (isPromoted) {
      if (existing.endDate.getTime() < Date.now()) {
        return res.status(400).json({
          message: 'This event has ended, so it cannot be promoted.',
        });
      }
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: {
        isPromoted: Boolean(isPromoted),
        promotedUntil: promotedUntil ? new Date(promotedUntil) : null,
        ...(isPromoted ? { promotionRequestedAt: null } : {}),
      },
    });

    return res.json({ message: 'Event promotion updated', event });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Admin: resend order tickets to a (possibly corrected) email.
 * POST /admin/orders/:orderId/resend-tickets { email }
 */
export const resendOrderTicketsAdmin = async (req: AuthRequest, res: Response) => {
  try {
    const orderId = Number(req.params.orderId);
    if (!Number.isFinite(orderId) || orderId <= 0) {
      return res.status(400).json({ message: 'Invalid order ID' });
    }
    const { email } = req.body || {};
    const { resendOrderTickets } = await import('../services/checkoutFulfillment');
    const result = await resendOrderTickets({
      orderId,
      email: String(email || ''),
      adminUserId: req.userId,
    });
    return res.json({
      message: result.warning
        ? `Tickets resent to ${result.deliveredTo}. ${result.warning}`
        : `Tickets resent to ${result.deliveredTo}`,
      ...result,
    });
  } catch (error: any) {
    console.error('[Admin] resendOrderTickets:', error);
    const status = error.status || 500;
    return res.status(status).json({ message: error.message || 'Failed to resend tickets' });
  }
};

/** Admin-only: set PartyStorm take (₦) on one ticket tier. Null clears override → default formula. */
export const updateTicketTypePlatformFee = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid ticket type ID' });
    }

    const raw = req.body?.platformFeeNaira;
    let platformFeeNaira: number | null;
    if (raw === null || raw === undefined || raw === '') {
      platformFeeNaira = null;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        return res.status(400).json({ message: 'platformFeeNaira must be a number ≥ 0, or null to use the default formula' });
      }
      platformFeeNaira = Math.round(n);
    }

    const existing = await prisma.ticketType.findUnique({
      where: { id },
      select: { id: true, name: true, price: true, eventId: true, platformFeeNaira: true },
    });
    if (!existing) {
      return res.status(404).json({ message: 'Ticket type not found' });
    }

    const updated = await prisma.ticketType.update({
      where: { id },
      data: { platformFeeNaira },
      select: {
        id: true,
        name: true,
        price: true,
        quantity: true,
        isPaused: true,
        platformFeeNaira: true,
        eventId: true,
      },
    });

    console.log(
      `[ADMIN AUDIT] Admin (ID: ${req.userId}) set TicketType ${id} platformFeeNaira=${platformFeeNaira} (was ${existing.platformFeeNaira})`,
    );

    return res.json({
      message: platformFeeNaira == null
        ? 'Ticket tier fee cleared — default formula applies'
        : `Ticket tier fee set to ₦${platformFeeNaira}`,
      ticketType: updated,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateOrganizationFee = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { serviceFeePercent, absorbFee } = req.body;

    if (serviceFeePercent !== undefined && (typeof serviceFeePercent !== 'number' || serviceFeePercent < 0 || serviceFeePercent > 100)) {
      return res.status(400).json({ message: 'Service fee percent must be a number between 0 and 100' });
    }

    const organization = await prisma.organization.findUnique({
      where: { id },
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    const updated = await prisma.organization.update({
      where: { id },
      data: {
        ...(serviceFeePercent !== undefined ? { serviceFeePercent } : {}),
        ...(absorbFee !== undefined ? { absorbFee } : {}),
      },
      include: {
        owner: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            phone: true,
            role: true,
          },
        },
      },
    });

    console.log(`[ADMIN AUDIT] Admin (ID: ${req.userId}) updated Organization (ID: ${id}) fee configuration to serviceFeePercent: ${serviceFeePercent}%, absorbFee: ${absorbFee}`);

    return res.json({
      message: 'Organization fee configuration updated successfully',
      organization: updated,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getPaystackSettlements = async (_req: AuthRequest, res: Response) => {
  try {
    const snapshot = await loadPaystackSettlementSnapshot();
    const orgs = await prisma.organization.findMany({
      where: { paystackSubaccountCode: { not: null } },
      select: { name: true, paystackSubaccountCode: true },
    });
    const orgByCode = new Map(orgs.map((org) => [org.paystackSubaccountCode, org.name]));
    return res.json({
      configured: snapshot.configured,
      byReference: snapshot.byReference,
      settlements: snapshot.settlements.map((settlement) => ({
        ...settlement,
        organizationName: settlement.subaccountCode
          ? orgByCode.get(settlement.subaccountCode) || settlement.businessName || null
          : 'PartyStorm',
      })),
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Could not load Paystack settlements' });
  }
};

export const getPayoutRequests = async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const payouts = await prisma.payout.findMany({
      where: status && status !== 'all' ? { status: status as any } : {},
      include: {
        organization: {
          select: {
            id: true,
            name: true,
            owner: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return res.json(payouts);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const approvePayout = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const payout = await prisma.payout.findUnique({
      where: { id },
      include: { organization: true },
    });

    if (!payout) {
      return res.status(404).json({ message: 'Payout request not found.' });
    }

    if (payout.status !== 'PENDING') {
      return res.status(400).json({ message: 'Payout request has already been processed.' });
    }

    const paystackSecret = process.env.PAYSTACK_SECRET_KEY;
    if (!paystackSecret) {
      return res.status(500).json({ message: 'Paystack is not configured on this server.' });
    }

    // Step 1: Fetch Nigeria bank list to resolve bank name to bank code
    let bankCode = '';
    try {
      const bankRes = await fetch('https://api.paystack.co/bank?currency=NGN', {
        headers: { Authorization: `Bearer ${paystackSecret}` },
      });
      const bankData: any = await bankRes.json();
      if (bankData.status && Array.isArray(bankData.data)) {
        const queryBank = (payout.bankName || '').toLowerCase().trim();
        // Try exact match or substring match
        const foundBank = bankData.data.find(
          (b: any) =>
            b.name.toLowerCase() === queryBank ||
            b.name.toLowerCase().includes(queryBank) ||
            queryBank.includes(b.name.toLowerCase())
        );
        if (foundBank) {
          bankCode = foundBank.code;
        }
      }
    } catch (bankErr) {
      console.error('[Paystack Payout] Failed to fetch bank list:', bankErr);
    }

    if (!bankCode) {
      return res.status(400).json({
        message: `Could not resolve bank code for "${payout.bankName}". Please double check the bank name.`,
      });
    }

    // Step 2: Create Transfer Recipient
    let recipientCode = '';
    try {
      const recipientRes = await fetch('https://api.paystack.co/transferrecipient', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'nuban',
          name: payout.accountName || payout.organization.name,
          account_number: payout.accountNumber,
          bank_code: bankCode,
          currency: 'NGN',
        }),
      });
      const recipientData: any = await recipientRes.json();
      if (recipientData.status && recipientData.data && recipientData.data.recipient_code) {
        recipientCode = recipientData.data.recipient_code;
      } else {
        return res.status(400).json({
          message: `Paystack recipient creation failed: ${recipientData.message || 'Unknown error'}`,
        });
      }
    } catch (recipientErr: any) {
      console.error('[Paystack Payout] Recipient error:', recipientErr);
      return res.status(500).json({ message: 'Error communicating with Paystack Recipient API.' });
    }

    // Step 3: Initiate Transfer
    try {
      const transferRes = await fetch('https://api.paystack.co/transfer', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${paystackSecret}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source: 'balance',
          amount: Math.round(payout.amount * 100), // convert to kobo
          recipient: recipientCode,
          reason: `Payout request ref ${payout.reference || payout.id}`,
        }),
      });
      const transferData: any = await transferRes.json();
      if (transferData.status) {
        const updatedPayout = await prisma.payout.update({
          where: { id },
          data: { status: 'PAID' },
        });
        return res.json({
          message: 'Payout processed and transfer initiated successfully.',
          payout: updatedPayout,
          paystack: transferData.data,
        });
      } else {
        return res.status(400).json({
          message: `Paystack transfer failed: ${transferData.message || 'Unknown error'}`,
        });
      }
    } catch (transferErr: any) {
      console.error('[Paystack Payout] Transfer error:', transferErr);
      return res.status(500).json({ message: 'Error initiating transfer via Paystack API.' });
    }
  } catch (error) {
    console.error('[Payout Approval Error]:', error);
    return res.status(500).json({ message: 'Server error processing payout approval.' });
  }
};

export const rejectPayout = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const payout = await prisma.payout.findUnique({ where: { id } });

    if (!payout) {
      return res.status(404).json({ message: 'Payout request not found.' });
    }

    if (payout.status !== 'PENDING') {
      return res.status(400).json({ message: 'Payout request has already been processed.' });
    }

    const updatedPayout = await prisma.payout.update({
      where: { id },
      data: { status: 'REFUNDED' },
    });

    return res.json({
      message: 'Payout request rejected and balance restored.',
      payout: updatedPayout,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

/**
 * Admin: Issue Assisted / Pre-Event Direct Tickets with customized or standard PartyStorm cut.
 * POST /admin/orders/assisted-sale
 */
export const createAssistedSaleOrder = async (req: AuthRequest, res: Response) => {
  try {
    const {
      eventId,
      ticketTypeId,
      quantity = 1,
      buyerName,
      buyerEmail,
      buyerPhone,
      paymentMethod = 'TRANSFER',
      platformFee: customPlatformFee,
      checkInNow = false,
      attendees,
      discountAmount: rawDiscountAmount = 0,
      discountReason: rawDiscountReason,
      notes,
    } = req.body || {};

    if (!eventId || !ticketTypeId) {
      return res.status(400).json({ message: 'eventId and ticketTypeId are required' });
    }

    if (!buyerName?.trim()) {
      return res.status(400).json({ message: 'Buyer name is required' });
    }

    const cleanEmail = (buyerEmail || '').trim().toLowerCase();
    const cleanPhone = (buyerPhone || '').trim();
    const isSplit = Array.isArray(attendees) && attendees.length > 0;
    const qty = Math.max(1, Math.min(100, Math.floor(Number(quantity) || 1)));

    const attendeesList = isSplit
      ? attendees.slice(0, qty).map((a: any, i: number) => ({
          name: (a?.name || (i === 0 ? buyerName : `${buyerName} (Guest ${i + 1})`)).trim(),
          email: (a?.email || (i === 0 ? cleanEmail : '')).trim().toLowerCase(),
          phone: (a?.phone || (i === 0 ? cleanPhone : '')).trim(),
        }))
      : [];

    if (!cleanEmail && !cleanPhone && !attendeesList.some((a) => a.email || a.phone)) {
      return res.status(400).json({ message: 'Either an email or phone number is required to deliver tickets' });
    }

    const event = await prisma.event.findUnique({
      where: { id: Number(eventId) },
      include: {
        organization: { select: { id: true, name: true, logo: true } },
      },
    });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const ticketType = await prisma.ticketType.findUnique({
      where: { id: Number(ticketTypeId) },
    });

    if (!ticketType || ticketType.eventId !== event.id) {
      return res.status(404).json({ message: 'Ticket type not found for this event' });
    }

    const unitPrice = Number(ticketType.price) || 0;
    const faceTotal = Math.round(unitPrice * qty);
    const validDiscount = Math.max(0, Math.min(faceTotal, Math.round(Number(rawDiscountAmount) || 0)));
    const grossTotal = Math.max(0, faceTotal - validDiscount);
    const discountReason = validDiscount > 0 ? (rawDiscountReason ? String(rawDiscountReason).trim() : null) : null;

    // Calculate Platform Fee (PartyStorm's Cut)
    let finalPlatformFee: number;
    if (customPlatformFee !== undefined && customPlatformFee !== null && customPlatformFee !== '') {
      const parsedFee = Number(customPlatformFee);
      if (!Number.isFinite(parsedFee) || parsedFee < 0) {
        return res.status(400).json({ message: 'Platform fee must be a valid positive number' });
      }
      finalPlatformFee = Math.min(grossTotal, Math.round(parsedFee));
    } else {
      // Calculate platform fee on actual collected unit price
      const effectiveUnitPrice = qty > 0 ? grossTotal / qty : unitPrice;
      finalPlatformFee = Math.min(grossTotal, platformFeeForUnit(effectiveUnitPrice, ticketType.platformFeeNaira) * qty);
    }

    const netAmount = Math.max(0, grossTotal - finalPlatformFee);

    // Get or create guest user
    const { getOrCreateGuestUser } = await import('../services/guestUser');
    const guestUser = await getOrCreateGuestUser({
      name: buyerName.trim(),
      email: cleanEmail || undefined,
      phone: cleanPhone || undefined,
    });

    // Valid payment method enum mapping
    const validMethod = ['CASH', 'POS', 'TRANSFER'].includes(String(paymentMethod).toUpperCase())
      ? (String(paymentMethod).toUpperCase() as 'CASH' | 'POS' | 'TRANSFER')
      : 'TRANSFER';

    const paymentReference = `ASSIST-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    const { order, tickets } = await prisma.$transaction(async (tx) => {
      const createdOrder = await tx.order.create({
        data: {
          userId: guestUser.id,
          eventId: event.id,
          totalAmount: grossTotal,
          platformFee: finalPlatformFee,
          processingFee: 0, // No payment gateway fee incurred on direct assisted sales
          netAmount,
          chargeAmount: grossTotal,
          originalAmount: faceTotal,
          discountAmount: validDiscount,
          discountReason,
          paymentReference,
          status: 'PAID',
          purchaseType: 'ASSISTED',
          acceptedTerms: true,
          termsAcceptedAt: new Date(),
        },
      });

      const createdTickets = [];
      const unitPaid = qty > 0 ? Math.round((grossTotal / qty) * 100) / 100 : unitPrice;

      for (let i = 0; i < qty; i++) {
        let ticketUser = guestUser;
        if (isSplit && attendeesList[i]) {
          const att = attendeesList[i];
          if (att.email || att.phone || (att.name && att.name !== buyerName)) {
            ticketUser = await getOrCreateGuestUser({
              name: att.name || buyerName.trim(),
              email: att.email || undefined,
              phone: att.phone || undefined,
            });
          }
        }

        const t = await tx.ticket.create({
          data: {
            eventId: event.id,
            ticketTypeId: ticketType.id,
            userId: ticketUser.id,
            qrCode: `QR-ASSIST-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
            status: checkInNow ? 'USED' : 'VALID',
            purchaseType: 'ASSISTED',
            orderId: createdOrder.id,
            paymentMethod: validMethod,
            amountPaid: unitPaid,
            soldByUserId: req.userId,
          },
          include: {
            event: true,
            ticketType: true,
          },
        });
        createdTickets.push(t);
      }

      return { order: createdOrder, tickets: createdTickets };
    });

    const { sendTicketEmail } = await import('../services/checkoutFulfillment');
    const { deliverTicketsViaWhatsApp } = await import('../services/whatsapp');

    // Deliver via Email & WhatsApp
    if (isSplit && attendeesList.length > 0) {
      // Send individual tickets to each attendee
      for (let i = 0; i < tickets.length; i++) {
        const att = attendeesList[i];
        const ticket = tickets[i];
        const targetEmail = att?.email || (i === 0 ? cleanEmail : '');
        const targetPhone = att?.phone || (i === 0 ? cleanPhone : '');

        if (targetEmail) {
          try {
            await sendTicketEmail({
              email: targetEmail,
              event,
              ticketType,
              tickets: [ticket],
              totalPrice: unitPrice,
              quantity: 1,
              organizerName: event.organization?.name,
              organizerLogo: event.organization?.logo,
            });
          } catch (emailErr) {
            console.error(`[AssistedSale] Failed individual email to ${targetEmail}:`, emailErr);
          }
        }

        if (targetPhone) {
          try {
            await deliverTicketsViaWhatsApp({
              phone: targetPhone,
              eventTitle: event.title,
              eventDate: event.startDate ? new Date(event.startDate).toLocaleDateString() : 'TBA',
              eventLocation: event.location || 'TBA',
              tickets: [{
                id: ticket.id,
                qrCode: ticket.qrCode,
                ticketTypeName: ticketType.name,
              }],
            });
          } catch (waErr) {
            console.error(`[AssistedSale] Failed individual WhatsApp to ${targetPhone}:`, waErr);
          }
        }
      }
    } else {
      // Single recipient bulk delivery
      if (cleanEmail) {
        try {
          await sendTicketEmail({
            email: cleanEmail,
            event,
            ticketType: { name: `${ticketType.name} × ${qty}` },
            tickets,
            // Send original undiscounted price (faceTotal) instead of discounted price (grossTotal)
            totalPrice: faceTotal,
            quantity: qty,
            organizerName: event.organization?.name,
            organizerLogo: event.organization?.logo,
          });
        } catch (emailErr) {
          console.error('[AssistedSale] Failed to send ticket email:', emailErr);
        }
      }

      if (cleanPhone) {
        try {
          await deliverTicketsViaWhatsApp({
            phone: cleanPhone,
            eventTitle: event.title,
            eventDate: event.startDate ? new Date(event.startDate).toLocaleDateString() : 'TBA',
            eventLocation: event.location || 'TBA',
            tickets: tickets.map((t) => ({
              id: t.id,
              qrCode: t.qrCode,
              ticketTypeName: ticketType.name,
            })),
          });
        } catch (waErr) {
          console.error('[AssistedSale] Failed to deliver WhatsApp tickets:', waErr);
        }
      }
    }

    return res.status(201).json({
      message: 'Assisted sale recorded and tickets issued successfully',
      order,
      tickets,
      ticketsCount: tickets.length,
      breakdown: {
        originalAmount: faceTotal,
        discountAmount: validDiscount,
        discountReason,
        gross: grossTotal,
        platformFee: finalPlatformFee,
        netAmount,
      },
    });
  } catch (error: any) {
    console.error('[Admin] createAssistedSaleOrder error:', error);
    return res.status(500).json({ message: error.message || 'Server error recording assisted sale' });
  }
};

/**
 * Admin: Download all tickets for an order as a consolidated PDF.
 * GET /admin/orders/:orderId/tickets-pdf
 */
export const downloadOrderTicketsPdf = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    const isNumeric = /^\d+$/.test(orderId);

    const order = await prisma.order.findFirst({
      where: isNumeric
        ? { id: parseInt(orderId, 10) }
        : { paymentReference: orderId },
      include: {
        event: {
          include: { organization: true },
        },
        tickets: {
          include: { ticketType: true },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const { buildConsolidatedTicketPdf } = await import('../services/ticketPdf');
    const eventDate = order.event.startDate
      ? new Date(order.event.startDate).toLocaleDateString()
      : 'TBA';
    const eventTime = order.event.startDate
      ? new Date(order.event.startDate).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    const backendBase = (
      process.env.BACKEND_URL ||
      process.env.API_BASE_URL ||
      process.env.EMAIL_ASSET_BASE ||
      'https://api.partystorm.ng'
    ).replace(/\/$/, '');
    const toAbsolute = (u?: string | null) => {
      if (!u?.trim()) return null;
      const clean = u.trim();
      if (/^https?:\/\//i.test(clean)) return clean;
      return `${backendBase}${clean.startsWith('/') ? '' : '/'}${clean}`;
    };

    const passes = order.tickets.map((t) => ({
      id: t.id,
      qrCode: t.qrCode,
      ticketTypeName: t.ticketType?.name || 'General Admission',
      eventTitle: order.event.title,
      eventDate,
      eventTime,
      eventLocation: order.event.location || 'TBA',
      eventImageUrl: toAbsolute(order.event.imageUrl),
      accentColor: t.ticketType?.accentColor || null,
      ticketStyle: t.ticketType?.ticketStyle || null,
      organizerLogoUrl: toAbsolute(order.event.organization?.logo),
    }));

    const pdfBuffer = await buildConsolidatedTicketPdf(passes);
    const safeTitle = order.event.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30);
    const filename =
      order.tickets.length === 1
        ? `${safeTitle}-TKT-${String(order.tickets[0].id).padStart(6, '0')}.pdf`
        : `${safeTitle}-tickets-${order.tickets.length}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (error: any) {
    console.error('[Admin] downloadOrderTicketsPdf error:', error);
    return res.status(500).json({ message: error.message || 'Server error generating tickets PDF' });
  }
};

/**
 * Admin: Get lightweight JSON data for all tickets in an order so the frontend
 * can generate the vertical ticket PDFs and ZIP 100% client-side with 0 timeouts.
 * GET /admin/orders/:orderId/tickets-data
 */
export const getOrderTicketsData = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    const isNumeric = /^\d+$/.test(orderId);

    const order = await prisma.order.findFirst({
      where: isNumeric
        ? { id: parseInt(orderId, 10) }
        : { paymentReference: orderId },
      include: {
        event: {
          include: { organization: true },
        },
        tickets: {
          include: { ticketType: true, user: true },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const { optimizeImageUrlForTicket } = await import('../services/ticketPdf');
    const backendBase = (
      process.env.BACKEND_URL ||
      process.env.API_BASE_URL ||
      process.env.EMAIL_ASSET_BASE ||
      'https://api.partystorm.ng'
    ).replace(/\/$/, '');
    const toAbsolute = (u?: string | null) => {
      if (!u?.trim()) return null;
      const clean = u.trim();
      if (/^https?:\/\//i.test(clean)) return clean;
      return `${backendBase}${clean.startsWith('/') ? '' : '/'}${clean}`;
    };

    const eventDate = order.event.startDate
      ? new Date(order.event.startDate).toLocaleDateString()
      : 'TBA';
    const eventTime = order.event.startDate
      ? new Date(order.event.startDate).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    const bannerUrl = optimizeImageUrlForTicket(toAbsolute(order.event.imageUrl));
    const logoUrl = optimizeImageUrlForTicket(toAbsolute(order.event.organization?.logo));

    return res.json({
      orderId: order.id,
      eventTitle: order.event.title,
      eventDate,
      eventTime,
      eventLocation: order.event.location || 'TBA',
      eventImageUrl: bannerUrl,
      organizerName: order.event.organization?.name,
      organizerLogoUrl: logoUrl,
      ticketStyle: order.tickets[0]?.ticketType?.ticketStyle || null,
      accentColor: order.tickets[0]?.ticketType?.accentColor || null,
      tickets: order.tickets.map((t) => ({
        id: t.id,
        qrCode: t.qrCode,
        ticketTypeName: t.ticketType?.name || 'General Admission',
        guestName: `${t.user?.firstName || ''} ${t.user?.lastName || ''}`.trim(),
      })),
    });
  } catch (error: any) {
    console.error('[Admin] getOrderTicketsData error:', error);
    return res.status(500).json({ message: error.message || 'Server error fetching order tickets data' });
  }
};

/**
 * Admin: Download all tickets for an order as a ZIP archive of separate individual PDF files.
 * GET /admin/orders/:orderId/tickets-zip
 */
export const downloadOrderTicketsZip = async (req: AuthRequest, res: Response) => {
  try {
    const { orderId } = req.params;
    const isNumeric = /^\d+$/.test(orderId);

    const order = await prisma.order.findFirst({
      where: isNumeric
        ? { id: parseInt(orderId, 10) }
        : { paymentReference: orderId },
      include: {
        event: {
          include: { organization: true },
        },
        tickets: {
          include: { ticketType: true, user: true },
        },
      },
    });

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    const { buildTicketPdf, preloadTicketImages } = await import('../services/ticketPdf');
    const eventDate = order.event.startDate
      ? new Date(order.event.startDate).toLocaleDateString()
      : 'TBA';
    const eventTime = order.event.startDate
      ? new Date(order.event.startDate).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    const backendBase = (
      process.env.BACKEND_URL ||
      process.env.API_BASE_URL ||
      process.env.EMAIL_ASSET_BASE ||
      'https://api.partystorm.ng'
    ).replace(/\/$/, '');
    const toAbsolute = (u?: string | null) => {
      if (!u?.trim()) return null;
      const clean = u.trim();
      if (/^https?:\/\//i.test(clean)) return clean;
      return `${backendBase}${clean.startsWith('/') ? '' : '/'}${clean}`;
    };

    const safeTitle = order.event.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .slice(0, 30);
    const zipFilename = `${safeTitle}-tickets-separate-${order.tickets.length}.zip`;

    // Dynamically load archiver with CJS and ESM fallback so Vercel never crashes on ERR_REQUIRE_ESM
    let archiverMod: any;
    try {
      archiverMod = require('archiver');
    } catch (err: any) {
      if (err?.code === 'ERR_REQUIRE_ESM') {
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        archiverMod = await dynamicImport('archiver');
      } else {
        throw err;
      }
    }
    const archiverFactory = archiverMod.default || archiverMod;
    const archive =
      typeof archiverFactory === 'function'
        ? archiverFactory('zip', { zlib: { level: 6 } })
        : archiverFactory.ZipArchive
          ? new archiverFactory.ZipArchive({ zlib: { level: 6 } })
          : archiverFactory.create('zip', { zlib: { level: 6 } });

    // Buffer zip into memory to prevent serverless stream cutoff or freezing on Vercel
    const chunks: Buffer[] = [];
    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    const archiveDone = new Promise<void>((resolve, reject) => {
      archive.on('end', resolve);
      archive.on('error', reject);
    });

    const validTickets = order.tickets.filter((t) => Boolean(t.qrCode));
    const bannerUrl = toAbsolute(order.event.imageUrl);
    const logoUrl = toAbsolute(order.event.organization?.logo);

    // Preload shared event images ONCE to avoid 40 sequential network fetches
    const preloaded = await preloadTicketImages(bannerUrl, logoUrl);

    const items = validTickets.map((t, i) => {
      const fullName = `${t.user?.firstName || ''} ${t.user?.lastName || ''}`.trim();
      const guestName = fullName
        ? fullName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
        : '';

      return {
        filename: `ticket-${String(i + 1).padStart(2, '0')}-TKT-${String(t.id).padStart(6, '0')}${guestName ? `-${guestName}` : ''}.pdf`,
        pass: {
          id: t.id,
          qrCode: t.qrCode,
          ticketTypeName: t.ticketType?.name || 'General Admission',
          eventTitle: order.event.title,
          eventDate,
          eventTime,
          eventLocation: order.event.location || 'TBA',
          eventImageUrl: bannerUrl,
          accentColor: t.ticketType?.accentColor || null,
          ticketStyle: t.ticketType?.ticketStyle || null,
          organizerLogoUrl: logoUrl,
        },
      };
    });

    // Render in parallel batches of 10 for blazing fast generation
    for (let i = 0; i < items.length; i += 10) {
      const chunk = items.slice(i, i + 10);
      const rendered = await Promise.all(
        chunk.map(async (item) => ({
          filename: item.filename,
          buffer: await buildTicketPdf(item.pass, preloaded),
        }))
      );
      for (const r of rendered) {
        archive.append(r.buffer, { name: r.filename });
      }
    }

    await archive.finalize();
    await archiveDone;

    const zipBuffer = Buffer.concat(chunks);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipFilename}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    return res.end(zipBuffer);
  } catch (error: any) {
    console.error('[Admin] downloadOrderTicketsZip error:', error);
    if (!res.headersSent) {
      return res.status(500).json({ message: error.message || 'Server error generating tickets zip' });
    }
  }
};

/**
 * Admin: Download a single standalone ticket as PDF.
 * GET /admin/tickets/:ticketId/pdf
 */
export const downloadSingleTicketPdf = async (req: AuthRequest, res: Response) => {
  try {
    const { ticketId } = req.params;
    const id = parseInt(ticketId, 10);
    if (isNaN(id)) {
      return res.status(400).json({ message: 'Invalid ticket ID' });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      include: {
        event: { include: { organization: true } },
        ticketType: true,
        user: true,
      },
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    const { buildTicketPdf } = await import('../services/ticketPdf');
    const eventDate = ticket.event.startDate
      ? new Date(ticket.event.startDate).toLocaleDateString()
      : 'TBA';
    const eventTime = ticket.event.startDate
      ? new Date(ticket.event.startDate).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        })
      : null;

    const backendBase = (
      process.env.BACKEND_URL ||
      process.env.API_BASE_URL ||
      process.env.EMAIL_ASSET_BASE ||
      'https://api.partystorm.ng'
    ).replace(/\/$/, '');
    const toAbsolute = (u?: string | null) => {
      if (!u?.trim()) return null;
      const clean = u.trim();
      if (/^https?:\/\//i.test(clean)) return clean;
      return `${backendBase}${clean.startsWith('/') ? '' : '/'}${clean}`;
    };

    const pass = {
      id: ticket.id,
      qrCode: ticket.qrCode,
      ticketTypeName: ticket.ticketType?.name || 'General Admission',
      eventTitle: ticket.event.title,
      eventDate,
      eventTime,
      eventLocation: ticket.event.location || 'TBA',
      eventImageUrl: toAbsolute(ticket.event.imageUrl),
      accentColor: ticket.ticketType?.accentColor || null,
      ticketStyle: ticket.ticketType?.ticketStyle || null,
      organizerLogoUrl: toAbsolute(ticket.event.organization?.logo),
    };

    const pdfBuffer = await buildTicketPdf(pass);
    const serial = `TKT-${String(ticket.id).padStart(6, '0')}`;
    const filename = `ticket-${serial}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.end(pdfBuffer);
  } catch (error: any) {
    console.error('[Admin] downloadSingleTicketPdf error:', error);
    return res.status(500).json({ message: error.message || 'Server error generating ticket PDF' });
  }
};
