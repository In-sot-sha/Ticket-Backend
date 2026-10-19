import { Response } from 'express';
import { BookEntryType, Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';

const PAYMENT_METHODS = new Set(['CASH', 'TRANSFER', 'POS', 'OTHER']);

function parseType(raw: unknown): BookEntryType | null {
  if (raw === 'INCOME' || raw === 'EXPENSE') return raw;
  return null;
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

function buildWhere(query: AuthRequest['query']): Prisma.CompanyBookEntryWhereInput {
  const where: Prisma.CompanyBookEntryWhereInput = {};
  const type = parseType(query.type);
  if (type) where.type = type;

  const from = parseDate(query.from);
  const to = parseDate(query.to);
  if (from || to) {
    where.occurredAt = {};
    if (from) where.occurredAt.gte = from;
    if (to) {
      const end = new Date(to);
      end.setHours(23, 59, 59, 999);
      where.occurredAt.lte = end;
    }
  }

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
    const entries = await prisma.companyBookEntry.findMany({
      where,
      include: { recordedBy: { select: recordedBySelect } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: Math.min(500, Math.max(1, Number(req.query.limit) || 200)),
    });
    return res.json(entries);
  } catch (error) {
    console.error('[companyBooks] list', error);
    return res.status(500).json({ message: 'Server error' });
  }
};

export const summarizeCompanyBooks = async (req: AuthRequest, res: Response) => {
  try {
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
