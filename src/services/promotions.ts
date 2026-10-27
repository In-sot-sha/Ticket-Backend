import { Prisma } from '@prisma/client';
import { prisma } from '../prisma';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Homepage placement only while the event has not ended and the promotion window is open. */
export function livePromotionWhere(now = new Date()): Prisma.EventWhereInput {
  return {
    isPromoted: true,
    endDate: { gte: now },
    OR: [{ promotedUntil: null }, { promotedUntil: { gte: now } }],
  };
}

/** Drop the stored flag a week after the event ends. */
export async function clearStalePromotions() {
  const cutoff = new Date(Date.now() - WEEK_MS);
  const result = await prisma.event.updateMany({
    where: {
      isPromoted: true,
      endDate: { lt: cutoff },
    },
    data: { isPromoted: false, promotedUntil: null },
  });
  return result.count;
}
