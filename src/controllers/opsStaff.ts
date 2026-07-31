import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { getStaffHome } from '../services/staffAccess';
import { hashPassword } from '../utils/password';
import { sendEmail, generateStaffInviteEmail } from '../services/email';

const DEFAULT_CAPS = ['SCAN', 'WALK_IN_SALE', 'CHECK_IN'];

function stringifyCaps(caps: unknown): string {
  if (Array.isArray(caps)) return JSON.stringify(caps);
  if (typeof caps === 'string') return caps;
  return JSON.stringify(DEFAULT_CAPS);
}

function staffUrls() {
  const base = (process.env.FRONTEND_URL || 'http://localhost:5181').replace(/\/$/, '');
  return {
    loginUrl: `${base}/login`,
    staffHomeUrl: `${base}/staff`,
  };
}

async function sendStaffInvite(opts: {
  firstName: string;
  email: string;
  temporaryPassword?: string | null;
}) {
  const urls = staffUrls();
  const template = generateStaffInviteEmail({
    firstName: opts.firstName,
    email: opts.email,
    temporaryPassword: opts.temporaryPassword,
    ...urls,
  });
  return sendEmail({
    to: opts.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
  });
}

/** Admin: list staff users */
export const listStaff = async (_req: AuthRequest, res: Response) => {
  try {
    const staff = await prisma.user.findMany({
      where: { isStaff: true },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        isStaff: true,
        role: true,
        staffProfile: true,
        staffOrgCoverages: {
          include: { organization: { select: { id: true, name: true } } },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ staff });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to list staff' });
  }
};

/** Admin: create a new staff user + profile in one step */
export const createStaff = async (req: AuthRequest, res: Response) => {
  try {
    const {
      email,
      firstName,
      lastName,
      phone,
      password,
      capabilities,
      active = true,
      organizationIds,
      sendInvite = true,
    } = req.body;

    if (!email?.trim() || !firstName?.trim() || !lastName?.trim()) {
      res.status(400).json({ message: 'email, firstName, and lastName are required' });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      const caps = stringifyCaps(capabilities ?? DEFAULT_CAPS);
      await prisma.user.update({
        where: { id: existing.id },
        data: { isStaff: true },
      });
      const profile = await prisma.staffProfile.upsert({
        where: { userId: existing.id },
        create: { userId: existing.id, capabilities: caps, active: Boolean(active) },
        update: { capabilities: caps, active: Boolean(active) },
      });

      const orgIds: number[] = Array.isArray(organizationIds)
        ? organizationIds.map(Number).filter(Boolean)
        : [];
      for (const organizationId of orgIds) {
        await prisma.staffOrgCoverage.upsert({
          where: { userId_organizationId: { userId: existing.id, organizationId } },
          create: { userId: existing.id, organizationId },
          update: {},
        });
      }

      let inviteSent = false;
      if (sendInvite !== false && existing.email) {
        inviteSent = await sendStaffInvite({
          firstName: existing.firstName || firstName.trim(),
          email: existing.email,
          temporaryPassword: null,
        });
      }

      res.json({
        created: false,
        promoted: true,
        temporaryPassword: null,
        inviteSent,
        user: {
          id: existing.id,
          email: existing.email,
          firstName: existing.firstName,
          lastName: existing.lastName,
          isStaff: true,
        },
        profile,
      });
      return;
    }

    const tempPassword =
      typeof password === 'string' && password.length >= 8
        ? password
        : `Ps${Math.random().toString(36).slice(2, 8)}!${Date.now().toString().slice(-3)}`;
    const hashed = await hashPassword(tempPassword);
    const caps = stringifyCaps(capabilities ?? DEFAULT_CAPS);
    const adminSetPassword = typeof password === 'string' && password.length >= 8;

    const user = await prisma.user.create({
      data: {
        email: normalizedEmail,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        phone: phone?.trim() || null,
        password: hashed,
        role: 'USER',
        isStaff: true,
        isVerified: true,
        isGuest: false,
        mustChangePassword: true,
      },
    });

    const profile = await prisma.staffProfile.create({
      data: { userId: user.id, capabilities: caps, active: Boolean(active) },
    });

    const orgIds: number[] = Array.isArray(organizationIds)
      ? organizationIds.map(Number).filter(Boolean)
      : [];
    for (const organizationId of orgIds) {
      await prisma.staffOrgCoverage.create({
        data: { userId: user.id, organizationId },
      });
    }

    let inviteSent = false;
    if (sendInvite !== false && user.email) {
      inviteSent = await sendStaffInvite({
        firstName: user.firstName,
        email: user.email,
        temporaryPassword: adminSetPassword ? null : tempPassword,
      });
    }

    res.status(201).json({
      created: true,
      promoted: false,
      temporaryPassword: adminSetPassword ? null : tempPassword,
      inviteSent,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isStaff: true,
      },
      profile,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to create staff' });
  }
};

/** Admin: resend invite email (optionally rotate temp password for non-Google accounts) */
export const resendStaffInvite = async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    const { resetPassword = false } = req.body || {};

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { staffProfile: true },
    });

    if (!user || !user.isStaff) {
      res.status(404).json({ message: 'Staff user not found' });
      return;
    }

    let temporaryPassword: string | null = null;
    if (resetPassword && user.password) {
      temporaryPassword = `Ps${Math.random().toString(36).slice(2, 8)}!${Date.now().toString().slice(-3)}`;
      await prisma.user.update({
        where: { id: userId },
        data: {
          password: await hashPassword(temporaryPassword),
          mustChangePassword: true,
        },
      });
    }

    if (!user.email) {
      res.status(400).json({ message: 'Staff user has no email on file' });
      return;
    }

    const inviteSent = await sendStaffInvite({
      firstName: user.firstName,
      email: user.email,
      temporaryPassword,
    });

    res.json({
      inviteSent,
      temporaryPassword,
      message: inviteSent ? 'Invite email sent' : 'Invite email failed to send (check SMTP config)',
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to resend invite' });
  }
};

/** Admin: upsert staff flag + profile capabilities */
export const upsertStaff = async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    const { isStaff = true, capabilities, active = true } = req.body;

    if (!userId) {
      res.status(400).json({ message: 'userId required' });
      return;
    }

    const user = await prisma.user.update({
      where: { id: userId },
      data: { isStaff: Boolean(isStaff) },
    });

    const caps = stringifyCaps(capabilities ?? DEFAULT_CAPS);

    const profile = await prisma.staffProfile.upsert({
      where: { userId },
      create: { userId, capabilities: caps, active: Boolean(active) },
      update: { capabilities: caps, active: Boolean(active) },
    });

    res.json({ user: { id: user.id, email: user.email, isStaff: user.isStaff }, profile });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to update staff' });
  }
};

/** Admin: add org coverage for staff */
export const addOrgCoverage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    const { organizationId, capabilitiesOverride } = req.body;
    if (!userId || !organizationId) {
      res.status(400).json({ message: 'userId and organizationId required' });
      return;
    }

    const coverage = await prisma.staffOrgCoverage.upsert({
      where: {
        userId_organizationId: { userId, organizationId: Number(organizationId) },
      },
      create: {
        userId,
        organizationId: Number(organizationId),
        capabilitiesOverride: capabilitiesOverride
          ? stringifyCaps(capabilitiesOverride)
          : null,
      },
      update: {
        capabilitiesOverride: capabilitiesOverride
          ? stringifyCaps(capabilitiesOverride)
          : null,
      },
      include: { organization: { select: { id: true, name: true } } },
    });

    res.json({ coverage });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to add org coverage' });
  }
};

export const removeOrgCoverage = async (req: AuthRequest, res: Response) => {
  try {
    const userId = Number(req.params.userId);
    const organizationId = Number(req.params.organizationId);
    await prisma.staffOrgCoverage.deleteMany({ where: { userId, organizationId } });
    res.json({ message: 'Coverage removed' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to remove coverage' });
  }
};

/** Ops projects */
export const listOpsProjects = async (req: AuthRequest, res: Response) => {
  try {
    const status = req.query.status as string | undefined;
    const projects = await prisma.opsProject.findMany({
      where: status ? { status: status as any } : undefined,
      include: {
        organization: { select: { id: true, name: true } },
        event: { select: { id: true, title: true, slug: true, startDate: true } },
        assignments: {
          include: {
            user: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.json({ projects });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to list ops projects' });
  }
};

export const createOpsProject = async (req: AuthRequest, res: Response) => {
  try {
    const {
      title,
      organizationId,
      eventId,
      services,
      notes,
      windowStart,
      windowEnd,
      status = 'REQUESTED',
    } = req.body;

    if (!title?.trim()) {
      res.status(400).json({ message: 'title is required' });
      return;
    }

    const project = await prisma.opsProject.create({
      data: {
        title: title.trim(),
        organizationId: organizationId ? Number(organizationId) : null,
        eventId: eventId ? Number(eventId) : null,
        services: stringifyCaps(services ?? ['GATE', 'SCAN', 'WALK_IN']),
        notes: notes || null,
        windowStart: windowStart ? new Date(windowStart) : null,
        windowEnd: windowEnd ? new Date(windowEnd) : null,
        status: eventId ? 'LINKED' : status,
      },
    });

    res.status(201).json({ project });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to create ops project' });
  }
};

export const updateOpsProject = async (req: AuthRequest, res: Response) => {
  try {
    const id = Number(req.params.id);
    const { title, organizationId, eventId, services, notes, windowStart, windowEnd, status } =
      req.body;

    const data: any = {};
    if (title !== undefined) data.title = title;
    if (organizationId !== undefined)
      data.organizationId = organizationId ? Number(organizationId) : null;
    if (eventId !== undefined) {
      data.eventId = eventId ? Number(eventId) : null;
      if (eventId) data.status = 'LINKED';
    }
    if (services !== undefined) data.services = stringifyCaps(services);
    if (notes !== undefined) data.notes = notes;
    if (windowStart !== undefined) data.windowStart = windowStart ? new Date(windowStart) : null;
    if (windowEnd !== undefined) data.windowEnd = windowEnd ? new Date(windowEnd) : null;
    if (status !== undefined) data.status = status;

    const project = await prisma.opsProject.update({ where: { id }, data });
    res.json({ project });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to update ops project' });
  }
};

export const assignStaffToProject = async (req: AuthRequest, res: Response) => {
  try {
    const projectId = Number(req.params.id);
    const { userId, capabilitiesOverride } = req.body;
    if (!projectId || !userId) {
      res.status(400).json({ message: 'project id and userId required' });
      return;
    }

    const assignment = await prisma.staffProjectAssignment.upsert({
      where: { projectId_userId: { projectId, userId: Number(userId) } },
      create: {
        projectId,
        userId: Number(userId),
        capabilitiesOverride: capabilitiesOverride
          ? stringifyCaps(capabilitiesOverride)
          : null,
      },
      update: {
        capabilitiesOverride: capabilitiesOverride
          ? stringifyCaps(capabilitiesOverride)
          : null,
      },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
      },
    });

    // Ensure user is marked staff
    await prisma.user.update({
      where: { id: Number(userId) },
      data: { isStaff: true },
    });
    await prisma.staffProfile.upsert({
      where: { userId: Number(userId) },
      create: {
        userId: Number(userId),
        capabilities: stringifyCaps(DEFAULT_CAPS),
        active: true,
      },
      update: {},
    });

    res.json({ assignment });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to assign staff' });
  }
};

export const removeStaffFromProject = async (req: AuthRequest, res: Response) => {
  try {
    const projectId = Number(req.params.id);
    const userId = Number(req.params.userId);
    await prisma.staffProjectAssignment.deleteMany({ where: { projectId, userId } });
    res.json({ message: 'Removed' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to remove staff' });
  }
};

/** Admin: transfer event to another organization */
export const transferEvent = async (req: AuthRequest, res: Response) => {
  try {
    const eventId = Number(req.params.id);
    const { organizationId } = req.body;
    if (!eventId || !organizationId) {
      res.status(400).json({ message: 'event id and organizationId required' });
      return;
    }

    const org = await prisma.organization.findUnique({ where: { id: Number(organizationId) } });
    if (!org) {
      res.status(404).json({ message: 'Organization not found' });
      return;
    }

    const event = await prisma.event.update({
      where: { id: eventId },
      data: { organizationId: Number(organizationId) },
      include: { organization: { select: { id: true, name: true } } },
    });

    res.json({ event, message: 'Event transferred' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to transfer event' });
  }
};

/** Staff home */
export const staffHome = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: 'Auth required' });
      return;
    }
    const data = await getStaffHome(req.userId);
    res.json(data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to load staff home' });
  }
};

/** Organizer: request ops (creates REQUESTED project) */
export const requestOpsProject = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: 'Auth required' });
      return;
    }

    const { title, organizationId, services, notes, windowStart, windowEnd, eventId } = req.body;

    // Verify membership if org provided
    if (organizationId) {
      const member = await prisma.organizationMember.findFirst({
        where: { userId: req.userId, organizationId: Number(organizationId) },
      });
      const owned = await prisma.organization.findFirst({
        where: { id: Number(organizationId), ownerId: req.userId },
      });
      if (!member && !owned && req.role !== 'ADMIN') {
        res.status(403).json({ message: 'Not a member of this organization' });
        return;
      }
    }

    const project = await prisma.opsProject.create({
      data: {
        title: (title || 'Ops request').trim(),
        organizationId: organizationId ? Number(organizationId) : null,
        eventId: eventId ? Number(eventId) : null,
        services: stringifyCaps(services ?? ['GATE', 'SCAN']),
        notes: notes || null,
        windowStart: windowStart ? new Date(windowStart) : null,
        windowEnd: windowEnd ? new Date(windowEnd) : null,
        status: 'REQUESTED',
      },
    });

    res.status(201).json({ project });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to request ops' });
  }
};
