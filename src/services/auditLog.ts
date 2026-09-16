import { prisma } from '../prisma';

export async function writeAuditLog(entry: {
  action: string;
  entity: string;
  entityId?: string | number | null;
  eventId?: number | null;
  userId?: number | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        action: entry.action,
        entity: entry.entity,
        entityId: entry.entityId != null ? String(entry.entityId) : null,
        eventId: entry.eventId ?? null,
        userId: entry.userId ?? null,
        metadata: entry.metadata as any,
      },
    });
  } catch (err) {
    console.error('Failed to write audit log', err);
  }
}
