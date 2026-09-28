import { prisma } from '../prisma';

export type StaffCapability =
  | 'SCAN'
  | 'WALK_IN_SALE'
  | 'CHECK_IN'
  | 'GATE_MANAGE'
  | 'SUPPORT';

export interface StaffAccessResult {
  allowed: boolean;
  capabilities: StaffCapability[];
  reason?: string;
}

const ALL_CAPS: StaffCapability[] = [
  'SCAN',
  'WALK_IN_SALE',
  'CHECK_IN',
  'GATE_MANAGE',
  'SUPPORT',
];

function parseCaps(raw: unknown): StaffCapability[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean) as StaffCapability[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as StaffCapability[];
    } catch {
      return raw.split(',').map((s) => s.trim()).filter(Boolean) as StaffCapability[];
    }
  }
  return [];
}

function startOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d = new Date()) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function isTodayEvent(startDate: Date, endDate?: Date | null) {
  const dayStart = startOfLocalDay().getTime();
  const dayEnd = endOfLocalDay().getTime();
  const start = startDate.getTime();
  const end = endDate ? endDate.getTime() : start;
  return start <= dayEnd && end >= dayStart;
}

/**
 * Resolve whether a user can operate on an event and with which capabilities.
 */
export async function resolveStaffAccess(
  userId: number,
  eventId: number
): Promise<StaffAccessResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { staffProfile: true },
  });

  if (!user) {
    return { allowed: false, capabilities: [], reason: 'User not found' };
  }

  if (user.role === 'ADMIN') {
    return { allowed: true, capabilities: ALL_CAPS };
  }

  if (!user.isStaff || !user.staffProfile?.active) {
    return { allowed: false, capabilities: [], reason: 'Not active staff' };
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, organizationId: true, startDate: true },
  });

  if (!event || !event.organizationId) {
    return { allowed: false, capabilities: [], reason: 'Event not found' };
  }

  const baseCaps = parseCaps(user.staffProfile.capabilities);
  let allowed = false;
  let caps = [...baseCaps];

  const projectAssignments = await prisma.staffProjectAssignment.findMany({
    where: { userId },
    include: { project: true },
  });

  for (const assignment of projectAssignments) {
    const p = assignment.project;
    if (p.status === 'CLOSED') continue;

    const linked = p.eventId === eventId;
    if (linked) {
      allowed = true;
      const override = parseCaps(assignment.capabilitiesOverride);
      if (override.length) caps = [...new Set([...caps, ...override])];
    }
  }

  if (!allowed) {
    return { allowed: false, capabilities: [], reason: 'No assignment for this event' };
  }

  return { allowed: true, capabilities: caps.length ? caps : baseCaps };
}

/** Events + projects + today’s gate checklist for staff home */
export async function getStaffHome(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { staffProfile: true },
  });

  if (!user?.isStaff || !user.staffProfile?.active) {
    return {
      profile: null,
      orgCoverage: [],
      projects: [],
      events: [],
      todayGates: [],
    };
  }

  const caps = parseCaps(user.staffProfile.capabilities);

  const orgCoverage = await prisma.staffOrgCoverage.findMany({
    where: { userId },
    include: { organization: { select: { id: true, name: true } } },
  });

  const assignments = await prisma.staffProjectAssignment.findMany({
    where: { userId },
    include: {
      project: {
        include: {
          organization: { select: { id: true, name: true } },
          event: {
            select: {
              id: true,
              title: true,
              slug: true,
              startDate: true,
              endDate: true,
              location: true,
              organizationId: true,
            },
          },
          assignments: {
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
          },
        },
      },
    },
  });

  const projects = assignments
    .map((a) => a.project)
    .filter((p) => p.status !== 'CLOSED');

  const linkedEventIds = projects.map((p) => p.eventId).filter(Boolean) as number[];

  const events =
    linkedEventIds.length > 0
      ? await prisma.event.findMany({
          where: { id: { in: linkedEventIds } },
          select: {
            id: true,
            title: true,
            slug: true,
            startDate: true,
            endDate: true,
            location: true,
            organizationId: true,
            organization: { select: { id: true, name: true } },
          },
          orderBy: { startDate: 'asc' },
        })
      : [];

  const allOrgIds = [
    ...new Set(
      [
        ...events.map((e) => e.organizationId).filter(Boolean),
        ...projects.map((p) => p.organizationId).filter(Boolean),
      ].filter(Boolean) as number[]
    ),
  ];

  const pinGroups =
    allOrgIds.length > 0
      ? await prisma.gatePin.groupBy({
          by: ['organizationId'],
          where: { organizationId: { in: allOrgIds } },
          _count: { _all: true },
        })
      : [];
  const pinCountByOrg = new Map(
    pinGroups.map((g) => [g.organizationId, g._count._all])
  );

  // All staff on projects that touch these events (for “who’s assigned”)
  const projectByEvent = new Map<number, typeof projects>();
  for (const p of projects) {
    if (!p.eventId) continue;
    const list = projectByEvent.get(p.eventId) || [];
    list.push(p);
    projectByEvent.set(p.eventId, list);
  }

  const enrichedEvents = events.map((e) => {
    const orgId = e.organizationId!;
    const pinCount = pinCountByOrg.get(orgId) || 0;
    const relatedProjects = [
      ...(projectByEvent.get(e.id) || []),
      ...projects.filter(
        (p) =>
          !p.eventId &&
          p.organizationId === orgId &&
          (p.status === 'ACTIVE' || p.status === 'LINKED')
      ),
    ];
    const assignedMap = new Map<number, { id: number; name: string }>();
    for (const p of relatedProjects) {
      for (const a of p.assignments || []) {
        assignedMap.set(a.user.id, {
          id: a.user.id,
          name: `${a.user.firstName} ${a.user.lastName}`.trim(),
        });
      }
    }
    const assignedStaff = Array.from(assignedMap.values());
    const today = isTodayEvent(e.startDate, e.endDate);
    const canWalkIn = caps.includes('WALK_IN_SALE');
    const canScan = caps.includes('SCAN') || caps.includes('CHECK_IN');

    const checklist = [
      {
        id: 'event',
        label: 'Event on coverage',
        done: true,
      },
      {
        id: 'team',
        label: assignedStaff.length
          ? `Team assigned (${assignedStaff.length})`
          : 'Team assigned on ops project',
        done: assignedStaff.length > 0,
      },
      {
        id: 'pins',
        label:
          pinCount > 0
            ? `Gate PINs ready (${pinCount})`
            : 'Gate PINs issued for this org',
        done: pinCount > 0,
      },
      {
        id: 'walkin',
        label: 'Walk-in capability',
        done: canWalkIn,
      },
      {
        id: 'scan',
        label: 'Scan capability',
        done: canScan,
      },
    ];

    return {
      id: e.id,
      title: e.title,
      slug: e.slug,
      startDate: e.startDate,
      endDate: e.endDate,
      location: e.location,
      organizationId: orgId,
      organizationName: e.organization?.name || null,
      isToday: today,
      gatePinCount: pinCount,
      assignedStaff,
      projectTitles: relatedProjects.map((p) => p.title),
      checklist,
      checklistReady: checklist.every((c) => c.done),
      canWalkIn,
      canScan,
    };
  });

  const todayGates = enrichedEvents
    .filter((e) => e.isToday)
    .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());

  return {
    profile: {
      capabilities: caps,
      active: user.staffProfile.active,
    },
    orgCoverage: [],
    projects: [],
    events: enrichedEvents,
    todayGates,
  };
}
