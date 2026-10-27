import { Response } from 'express';
import { BookEntryType, Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';

const PAYMENT_METHODS = new Set(['CASH', 'TRANSFER', 'POS', 'OTHER']);

function parseType(raw: unknown): BookEntryType | null {
  if (raw === 'INCOME' || raw === 'EXPENSE') return raw;
  return null;
}

function parseEventId(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

function parseAmount(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

function parseDate(raw: unknown): Date | null {
  if (raw == null || raw === '') return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function occurredRange(query: AuthRequest['query']): Prisma.DateTimeFilter | undefined {
  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (!from && !to) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (from) range.gte = from;
  if (to) {
    const end = new Date(to);
    end.setHours(23, 59, 59, 999);
    range.lte = end;
  }
  return range;
}

/** What PartyStorm keeps after Paystack on an online sale. Gate cash is not included. */
function ourCut(platformFee: number, processingFee = 0) {
  const cut = Math.round((Number(platformFee) || 0) - (Number(processingFee) || 0));
  return cut > 0 ? cut : 0;
}

type TicketCutEntry = {
  id: string;
  source: 'TICKET';
  type: 'INCOME';
  amount: number;
  category: string;
  description: string;
  occurredAt: Date;
  paymentMethod: string | null;
  recordedBy: null;
};

function matchesTicketSearch(search: string, parts: string[]) {
  if (!search) return true;
  return parts.join(' ').toLowerCase().includes(search);
}

/** Online sales only. The cut is collected at checkout. Gate sales stay with the host. */
async function loadTicketCuts(
  query: AuthRequest['query'],
  take?: number,
): Promise<TicketCutEntry[]> {
  const range = occurredRange(query);
  const search = String(query.search || '').trim().toLowerCase();
  const eventId = parseEventId(query.eventId);
  const createdAt = range ? { createdAt: range } : {};
  const eventWhere = eventId ? { eventId } : {};
  const pageSize = take ?? 500;

  const orders: Array<{
    id: number;
    platformFee: number;
    processingFee: number;
    createdAt: Date;
    event: { title: string } | null;
  }> = [];

  let orderCursor: number | undefined;
  const orderCap = take ?? 20000;

  while (orders.length < orderCap) {
    const batch = await prisma.order.findMany({
      where: { status: 'PAID', platformFee: { gt: 0 }, ...eventWhere, ...createdAt },
      select: {
        id: true,
        platformFee: true,
        processingFee: true,
        createdAt: true,
        event: { select: { title: true } },
      },
      orderBy: { id: 'desc' },
      take: Math.min(pageSize, orderCap - orders.length),
      ...(orderCursor ? { skip: 1, cursor: { id: orderCursor } } : {}),
    });
    orders.push(...batch);
    if (batch.length < pageSize || take != null) break;
    orderCursor = batch[batch.length - 1]?.id;
    if (!orderCursor) break;
  }

  const rows: TicketCutEntry[] = [];

  for (const order of orders) {
    const amount = ourCut(order.platformFee, order.processingFee);
    if (amount <= 0) continue;
    const title = order.event?.title || 'Event';
    const description = `${title} · Order #${order.id}`;
    if (!matchesTicketSearch(search, ['Ticket cut', 'ticket sale', description, title])) continue;
    rows.push({
      id: `order-${order.id}`,
      source: 'TICKET',
      type: 'INCOME',
      amount,
      category: 'Ticket cut',
      description,
      occurredAt: order.createdAt,
      paymentMethod: 'TRANSFER',
      recordedBy: null,
    });
  }

  return rows;
}

function buildWhere(query: AuthRequest['query']): Prisma.CompanyBookEntryWhereInput {
  const where: Prisma.CompanyBookEntryWhereInput = {};
  const type = parseType(query.type);
  if (type) where.type = type;

  const range = occurredRange(query);
  if (range) where.occurredAt = range;

  const search = String(query.search || '').trim();
  if (search) {
    where.OR = [
      { category: { contains: search } },
      { description: { contains: search } },
    ];
  }

  return where;
}

const recordedBySelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

export const listCompanyBooks = async (req: AuthRequest, res: Response) => {
  try {
    const where = buildWhere(req.query);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
    const eventId = parseEventId(req.query.eventId);
    const includeCuts = parseType(req.query.type) !== 'EXPENSE';
    const [entries, cuts] = await Promise.all([
      eventId
        ? Promise.resolve([])
        : prisma.companyBookEntry.findMany({
            where,
            include: { recordedBy: { select: recordedBySelect } },
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            take: 500,
          }),
      includeCuts ? loadTicketCuts(req.query, eventId ? undefined : 400) : Promise.resolve([]),
    ]);

    const merged = [
      ...entries.map((entry) => ({ ...entry, source: 'MANUAL' as const })),
      ...cuts,
    ]
      .sort((a, b) => {
        const delta = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
        if (delta !== 0) return delta;
        return String(b.id).localeCompare(String(a.id));
      })
      .slice(0, limit);

    return res.json(merged);
  } catch (error) {
    console.error('[companyBooks] list', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const listBookEvents = async (_req: AuthRequest, res: Response) => {
  try {
    const orders = await prisma.order.findMany({
      where: { status: 'PAID', platformFee: { gt: 0 } },
      distinct: ['eventId'],
      select: { eventId: true, event: { select: { title: true } } },
    });

    const byId = new Map<number, string>();
    for (const row of orders) {
      if (row.eventId && row.event?.title) byId.set(row.eventId, row.event.title);
    }
    const events = Array.from(byId.entries())
      .map(([id, title]) => ({ id, title }))
      .sort((a, b) => a.title.localeCompare(b.title));
    return res.json(events);
  } catch (error) {
    console.error('[companyBooks] events', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const summarizeCompanyBooks = async (req: AuthRequest, res: Response) => {
  try {
    const eventId = parseEventId(req.query.eventId);
    if (eventId) {
      const cuts = await loadTicketCuts(req.query);
      const income = cuts.reduce((sum, cut) => sum + cut.amount, 0);
      return res.json({
        income,
        expense: 0,
        net: income,
        incomeCount: cuts.length,
        expenseCount: 0,
        totalCount: cuts.length,
      });
    }

    const where = buildWhere(req.query);
    const groups = await prisma.companyBookEntry.groupBy({
      by: ['type'],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    });

    let income = 0;
    let expense = 0;
    let incomeCount = 0;
    let expenseCount = 0;
    for (const row of groups) {
      const sum = row._sum.amount ?? 0;
      if (row.type === 'INCOME') {
        income = sum;
        incomeCount = row._count._all;
      } else {
        expense = sum;
        expenseCount = row._count._all;
      }
    }

    if (parseType(req.query.type) !== 'EXPENSE') {
      const cuts = await loadTicketCuts(req.query);
      for (const cut of cuts) {
        income += cut.amount;
        incomeCount += 1;
      }
    }

    return res.json({
      income,
      expense,
      net: income - expense,
      incomeCount,
      expenseCount,
      totalCount: incomeCount + expenseCount,
    });
  } catch (error) {
    console.error('[companyBooks] summary', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const createCompanyBook = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const type = parseType(req.body?.type);
    const amount = parseAmount(req.body?.amount);
    const category = String(req.body?.category || '').trim();
    const occurredAt = parseDate(req.body?.occurredAt);
    const description =
      req.body?.description == null || String(req.body.description).trim() === ''
        ? null
        : String(req.body.description).trim();
    const paymentRaw = req.body?.paymentMethod
      ? String(req.body.paymentMethod).trim().toUpperCase()
      : null;
    const paymentMethod =
      paymentRaw && PAYMENT_METHODS.has(paymentRaw) ? paymentRaw : paymentRaw || null;

    if (!type) {
      return res.status(400).json({ message: 'type must be INCOME or EXPENSE' });
    }
    if (amount == null) {
      return res.status(400).json({ message: 'amount must be a number greater than 0' });
    }
    if (!category) {
      return res.status(400).json({ message: 'category is required' });
    }
    if (!occurredAt) {
      return res.status(400).json({ message: 'occurredAt is required' });
    }

    const entry = await prisma.companyBookEntry.create({
      data: {
        type,
        amount,
        category,
        description,
        occurredAt,
        paymentMethod,
        recordedById: req.userId,
      },
      include: { recordedBy: { select: recordedBySelect } },
    });

    return res.status(201).json({ message: 'Entry recorded', entry });
  } catch (error) {
    console.error('[companyBooks] create', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const updateCompanyBook = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid entry ID' });
    }

    const existing = await prisma.companyBookEntry.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    const data: Prisma.CompanyBookEntryUpdateInput = {};

    if (req.body?.type !== undefined) {
      const type = parseType(req.body.type);
      if (!type) return res.status(400).json({ message: 'type must be INCOME or EXPENSE' });
      data.type = type;
    }
    if (req.body?.amount !== undefined) {
      const amount = parseAmount(req.body.amount);
      if (amount == null) {
        return res.status(400).json({ message: 'amount must be a number greater than 0' });
      }
      data.amount = amount;
    }
    if (req.body?.category !== undefined) {
      const category = String(req.body.category || '').trim();
      if (!category) return res.status(400).json({ message: 'category is required' });
      data.category = category;
    }
    if (req.body?.occurredAt !== undefined) {
      const occurredAt = parseDate(req.body.occurredAt);
      if (!occurredAt) return res.status(400).json({ message: 'occurredAt is required' });
      data.occurredAt = occurredAt;
    }
    if (req.body?.description !== undefined) {
      data.description =
        req.body.description == null || String(req.body.description).trim() === ''
          ? null
          : String(req.body.description).trim();
    }
    if (req.body?.paymentMethod !== undefined) {
      const paymentRaw = req.body.paymentMethod
        ? String(req.body.paymentMethod).trim().toUpperCase()
        : null;
      data.paymentMethod =
        paymentRaw && PAYMENT_METHODS.has(paymentRaw) ? paymentRaw : paymentRaw || null;
    }

    const entry = await prisma.companyBookEntry.update({
      where: { id },
      data,
      include: { recordedBy: { select: recordedBySelect } },
    });

    return res.json({ message: 'Entry updated', entry });
  } catch (error) {
    console.error('[companyBooks] update', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const deleteCompanyBook = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id) || id <= 0) {
      return res.status(400).json({ message: 'Invalid entry ID' });
    }

    const existing = await prisma.companyBookEntry.findUnique({ where: { id } });
    if (!existing) {
      return res.status(404).json({ message: 'Entry not found' });
    }

    await prisma.companyBookEntry.delete({ where: { id } });
    return res.json({ message: 'Entry deleted' });
  } catch (error) {
    console.error('[companyBooks] delete', error);
    return res.status(500).json({ message: 'Server error' });
  }
};
