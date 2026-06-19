import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { PLATFORM_FEE_RATE } from '../constants/fees';

const paidOrderFilter = { status: 'PAID' as const };

export const getDashboardStats = async (_req: AuthRequest, res: Response) => {
  try {
    const [totalUsers, pendingHosts, verifiedHosts, totalEvents, totalTickets, revenueAgg, openTickets] =
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
        prisma.supportTicket.count({ where: { status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      ]);

    return res.json({
      totalUsers,
      pendingHosts,
      verifiedHosts,
      totalEvents,
      totalTickets,
      totalOrders: revenueAgg._count,
      totalGmv: revenueAgg._sum.totalAmount ?? 0,
      platformRevenue: revenueAgg._sum.platformFee ?? 0,
      processingFees: revenueAgg._sum.processingFee ?? 0,
      organizerPayouts: revenueAgg._sum.netAmount ?? 0,
      openSupportTickets: openTickets,
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

    const [orders, total] = await Promise.all([
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
        skip,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return res.json({
      transactions: orders.map((o: any) => ({
        id: o.id,
        totalAmount: o.totalAmount,
        platformFee: o.platformFee,
        processingFee: o.processingFee,
        netAmount: o.netAmount,
        status: o.status,
        purchaseType: o.purchaseType,
        createdAt: o.createdAt,
        ticketCount: o._count.tickets,
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
      })),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const getRevenue = async (_req: AuthRequest, res: Response) => {
  try {
    const [agg, monthlyRaw, byEventRaw] = await Promise.all([
      prisma.order.aggregate({
        where: paidOrderFilter,
        _sum: { totalAmount: true, platformFee: true, processingFee: true, netAmount: true },
        _count: true,
      }),
      prisma.order.findMany({
        where: paidOrderFilter,
        select: { createdAt: true, totalAmount: true, platformFee: true, netAmount: true },
        orderBy: { createdAt: 'asc' },
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
    ]);

    const monthlyMap = new Map<string, { gmv: number; platformFee: number; netAmount: number; orders: number }>();
    for (const o of monthlyRaw) {
      const key = `${o.createdAt.getFullYear()}-${String(o.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const cur = monthlyMap.get(key) ?? { gmv: 0, platformFee: 0, netAmount: 0, orders: 0 };
      cur.gmv += o.totalAmount;
      cur.platformFee += o.platformFee;
      cur.netAmount += o.netAmount;
      cur.orders += 1;
      monthlyMap.set(key, cur);
    }

    const eventMap = new Map<number, { eventId: number; title: string; gmv: number; platformFee: number; orders: number }>();
    for (const o of byEventRaw) {
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

    return res.json({
      summary: {
        totalOrders: agg._count,
        totalGmv: agg._sum.totalAmount ?? 0,
        platformRevenue: agg._sum.platformFee ?? 0,
        processingFees: agg._sum.processingFee ?? 0,
        organizerPayouts: agg._sum.netAmount ?? 0,
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
    const { body, status } = req.body;

    if (!body?.trim()) {
      return res.status(400).json({ message: 'Reply message is required' });
    }

    const ticket = await prisma.supportTicket.findUnique({ where: { id } });
    if (!ticket) return res.status(404).json({ message: 'Ticket not found' });

    const allowedStatuses = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'];
    const newStatus = status && allowedStatuses.includes(status) ? status : 'IN_PROGRESS';

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

    return res.json({ message: 'Reply sent', reply: message });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateSupportTicket = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { status, priority } = req.body;

    const data: Record<string, unknown> = { updatedAt: new Date() };
    if (status) data.status = status;
    if (priority) data.priority = priority;

    const ticket = await prisma.supportTicket.update({
      where: { id },
      data,
    });

    return res.json({ message: 'Ticket updated', ticket });
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
        createdAt: true,
        ownedOrganizations: {
          select: { id: true, name: true, isVerified: true },
        },
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
