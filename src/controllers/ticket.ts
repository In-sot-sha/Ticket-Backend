import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { isValidEmail, isValidName, isValidPhone, normalizePhone, sanitizeString } from '../utils/validation';
import { createOTP, verifyOTP, consumeOTP, cleanupExpiredOTPs } from '../services/otp';
import { sendEmail, generateOTPEmail } from '../services/email';
import {
  assertMaxPerPerson,
  getMaxPerPerson,
  getOrCreateGuestUser,
  findUsersByContact,
  countOwnedTickets,
} from '../services/guestUser';
import { calculateUnitOrderFees } from '../constants/fees';
import { assertTicketSalesOpen } from '../services/ticketSales';

/**
 * Get all tickets for the authenticated user or for an event (by eventId param)
/**
 * Get all tickets for a specific event (attendance list for organizers/members/admins)
 */
export const getEventAttendanceTickets = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId } = req.params;
    const eventIdNum = Number(eventId);

    if (!eventIdNum) {
      res.status(400).json({ message: 'Invalid Event ID' });
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: eventIdNum },
      include: { organization: { include: { members: true } } }
    });

    if (!event) {
      res.status(404).json({ message: 'Event not found' });
      return;
    }

    // Check if user is organizer or member of the organization
    const isOrganizer = event.organization?.members.some(m => m.userId === req.userId) ?? false;
    const isEventOwner = event.organization?.ownerId === req.userId;

    if (!isOrganizer && !isEventOwner && req.role !== 'ADMIN') {
      res.status(403).json({ message: 'Not authorized to view this event\'s attendance' });
      return;
    }

    // Return all valid and checked-in tickets for the event
    const tickets = await prisma.ticket.findMany({
      where: {
        eventId: eventIdNum,
        status: { in: ['VALID', 'USED'] }
      },
      include: {
        event: true,
        user: true,
        ticketType: true,
      },
      orderBy: { updatedAt: 'desc' }
    });

    res.status(200).json(tickets);
    return;
  } catch (error) {
    console.error('Error fetching event attendance tickets:', error);
    res.status(500).json({ message: 'Error fetching tickets' });
  }
};

/**
 * Get all tickets in the system (strictly for platform owners/admins)
 */
export const getAdminTickets = async (req: AuthRequest, res: Response) => {
  try {
    if (req.role !== 'ADMIN') {
      res.status(403).json({ message: 'Forbidden: Admin access only' });
      return;
    }

    const tickets = await prisma.ticket.findMany({
      include: {
        event: true,
        user: true,
        ticketType: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json(tickets);
    return;
  } catch (error) {
    console.error('Error fetching admin tickets:', error);
    res.status(500).json({ message: 'Error fetching tickets' });
  }
};

/**
 * Get all tickets belonging to the authenticated user
 */
export const getMyTickets = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const tickets = await prisma.ticket.findMany({
      where: {
        userId: req.userId,
      },
      include: {
        event: true,
        user: true,
        ticketType: true,
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json(tickets);
    return;
  } catch (error) {
    console.error('Error fetching user tickets:', error);
    res.status(500).json({ message: 'Error fetching tickets' });
  }
};

/**
 * Get a specific ticket by ID
 */
export const getTicketById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    if (!req.userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: parseInt(id) },
      include: {
        event: {
          include: {
            organization: {
              include: {
                members: true
              }
            }
          }
        },
        user: true,
        ticketType: true,
      },
    });

    if (!ticket) {
      res.status(404).json({ message: 'Ticket not found' });
      return;
    }

    // Check if user is owner, organizer of the event, or admin
    const isOwner = ticket.userId === req.userId;
    const isOrganizer = ticket.event.organization?.members.some(m => m.userId === req.userId) ?? false;
    const isOrgOwner = ticket.event.organization?.ownerId === req.userId;
    const isAdmin = req.role === 'ADMIN';

    if (!isOwner && !isOrganizer && !isOrgOwner && !isAdmin) {
      res.status(403).json({ message: 'Not authorized to view this ticket' });
      return;
    }

    res.status(200).json(ticket);
  } catch (error) {
    console.error('Error fetching ticket:', error);
    res.status(500).json({ message: 'Error fetching ticket' });
  }
};

/**
 * Purchase a ticket
 */
export const purchaseTicket = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId, ticketTypeId, quantity } = req.body;

    // Validate required fields
    if (!eventId || !ticketTypeId || !quantity) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }

    if (!req.userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      res.status(404).json({ message: 'Event not found' });
      return;
    }

    const ticketType = await prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
    });

    if (!ticketType) {
      res.status(404).json({ message: 'Ticket type not found' });
      return;
    }
    try {
      assertTicketSalesOpen(ticketType);
    } catch (err: any) {
      res.status(err.status || 400).json({ message: err.message, code: err.code });
      return;
    }

    const buyer = await prisma.user.findUnique({ where: { id: req.userId } });
    if (!buyer) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    const maxPerPerson = getMaxPerPerson(ticketType);
    try {
      await assertMaxPerPerson({
        eventId: Number(eventId),
        ticketTypeId: Number(ticketTypeId),
        quantity: Number(quantity),
        maxPerPerson,
        email: buyer.email,
        phone: buyer.phone,
        extraUserIds: [buyer.id],
      });
    } catch (limitErr: any) {
      if (limitErr?.code === 'MAX_PER_PERSON') {
        res.status(400).json({
          message: limitErr.message,
          code: 'MAX_PER_PERSON',
          owned: limitErr.owned,
          maxPerPerson: limitErr.maxPerPerson,
          remaining: limitErr.remaining,
        });
        return;
      }
      throw limitErr;
    }

    // Create tickets
    const tickets = [];
    for (let i = 0; i < quantity; i++) {
      const ticket = await prisma.ticket.create({
        data: {
          eventId,
          ticketTypeId,
          userId: req.userId || undefined,
          qrCode: `QR-${Date.now()}-${i}`,
          purchaseType: 'ONLINE',
        },
        include: {
          event: true,
          ticketType: true,
        },
      });
      tickets.push(ticket);
    }
    // Send email if user is logged in
    try {
      if (req.userId) {
        const user = await prisma.user.findUnique({ where: { id: req.userId } });
        if (user && user.email) {
          const { generateTicketConfirmationEmail, sendEmail } = await import('../services/email');
          const emailContent = generateTicketConfirmationEmail(user.email, {
            ticketId: tickets.map((t) => `TKT-${t.id.toString().padStart(6, '0')}`).join(' · '),
            eventTitle: event.title,
            eventDate: event.startDate ? new Date(event.startDate).toLocaleDateString() : 'TBA',
            eventLocation: event.location || 'TBA',
            ticketType: ticketType.name,
            quantity,
            totalPrice: ticketType.price * quantity,
            ticketStyle: ticketType.ticketStyle,
            accentColor: ticketType.accentColor,
            passes: tickets.map((t) => ({
              label: `TKT-${t.id.toString().padStart(6, '0')}`,
              qrCode: t.qrCode,
              ticketType: t.ticketType?.name || ticketType.name,
              accentColor: t.ticketType?.accentColor || ticketType.accentColor,
            })),
          });
          
          await sendEmail({
            to: user.email,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
          });
        }
      }
    } catch (err) {
      console.error('Failed to send purchase ticket email:', err);
    }

    res.status(201).json({ tickets });
  } catch (error) {
    console.error('Error purchasing ticket:', error);
    res.status(500).json({ message: 'Error purchasing ticket' });
  }
};

/**
 * Create a new ticket
 * Requires user to be an event organizer or organization member
 */
export const createTicket = async (req: AuthRequest, res: Response) => {
  try {
    // Require authentication
    if (!req.userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const { eventId, ticketTypeId } = req.body;

    // Validate required fields
    if (!eventId || !ticketTypeId) {
      res.status(400).json({ message: 'Missing required fields' });
      return;
    }

    // Get the event and check authorization
    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organization: true,
      },
    });

    if (!event) {
      res.status(404).json({ message: 'Event not found' });
      return;
    }

    // Uncommented authorization check: verify user is event organizer or org member
    let isAuthorized = false;

    if (event.organization) {
      // Check if user is organization owner
      if (event.organization.ownerId === req.userId) {
        isAuthorized = true;
      }

      // Check if user is organization member
      if (!isAuthorized) {
        const orgMember = await prisma.organizationMember.findUnique({
          where: {
            userId_organizationId: {
              userId: req.userId,
              organizationId: event.organization.id,
            },
          },
        });

        if (orgMember) {
          isAuthorized = true;
        }
      }
    }

    if (!isAuthorized) {
      res.status(403).json({ message: 'You do not have permission to create tickets for this event' });
      return;
    }

    // Create the ticket
    const ticket = await prisma.ticket.create({
      data: {
        eventId,
        ticketTypeId,
        qrCode: `QR-${Date.now()}-${Math.random()}`,
        purchaseType: 'GATE',
      },
      include: {
        event: true,
        ticketType: true,
      },
    });

    res.status(201).json(ticket);
  } catch (error) {
    console.error('Error creating ticket:', error);
    res.status(500).json({ message: 'Error creating ticket' });
  }
};

/**
 * Validate a ticket
 */
export const validateTicket = async (req: AuthRequest, res: Response) => {
  try {
    const { qrCode, id, eventId } = req.body;
    const identifier = qrCode || id || req.body.code || req.params.id || req.query.id || req.query.qrCode;
    const targetEventId = eventId || req.body.eventId || req.query.eventId;

    if (!identifier) {
      res.status(400).json({ message: 'Ticket identifier (qrCode or id) is required' });
      return;
    }

    let ticket = null;
    const numericId = Number(identifier);
    const isNumeric = !isNaN(numericId) && numericId > 0 && String(numericId) === String(identifier);

    if (isNumeric) {
      ticket = await prisma.ticket.findUnique({
        where: { id: numericId },
        include: {
          event: true,
          ticketType: true,
          user: true,
        }
      });
    }

    if (!ticket) {
      ticket = await prisma.ticket.findFirst({
        where: { qrCode: String(identifier) },
        include: {
          event: true,
          ticketType: true,
          user: true,
        }
      });
    }

    if (!ticket) {
      res.status(404).json({ message: 'Ticket not found' });
      return;
    }

    // Verify event lock if eventId is provided
    if (targetEventId && ticket.eventId !== Number(targetEventId)) {
      res.status(400).json({ 
        message: 'This ticket is not for this event.', 
        status: 'INVALID_EVENT', 
        ticket 
      });
      return;
    }

    if (ticket.status === 'USED') {
      res.status(400).json({ message: 'This ticket has already been scanned and used.', status: 'USED', ticket });
      return;
    }

    if (ticket.status === 'CANCELLED') {
      res.status(400).json({ message: 'This ticket is cancelled and no longer valid.', status: 'CANCELLED', ticket });
      return;
    }

    // Mark as USED
    const updatedTicket = await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'USED' },
      include: {
        event: true,
        ticketType: true,
        user: true,
      }
    });

    res.status(200).json({
      valid: true,
      message: 'Ticket validated — entry approved',
      ticket: updatedTicket
    });
  } catch (error) {
    console.error('Error validating ticket:', error);
    res.status(500).json({ message: 'Error validating ticket' });
  }
};

/**
 * Request ticket recovery
 */
export const requestTicketRecovery = async (req: AuthRequest, res: Response) => {
  try {
    const { contact, method } = req.body;

    if (!contact) {
      res.status(400).json({ message: 'Contact information is required' });
      return;
    }

    // Find user by email or phone
    const user = await prisma.user.findFirst({
      where: method === 'phone' ? { phone: contact } : { email: contact },
    });

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    // Create OTP in database
    const { code, expiresIn } = await createOTP(contact);

    if (method === 'phone') {
      // Simulate SMS or reject if SMS isn't configured
      res.status(400).json({ message: 'Phone recovery is not supported yet. Please use email.' });
      return;
    }

    // Send OTP email
    const emailTemplate = generateOTPEmail(contact, code, expiresIn);
    const sent = await sendEmail({
      to: contact,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      text: emailTemplate.text,
    });

    if (!sent) {
      res.status(500).json({ message: 'Failed to send verification code. Please try again.' });
      return;
    }

    res.json({ message: 'Verification code sent successfully', contact });
  } catch (error: any) {
    console.error('[Recovery] requestTicketRecovery error:', error);
    res.status(500).json({ message: 'Server error during recovery request.' });
  }
};

/**
 * Verify ticket recovery
 * Also performs on-demand OTP cleanup for Vercel (serverless environment)
 */
export const verifyTicketRecovery = async (req: AuthRequest, res: Response) => {
  try {
    // On-demand cleanup for Vercel (no persistent timers in serverless)
    // if (process.env.VERCEL === '1') {
    //   cleanupExpiredOTPs().catch(err => console.error('[OTP] Cleanup error:', err));
    // }

    const { contact, code } = req.body;

    if (!contact || !code) {
      res.status(400).json({ message: 'Contact and verification code are required.' });
      return;
    }

    // Verify OTP from database (now async)
    const result = await verifyOTP(contact, code);

    if (!result.valid) {
      res.status(400).json({ message: result.message });
      return;
    }

    // Consume the OTP (now async)
    await consumeOTP(contact);

    // Find user by email or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: contact },
          { phone: contact }
        ]
      }
    });

    if (!user) {
      res.json({ tickets: [], message: 'No account found.' });
      return;
    }

    // Get user's tickets
    const tickets = await prisma.ticket.findMany({
      where: {
        userId: user.id,
      },
      include: {
        event: true,
        ticketType: true,
      },
    });

    res.json({ tickets });
  } catch (error: any) {
    console.error('[Recovery] verifyTicketRecovery error:', error);
    res.status(500).json({ message: 'Server error during verification.' });
  }
};

/**
 * Check how many tickets a contact already owns for a ticket type (public).
 */
export const checkTicketEligibility = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId, ticketTypeId, email, phone } = req.body;

    if (!eventId || !ticketTypeId) {
      res.status(400).json({ message: 'eventId and ticketTypeId are required' });
      return;
    }

    const cleanEmail = email?.trim() ? String(email).trim().toLowerCase() : null;
    const cleanPhone = phone ? normalizePhone(String(phone)) : null;

    if (cleanEmail && !isValidEmail(cleanEmail)) {
      res.status(400).json({ message: 'Invalid email address' });
      return;
    }
    if (phone && !cleanPhone) {
      res.status(400).json({ message: 'Invalid phone number' });
      return;
    }

    const ticketType = await prisma.ticketType.findUnique({
      where: { id: Number(ticketTypeId) },
    });
    if (!ticketType || ticketType.eventId !== Number(eventId)) {
      res.status(404).json({ message: 'Ticket type not found for this event' });
      return;
    }

    const maxPerPerson = getMaxPerPerson(ticketType);
    const extraUserIds = req.userId ? [req.userId] : [];
    const users = await findUsersByContact(cleanEmail, cleanPhone);
    const userIds = Array.from(new Set([...users.map((u) => u.id), ...extraUserIds]));
    const owned = await countOwnedTickets(Number(eventId), Number(ticketTypeId), userIds);
    const remaining = Math.max(0, maxPerPerson - owned);

    res.json({ owned, maxPerPerson, remaining });
  } catch (error) {
    console.error('Error checking ticket eligibility:', error);
    res.status(500).json({ message: 'Error checking eligibility' });
  }
};

/**
 * Checkout as guest (free tickets only).
 * Paid tickets must use POST /payments/paystack/initialize + confirm.
 */
export const checkoutGuest = async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, email, phone, eventId, ticketTypeId, quantity } = req.body;

    if (!firstName || !isValidName(firstName)) {
      res.status(400).json({ message: 'Invalid first name' });
      return;
    }
    if (!lastName || !isValidName(lastName)) {
      res.status(400).json({ message: 'Invalid last name' });
      return;
    }

    const cleanEmail = email?.trim() ? String(email).trim().toLowerCase() : null;
    if (!cleanEmail || !isValidEmail(cleanEmail)) {
      res.status(400).json({ message: 'A valid email address is required' });
      return;
    }
    if (!eventId || !ticketTypeId || !quantity) {
      res.status(400).json({ message: 'Missing required fields for ticket' });
      return;
    }

    const event = await prisma.event.findUnique({
      where: { id: Number(eventId) },
      include: { organization: true },
    });
    if (!event) {
      res.status(404).json({ message: 'Event not found' });
      return;
    }

    const ticketType = await prisma.ticketType.findUnique({
      where: { id: Number(ticketTypeId) },
    });
    if (!ticketType || ticketType.eventId !== event.id) {
      res.status(404).json({ message: 'Ticket type not found' });
      return;
    }
    try {
      assertTicketSalesOpen(ticketType);
    } catch (err: any) {
      res.status(err.status || 400).json({ message: err.message, code: err.code });
      return;
    }

    const absorbFee = event.organization?.absorbFee ?? false;
    const fees = calculateUnitOrderFees(ticketType.price, Number(quantity), absorbFee);

    if (fees.chargeAmount > 0) {
      res.status(400).json({
        message: 'Paid tickets require Paystack checkout. Use /payments/paystack/initialize then confirm.',
        code: 'PAYMENT_REQUIRED',
        chargeAmount: fees.chargeAmount,
      });
      return;
    }

    const {
      fulfillTicketCheckout,
    } = await import('../services/checkoutFulfillment');

    const result = await fulfillTicketCheckout({
      payload: {
        firstName,
        lastName,
        email: cleanEmail,
        phone,
        eventId: Number(eventId),
        ticketTypeId: Number(ticketTypeId),
        quantity: Number(quantity),
      },
      paymentReference: null,
      fees: {
        subtotal: fees.subtotal,
        platformFee: fees.platformFee,
        processingFee: fees.processingFee,
        netAmount: fees.netAmount,
        chargeAmount: fees.chargeAmount,
      },
    });

    res.status(201).json({
      message: 'Guest checkout successful',
      user: result.user,
      order: result.order,
      tickets: result.tickets,
    });
  } catch (error: any) {
    console.error('Error during guest checkout:', error);
    if (error.status) {
      res.status(error.status).json({
        message: error.message,
        code: error.code,
        owned: error.owned,
        maxPerPerson: error.maxPerPerson,
        remaining: error.remaining,
      });
      return;
    }
    res.status(500).json({ message: 'Error during guest checkout' });
  }
};
/**
 * Manually register an attendee (gate sale) — organizer only, bypasses payment.
 * Requires the requesting user to be a member of the event's organization.
 */
export const manualTicket = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const {
      eventId,
      ticketTypeId,
      quantity = 1,
      buyerName,
      buyerEmail,
      buyerPhone,
      attendees, // Array of {name, email, phone}
      paymentMethod = 'CASH',
      checkInNow = false,
    } = req.body;

    if (!eventId || !ticketTypeId) {
      res.status(400).json({ message: 'eventId and ticketTypeId are required' });
      return;
    }

    if (!buyerName && (!attendees || attendees.length === 0)) {
      res.status(400).json({ message: 'buyerName or attendees array is required' });
      return;
    }

    const contactOk = (email?: string, phone?: string) => {
      const e = email?.trim();
      const p = phone?.trim();
      const emailValid = e ? isValidEmail(e) : false;
      const phoneValid = p ? isValidPhone(p) : false;
      if (e && !emailValid) return false;
      if (p && !phoneValid) return false;
      return emailValid || phoneValid;
    };

    if (attendees && attendees.length > 0) {
      for (const att of attendees) {
        if (!att?.name?.trim()) {
          res.status(400).json({ message: 'Each guest needs a name.' });
          return;
        }
        if (!contactOk(att.email, att.phone)) {
          res.status(400).json({ message: 'Each guest needs a valid email or phone number.' });
          return;
        }
      }
    } else if (!contactOk(buyerEmail, buyerPhone)) {
      res.status(400).json({ message: 'A valid buyer email or phone number is required.' });
      return;
    }

    // Verify the event exists and the requester is the organizer
    const event = await prisma.event.findUnique({
      where: { id: Number(eventId) },
      include: { organization: { include: { members: true } } },
    });

    if (!event) {
      res.status(404).json({ message: 'Event not found' });
      return;
    }

    const isMember = event.organization?.members.some((m) => m.userId === req.userId);
    // Staff access checked later via resolveStaffAccess when available; ADMIN always allowed
    if (!isMember && req.role !== 'ADMIN') {
      // Dynamically import staff resolver to avoid circular deps if module missing during partial deploy
      try {
        const { resolveStaffAccess } = await import('../services/staffAccess');
        const access = await resolveStaffAccess(req.userId!, Number(eventId));
        if (!access.allowed || !access.capabilities.includes('WALK_IN_SALE')) {
          res.status(403).json({ message: 'Not authorized to add attendees to this event' });
          return;
        }
      } catch {
        res.status(403).json({ message: 'Not authorized to add attendees to this event' });
        return;
      }
    }

    // Get the ticket type
    const ticketType = await prisma.ticketType.findUnique({
      where: { id: Number(ticketTypeId) },
    });

    if (!ticketType || ticketType.eventId !== event.id) {
      res.status(404).json({ message: 'Ticket type not found for this event' });
      return;
    }
    try {
      assertTicketSalesOpen(ticketType);
    } catch (err: any) {
      res.status(err.status || 400).json({ message: err.message, code: err.code });
      return;
    }

    const qty = attendees && attendees.length > 0 ? attendees.length : Math.min(Math.max(1, Number(quantity)), 20);
    const tickets = [];
    const totalAmount = ticketType.price * qty;
    const maxPerPerson = getMaxPerPerson(ticketType);

    const resolveGuest = async (name: string, email?: string, phone?: string) => {
      try {
        const user = await getOrCreateGuestUser({ name, email, phone });
        return user;
      } catch (err: any) {
        if (err?.message === 'CONTACT_REQUIRED') {
          throw Object.assign(new Error('Each guest needs a valid email or phone number.'), { status: 400 });
        }
        if (err?.message === 'INVALID_EMAIL') {
          throw Object.assign(new Error('Invalid email address.'), { status: 400 });
        }
        if (err?.message === 'INVALID_PHONE') {
          throw Object.assign(new Error('Invalid phone number.'), { status: 400 });
        }
        throw err;
      }
    };

    if (attendees && attendees.length > 0) {
      // Per-identity qty counts (same details for all → one identity gets qty tickets)
      const identityKey = (a: { email?: string; phone?: string }) =>
        `${(a.email || '').trim().toLowerCase()}|${normalizePhone(a.phone || '') || ''}`;
      const counts = new Map<string, number>();
      for (const att of attendees) {
        const key = identityKey(att);
        counts.set(key, (counts.get(key) || 0) + 1);
      }

      for (const [key, count] of counts) {
        const sample = attendees.find((a: { email?: string; phone?: string }) => identityKey(a) === key)!;
        try {
          await assertMaxPerPerson({
            eventId: event.id,
            ticketTypeId: ticketType.id,
            quantity: count,
            maxPerPerson,
            email: sample.email,
            phone: sample.phone,
          });
        } catch (limitErr: any) {
          if (limitErr?.code === 'MAX_PER_PERSON') {
            res.status(400).json({
              message: limitErr.message,
              code: 'MAX_PER_PERSON',
              owned: limitErr.owned,
              maxPerPerson: limitErr.maxPerPerson,
              remaining: limitErr.remaining,
            });
            return;
          }
          throw limitErr;
        }
      }

      for (let i = 0; i < attendees.length; i++) {
        const att = attendees[i];
        const guestUser = await resolveGuest(att.name, att.email, att.phone);
        const ticket = await prisma.ticket.create({
          data: {
            eventId: event.id,
            ticketTypeId: ticketType.id,
            userId: guestUser.id,
            qrCode: `MANUAL-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
            purchaseType: 'GATE',
            status: checkInNow ? 'USED' : 'VALID',
          },
          include: { event: true, ticketType: true }
        });
        tickets.push(ticket);
        
        const notifyEmail = att.email?.trim() || guestUser.email;
        if (notifyEmail) {
          try {
            const { generateTicketConfirmationEmail, sendEmail } = await import('../services/email');
            const emailContent = generateTicketConfirmationEmail(notifyEmail, {
              ticketId: String(ticket.id),
              eventTitle: event.title,
              eventDate: event.startDate ? new Date(event.startDate).toLocaleDateString() : 'TBA',
              eventLocation: event.location || 'TBA',
              ticketType: ticketType.name,
              quantity: 1,
              totalPrice: ticketType.price,
              qrCode: ticket.qrCode,
              ticketStyle: ticketType.ticketStyle,
              accentColor: ticketType.accentColor,
              passes: [
                {
                  label: `TKT-${ticket.id.toString().padStart(6, '0')}`,
                  qrCode: ticket.qrCode,
                  ticketType: ticketType.name,
                  accentColor: ticketType.accentColor,
                },
              ],
            });
            await sendEmail({
              to: notifyEmail,
              subject: emailContent.subject,
              html: emailContent.html,
              text: emailContent.text,
            });
          } catch (err) {
            console.error('Failed to send individual manual ticket email:', err);
          }
        }
      }
    } else {
      try {
        await assertMaxPerPerson({
          eventId: event.id,
          ticketTypeId: ticketType.id,
          quantity: qty,
          maxPerPerson,
          email: buyerEmail,
          phone: buyerPhone,
        });
      } catch (limitErr: any) {
        if (limitErr?.code === 'MAX_PER_PERSON') {
          res.status(400).json({
            message: limitErr.message,
            code: 'MAX_PER_PERSON',
            owned: limitErr.owned,
            maxPerPerson: limitErr.maxPerPerson,
            remaining: limitErr.remaining,
          });
          return;
        }
        throw limitErr;
      }

      const guestUser = await resolveGuest(buyerName, buyerEmail, buyerPhone);
      for (let i = 0; i < qty; i++) {
        const ticket = await prisma.ticket.create({
          data: {
            eventId: event.id,
            ticketTypeId: ticketType.id,
            userId: guestUser.id,
            qrCode: `MANUAL-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`,
            purchaseType: 'GATE',
            status: checkInNow ? 'USED' : 'VALID',
          },
          include: { event: true, ticketType: true }
        });
        tickets.push(ticket);
      }
      
      const notifyEmail = buyerEmail?.trim() || guestUser.email;
      if (tickets.length > 0 && notifyEmail) {
        try {
          const { generateTicketConfirmationEmail, sendEmail } = await import('../services/email');
          const emailContent = generateTicketConfirmationEmail(notifyEmail, {
            ticketId: tickets
              .map((t) => `TKT-${t.id.toString().padStart(6, '0')}`)
              .join(' · '),
            eventTitle: event.title,
            eventDate: event.startDate ? new Date(event.startDate).toLocaleDateString() : 'TBA',
            eventLocation: event.location || 'TBA',
            ticketType: ticketType.name,
            quantity: qty,
            totalPrice: totalAmount,
            ticketStyle: ticketType.ticketStyle,
            accentColor: ticketType.accentColor,
            passes: tickets.map((t) => ({
              label: `TKT-${t.id.toString().padStart(6, '0')}`,
              qrCode: t.qrCode,
              ticketType: t.ticketType?.name || ticketType.name,
              accentColor: t.ticketType?.accentColor || ticketType.accentColor,
            })),
          });
          await sendEmail({
            to: notifyEmail,
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
          });
        } catch (err) {
          console.error('Failed to send manual ticket email:', err);
        }
      }
    }

    res.status(201).json({
      message: `${qty} ticket(s) registered successfully`,
      tickets,
      checkedIn: checkInNow,
    });
  } catch (error: any) {
    console.error('Error creating manual ticket:', error);
    if (error?.status === 400) {
      res.status(400).json({ message: error.message });
      return;
    }
    res.status(500).json({ message: 'Error registering attendee' });
  }
};

// Export all functions
export default {
  getEventAttendanceTickets,
  getAdminTickets,
  getMyTickets,
  getTicketById,
  purchaseTicket,
  createTicket,
  validateTicket,
  requestTicketRecovery,
  verifyTicketRecovery,
  checkoutGuest,
  checkTicketEligibility,
  manualTicket,
};
