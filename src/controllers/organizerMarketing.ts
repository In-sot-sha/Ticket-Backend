import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import {
  emailButton,
  emailHeroTitle,
  emailLayout,
  generateOrganizerMessageEmail,
  generatePreEventReminderEmail,
  generatePostEventThankYouEmail,
  sendEmail,
} from '../services/email';

async function assertEventAccess(userId: number, eventId: number) {
  const event = await prisma.event.findFirst({
    where: {
      id: eventId,
      organization: {
        OR: [
          { ownerId: userId },
          { members: { some: { userId } } },
        ],
      },
    },
    include: {
      organization: { select: { id: true, name: true, ownerId: true } },
    },
  });
  return event;
}

function buildTicketWhere(eventId: number, filterStatus?: string, ticketTypeId?: number) {
  const where: any = { eventId };

  if (filterStatus === 'CHECKED_IN') {
    where.status = 'USED';
  } else if (filterStatus === 'UNCHECKED') {
    where.status = 'VALID';
  }

  if (filterStatus === 'TICKET_TYPE' && ticketTypeId && !isNaN(ticketTypeId)) {
    where.ticketTypeId = Number(ticketTypeId);
  }

  return where;
}

/**
 * GET /events/:id/attendee-blast-preview
 */
export const getAttendeeBlastPreview = async (req: AuthRequest, res: Response) => {
  try {
    const eventId = Number(req.params.id);
    const { filterStatus, ticketTypeId } = req.query || {};

    if (!eventId || Number.isNaN(eventId)) {
      return res.status(400).json({ message: 'Invalid event ID' });
    }

    const event = await assertEventAccess(req.userId!, eventId);
    if (!event) {
      return res.status(403).json({ message: 'Not authorized for this event' });
    }

    const where = buildTicketWhere(eventId, String(filterStatus || 'ALL'), Number(ticketTypeId) || undefined);
    const [totalTickets, tickets] = await Promise.all([
      prisma.ticket.count({ where: { eventId } }),
      prisma.ticket.findMany({
        where,
        include: { user: { select: { email: true, firstName: true } } },
      }),
    ]);

    const recipients = new Set<string>();
    for (const t of tickets) {
      const email = t.user?.email?.trim().toLowerCase();
      if (email && email.includes('@')) {
        recipients.add(email);
      }
    }

    return res.json({
      totalTickets,
      matchingTickets: tickets.length,
      matchingRecipients: recipients.size,
      autoReminderEnabled: event.autoReminderEnabled,
      autoPostEventEnabled: event.autoPostEventEnabled,
      autoReminder24hSent: event.autoReminder24hSent,
      autoPostEventSent: event.autoPostEventSent,
    });
  } catch (error) {
    console.error('[Attendee blast preview]', error);
    return res.status(500).json({ message: 'Failed to preview recipient count' });
  }
};

/**
 * POST /events/:id/attendee-blast
 * Body: { subject, message, filterStatus, ticketTypeId, templateType }
 */
export const sendAttendeeBlast = async (req: AuthRequest, res: Response) => {
  try {
    const eventId = Number(req.params.id);
    const { subject, message, filterStatus, ticketTypeId, templateType } = req.body || {};

    if (!eventId || Number.isNaN(eventId)) {
      return res.status(400).json({ message: 'Invalid event ID' });
    }
    if (!subject || typeof subject !== 'string' || subject.trim().length < 3) {
      return res.status(400).json({ message: 'Subject must be at least 3 characters' });
    }
    if (!message || typeof message !== 'string' || message.trim().length < 10) {
      return res.status(400).json({ message: 'Message must be at least 10 characters' });
    }
    if (subject.length > 120 || message.length > 4000) {
      return res.status(400).json({ message: 'Subject or message is too long' });
    }

    const event = await assertEventAccess(req.userId!, eventId);
    if (!event) {
      return res.status(403).json({ message: 'Not authorized for this event' });
    }

    const { testEmail } = req.body || {};
    const frontend = (process.env.FRONTEND_URL || 'https://partystorm.ng').replace(/\/$/, '');
    const eventUrl = `${frontend}/events/${event.slug || event.id}`;
    const ticketsUrl = `${frontend}/dashboard`;
    const safeSubject = subject.trim();
    const safeMessage = message.trim();
    const orgName = event.organization?.name || 'Event host';

    // If sending a test email to organizer
    if (testEmail && typeof testEmail === 'string' && testEmail.includes('@')) {
      const content = generateOrganizerMessageEmail({
        attendeeName: 'Organizer (Test Preview)',
        orgName,
        eventTitle: event.title,
        subjectLine: `[TEST PREVIEW] ${safeSubject}`,
        bodyText: safeMessage,
        eventUrl,
      });

      await sendEmail({
        to: testEmail.trim().toLowerCase(),
        subject: `[TEST PREVIEW] [${event.title}] ${safeSubject}`,
        html: content.html,
        text: content.text,
        fromName: `${orgName} via PartyStorm`,
      });

      return res.json({
        message: `Test preview email sent to ${testEmail.trim()}`,
        sent: 1,
        isTest: true,
      });
    }

    const where = buildTicketWhere(eventId, filterStatus, ticketTypeId);
    const tickets = await prisma.ticket.findMany({
      where,
      include: { user: { select: { email: true, firstName: true } } },
    });

    const recipients = new Map<string, string>();
    for (const t of tickets) {
      const email = t.user?.email?.trim().toLowerCase();
      if (email && email.includes('@')) {
        recipients.set(email, t.user?.firstName || 'there');
      }
    }

    if (recipients.size === 0) {
      return res.status(400).json({ message: 'No attendee emails found for the selected filter.' });
    }

    let sent = 0;
    let failed = 0;

    for (const [email, firstName] of recipients) {
      try {
        let content;
        if (templateType === 'PRE_EVENT_REMINDER') {
          const formattedDate = new Date(event.startDate).toLocaleString('en-NG', {
            dateStyle: 'full',
            timeStyle: 'short',
          });
          content = generatePreEventReminderEmail({
            attendeeName: firstName,
            orgName,
            eventTitle: event.title,
            startDate: formattedDate,
            location: event.location,
            eventUrl,
            ticketsUrl,
          });
        } else if (templateType === 'POST_EVENT_THANK_YOU') {
          content = generatePostEventThankYouEmail({
            attendeeName: firstName,
            orgName,
            eventTitle: event.title,
            eventUrl,
          });
        } else {
          content = generateOrganizerMessageEmail({
            attendeeName: firstName,
            orgName,
            eventTitle: event.title,
            subjectLine: safeSubject,
            bodyText: safeMessage,
            eventUrl,
          });
        }

        await sendEmail({
          to: email,
          subject: content.subject.startsWith('[') ? content.subject : `[${event.title}] ${content.subject}`,
          html: content.html,
          text: content.text,
          fromName: `${orgName} via PartyStorm`,
        });
        sent++;
      } catch (err) {
        console.error('[Attendee blast] send failed:', email, err);
        failed++;
      }
    }

    return res.json({
      message: `Message sent to ${sent} attendee${sent === 1 ? '' : 's'}${failed ? ` (${failed} failed)` : ''}.`,
      sent,
      failed,
      recipientCount: recipients.size,
    });
  } catch (error) {
    console.error('[Attendee blast]', error);
    return res.status(500).json({ message: 'Failed to send attendee message' });
  }
};

/**
 * POST /events/:id/trigger-lifecycle-email
 * Body: { triggerType: 'REMINDER_24H' | 'POST_EVENT', enableReminder?: boolean, enablePostEvent?: boolean }
 */
export const triggerEventLifecycleEmail = async (req: AuthRequest, res: Response) => {
  try {
    const eventId = Number(req.params.id);
    const { triggerType, enableReminder, enablePostEvent } = req.body || {};

    if (!eventId || Number.isNaN(eventId)) {
      return res.status(400).json({ message: 'Invalid event ID' });
    }

    const event = await assertEventAccess(req.userId!, eventId);
    if (!event) {
      return res.status(403).json({ message: 'Not authorized for this event' });
    }

    // Toggle settings update
    if (typeof enableReminder === 'boolean' || typeof enablePostEvent === 'boolean') {
      const updated = await prisma.event.update({
        where: { id: eventId },
        data: {
          ...(typeof enableReminder === 'boolean' ? { autoReminderEnabled: enableReminder } : {}),
          ...(typeof enablePostEvent === 'boolean' ? { autoPostEventEnabled: enablePostEvent } : {}),
        },
      });
      return res.json({
        message: 'Automated email settings updated.',
        autoReminderEnabled: updated.autoReminderEnabled,
        autoPostEventEnabled: updated.autoPostEventEnabled,
      });
    }

    const frontend = (process.env.FRONTEND_URL || 'https://partystorm.ng').replace(/\/$/, '');
    const eventUrl = `${frontend}/events/${event.slug || event.id}`;
    const ticketsUrl = `${frontend}/dashboard`;
    const orgName = event.organization?.name || 'Event host';

    if (triggerType === 'REMINDER_24H') {
      const tickets = await prisma.ticket.findMany({
        where: { eventId, status: 'VALID' },
        include: { user: { select: { email: true, firstName: true } } },
      });

      const recipients = new Map<string, string>();
      for (const t of tickets) {
        const email = t.user?.email?.trim().toLowerCase();
        if (email && email.includes('@')) {
          recipients.set(email, t.user?.firstName || 'there');
        }
      }

      if (recipients.size === 0) {
        return res.status(400).json({ message: 'No registered attendees found for reminder.' });
      }

      let sent = 0;
      const formattedDate = new Date(event.startDate).toLocaleString('en-NG', {
        dateStyle: 'full',
        timeStyle: 'short',
      });

      for (const [email, firstName] of recipients) {
        try {
          const content = generatePreEventReminderEmail({
            attendeeName: firstName,
            orgName,
            eventTitle: event.title,
            startDate: formattedDate,
            location: event.location,
            eventUrl,
            ticketsUrl,
          });
          await sendEmail({
            to: email,
            subject: content.subject,
            html: content.html,
            text: content.text,
            fromName: `${orgName} via PartyStorm`,
          });
          sent++;
        } catch (err) {
          console.error('[Pre-event reminder] failed:', email, err);
        }
      }

      await prisma.event.update({
        where: { id: eventId },
        data: { autoReminder24hSent: new Date() },
      });

      return res.json({
        message: `24-Hour pre-event reminder sent to ${sent} attendee${sent === 1 ? '' : 's'}.`,
        sent,
      });
    } else if (triggerType === 'POST_EVENT') {
      const tickets = await prisma.ticket.findMany({
        where: { eventId, status: 'USED' },
        include: { user: { select: { email: true, firstName: true } } },
      });

      const recipients = new Map<string, string>();
      for (const t of tickets) {
        const email = t.user?.email?.trim().toLowerCase();
        if (email && email.includes('@')) {
          recipients.set(email, t.user?.firstName || 'there');
        }
      }

      if (recipients.size === 0) {
        return res.status(400).json({ message: 'No checked-in attendees found to send thank you email.' });
      }

      let sent = 0;
      for (const [email, firstName] of recipients) {
        try {
          const content = generatePostEventThankYouEmail({
            attendeeName: firstName,
            orgName,
            eventTitle: event.title,
            eventUrl,
          });
          await sendEmail({
            to: email,
            subject: content.subject,
            html: content.html,
            text: content.text,
            fromName: `${orgName} via PartyStorm`,
          });
          sent++;
        } catch (err) {
          console.error('[Post-event thank you] failed:', email, err);
        }
      }

      await prisma.event.update({
        where: { id: eventId },
        data: { autoPostEventSent: new Date() },
      });

      return res.json({
        message: `Post-event thank you email sent to ${sent} attendee${sent === 1 ? '' : 's'}.`,
        sent,
      });
    }

    return res.status(400).json({ message: 'Invalid triggerType specified.' });
  } catch (error) {
    console.error('[Trigger lifecycle email]', error);
    return res.status(500).json({ message: 'Failed to trigger lifecycle email' });
  }
};

/**
 * POST /events/:id/request-promotion
 */
export const requestEventPromotion = async (req: AuthRequest, res: Response) => {
  try {
    const eventId = Number(req.params.id);
    if (!eventId || Number.isNaN(eventId)) {
      return res.status(400).json({ message: 'Invalid event ID' });
    }

    const event = await assertEventAccess(req.userId!, eventId);
    if (!event) {
      return res.status(403).json({ message: 'Not authorized for this event' });
    }

    if (event.isPromoted) {
      return res.json({
        message: 'This event is already featured on PartyStorm.',
        event,
        alreadyPromoted: true,
      });
    }

    if (event.promotionRequestedAt) {
      return res.json({
        message: 'Promotion request already submitted. Our team will review it.',
        event,
        alreadyRequested: true,
      });
    }

    const updated = await prisma.event.update({
      where: { id: event.id },
      data: { promotionRequestedAt: new Date() },
    });

    // Notify support inbox (best-effort)
    try {
      const support = process.env.SUPPORT_EMAIL || 'support@partystorm.ng';
      await sendEmail({
        to: support,
        subject: `Promotion request: ${event.title}`,
        html: emailLayout({
          bodyHtml: `
            ${emailHeroTitle('Featured placement request')}
            <p style="color:#374151;font-size:15px;">
              <strong>${escapeHtml(event.organization?.name || 'Organizer')}</strong> requested homepage /
              featured promotion for <strong>${escapeHtml(event.title)}</strong> (event #${event.id}).
            </p>
            ${emailButton(`${(process.env.FRONTEND_URL || 'https://partystorm.ng').replace(/\/$/, '')}/admin/events`, 'Open admin events')}
          `,
        }),
        text: `Promotion request for ${event.title} (#${event.id})`,
      });
    } catch (err) {
      console.warn('[Promotion request] support email failed:', err);
    }

    return res.json({
      message: 'Promotion request sent. PartyStorm will review and feature eligible events.',
      event: updated,
    });
  } catch (error) {
    console.error('[Promotion request]', error);
    return res.status(500).json({ message: 'Failed to request promotion' });
  }
};

function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
