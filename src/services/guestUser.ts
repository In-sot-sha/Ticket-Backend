import { prisma } from '../prisma';
import { isValidEmail, normalizePhone, sanitizeString } from '../utils/validation';

export type GuestContact = {
  name: string;
  email?: string | null;
  phone?: string | null;
};

/**
 * Find a user by email (lowercased) or normalized phone.
 */
export const findUserByIdentifier = async (identifier: string) => {
  const raw = identifier?.trim();
  if (!raw) return null;

  if (raw.includes('@')) {
    const email = raw.toLowerCase();
    if (!isValidEmail(email)) return null;
    return prisma.user.findUnique({ where: { email } });
  }

  const phone = normalizePhone(raw);
  if (!phone) return null;
  return prisma.user.findUnique({ where: { phone } });
};

/**
 * Find users matching email and/or phone (for maxPerPerson across identities).
 */
export const findUsersByContact = async (email?: string | null, phone?: string | null) => {
  const or: Array<{ email: string } | { phone: string }> = [];
  const cleanEmail = email?.trim().toLowerCase();
  if (cleanEmail && isValidEmail(cleanEmail)) {
    or.push({ email: cleanEmail });
  }
  const cleanPhone = phone ? normalizePhone(phone) : null;
  if (cleanPhone) {
    or.push({ phone: cleanPhone });
  }
  if (or.length === 0) return [];

  return prisma.user.findMany({ where: { OR: or } });
};

/**
 * Count VALID/USED tickets for a ticket type owned by any of the given user IDs.
 */
export const countOwnedTickets = async (
  eventId: number,
  ticketTypeId: number,
  userIds: number[]
): Promise<number> => {
  if (userIds.length === 0) return 0;
  return prisma.ticket.count({
    where: {
      eventId,
      ticketTypeId,
      userId: { in: userIds },
      status: { in: ['VALID', 'USED'] },
    },
  });
};

export const getMaxPerPerson = (ticketType: { maxPerPerson?: number | null; price?: number }): number => {
  // Free tickets: hard limit of 1 per account (email/phone)
  if (Number(ticketType.price) === 0) {
    return 1;
  }
  if (ticketType.maxPerPerson != null && ticketType.maxPerPerson > 0) {
    return ticketType.maxPerPerson;
  }
  // Paid tickets: schema default
  return 5;
};

/**
 * Find or create a guest user from name + email and/or phone.
 * Requires at least one valid contact.
 */
export const getOrCreateGuestUser = async ({ name, email, phone }: GuestContact) => {
  const cleanEmail = email?.trim().toLowerCase() || null;
  const cleanPhone = phone ? normalizePhone(phone) : null;

  if (cleanEmail && !isValidEmail(cleanEmail)) {
    throw new Error('INVALID_EMAIL');
  }
  if (phone && !cleanPhone) {
    throw new Error('INVALID_PHONE');
  }
  if (!cleanEmail && !cleanPhone) {
    throw new Error('CONTACT_REQUIRED');
  }

  const nameParts = sanitizeString(name || '').split(/\s+/).filter(Boolean);
  const firstName = nameParts[0] || 'Guest';
  const lastName = nameParts.slice(1).join(' ') || 'Guest';

  let user =
    (cleanEmail ? await prisma.user.findUnique({ where: { email: cleanEmail } }) : null) ||
    (cleanPhone ? await prisma.user.findUnique({ where: { phone: cleanPhone } }) : null);

  if (user) {
    const updates: { phone?: string; email?: string; firstName?: string; lastName?: string } = {};
    if (cleanPhone && !user.phone) updates.phone = cleanPhone;
    if (cleanEmail && !user.email) updates.email = cleanEmail;
    if (Object.keys(updates).length > 0) {
      user = await prisma.user.update({ where: { id: user.id }, data: updates });
    }
    return user;
  }

  return prisma.user.create({
    data: {
      email: cleanEmail,
      phone: cleanPhone,
      firstName,
      lastName,
      isGuest: true,
      role: 'USER',
    },
  });
};

/**
 * Assert quantity does not exceed maxPerPerson for the contact / user IDs.
 * Returns owned count when OK; throws Error with message for 400 responses.
 */
export const assertMaxPerPerson = async (opts: {
  eventId: number;
  ticketTypeId: number;
  quantity: number;
  maxPerPerson: number;
  email?: string | null;
  phone?: string | null;
  extraUserIds?: number[];
}): Promise<{ owned: number; remaining: number; maxPerPerson: number }> => {
  const users = await findUsersByContact(opts.email, opts.phone);
  const userIds = Array.from(
    new Set([...users.map((u) => u.id), ...(opts.extraUserIds || [])].filter(Boolean))
  );
  const owned = await countOwnedTickets(opts.eventId, opts.ticketTypeId, userIds);
  const remaining = Math.max(0, opts.maxPerPerson - owned);

  if (owned + opts.quantity > opts.maxPerPerson) {
    const err = new Error(
      `You already have ${owned} of this ticket (limit ${opts.maxPerPerson}).`
    ) as Error & { code: string; owned: number; maxPerPerson: number; remaining: number };
    err.code = 'MAX_PER_PERSON';
    err.owned = owned;
    err.maxPerPerson = opts.maxPerPerson;
    err.remaining = remaining;
    throw err;
  }

  return { owned, remaining, maxPerPerson: opts.maxPerPerson };
};
