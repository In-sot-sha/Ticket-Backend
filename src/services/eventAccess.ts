import { prisma } from '../prisma';
import { resolveStaffAccess, StaffCapability } from './staffAccess';

const GATE_VIEW_CAPS: StaffCapability[] = ['SCAN', 'WALK_IN_SALE', 'CHECK_IN', 'GATE_MANAGE'];

export async function authorizeEventOps(
  userId: number,
  role: string | undefined,
  eventId: number,
  capability: StaffCapability | StaffCapability[]
) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { organization: { include: { members: true } } },
  });

  if (!event) {
    throw Object.assign(new Error('Event not found'), { status: 404 });
  }

  const isMember = event.organization?.members.some((m) => m.userId === userId) ?? false;
  const isOwner = event.organization?.ownerId === userId;
  if (isMember || isOwner || role === 'ADMIN') {
    return { event, via: 'org' as const };
  }

  const needed = Array.isArray(capability) ? capability : [capability];
  const access = await resolveStaffAccess(userId, eventId);
  if (!access.allowed || !needed.some((cap) => access.capabilities.includes(cap))) {
    throw Object.assign(new Error('Not authorized'), { status: 403 });
  }

  return { event, via: 'staff' as const, access };
}

export function canViewGateOps(capabilities: StaffCapability[]) {
  return capabilities.some((cap) => GATE_VIEW_CAPS.includes(cap));
}
