import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { PLATFORM_FEE_RATE } from '../constants/fees';
import {
  sendEmail,
  generateSupportReplyEmail,
  generateSupportResolvedEmail,
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
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const skip = (page - 1) * limit;

    const where = status && status !== 'all' ? { status: status as any } : {};

    // For vendor applications, filter status by paymentStatus
    const vendorWhere = status && status !== 'all' ? { paymentStatus: status as any } : {};

    const [orders, totalOrders, vendorApps, totalVendors] = await Promise.all([
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
            select: { id: true, ticketType: { select: { name: true } } },
          },
          _count: { select: { tickets: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.count({ where }),
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
      prisma.vendorApplication.count({ where: vendorWhere }),
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
    const merged = [...formattedOrders, ...formattedVendors].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    const total = totalOrders + totalVendors;
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

export const replyToSupportTicket = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { body, status, needsMoreInfo } = req.body;

    if (!body?.trim()) {
      return res.status(400).json({ message: 'Reply message is required' });
    }

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

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

    const to = ticket.contactEmail;
    if (to) {
      const supportUrl = `${frontendBase()}/support`;
      if (newStatus === 'RESOLVED') {
        const tpl = generateSupportResolvedEmail({
          name: ticket.contactName,
          subject: ticket.subject,
          ticketId: ticket.id,
          note: body.trim(),
          supportUrl,
        });
        void sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
      } else {
        const tpl = generateSupportReplyEmail({
          name: ticket.contactName,
          subject: ticket.subject,
          ticketId: ticket.id,
          replyBody: body.trim(),
          needsMoreInfo: Boolean(needsMoreInfo),
          supportUrl,
        });
        void sendEmail({ to, subject: tpl.subject, html: tpl.html, text: tpl.text });
      }
    }

    return res.json({ message: 'Reply sent', reply: message, emailSent: Boolean(to) });
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
        opsProjects: {
          select: { id: true, title: true, status: true },
          take: 5,
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
