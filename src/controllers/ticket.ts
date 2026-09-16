import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { isValidEmail, isValidName, isValidPhone, normalizePhone, sanitizeString } from '../utils/validation';
import { createOTP, verifyOTP, consumeOTP, cleanupExpiredOTPs } from '../services/otp';
import { sendEmail, generateOTPEmail } from '../services/email';
import { deliverTicketsViaWhatsApp, sendWhatsAppOtp } from '../services/whatsapp';
import {
  assertMaxPerPerson,
  getMaxPerPerson,
  getOrCreateGuestUser,
  findUsersByContact,
  countOwnedTickets,
} from '../services/guestUser';
import { calculateUnitOrderFees } from '../constants/fees';
import { assertTicketSalesOpen } from '../services/ticketSales';
import { writeAuditLog } from '../services/auditLog';
import { authorizeEventOps } from '../services/eventAccess';

const PAID_GATE_METHODS = ['CASH', 'POS', 'TRANSFER'] as const;
type PaidGateMethod = (typeof PAID_GATE_METHODS)[number];

const ticketSafeUser = {
  select: { id: true, firstName: true, lastName: true, email: true, phone: true },
} as const;

const ticketSafeSoldBy = {
  select: { id: true, firstName: true, lastName: true, isStaff: true },
} as const;

function resolveGatePayment(price: number, raw?: string): { paymentMethod: 'CASH' | 'POS' | 'TRANSFER' | 'FREE'; amountPaid: number } {
  if (Number(price) <= 0) {
    return { paymentMethod: 'FREE', amountPaid: 0 };
  }
  const method = String(raw || '').toUpperCase();
  if (!PAID_GATE_METHODS.includes(method as PaidGateMethod)) {
    throw Object.assign(new Error('Select cash, POS, or transfer for paid tickets.'), { status: 400 });
  }
  return { paymentMethod: method as PaidGateMethod, amountPaid: Number(price) };
}

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

    if (!req.userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    try {
      await authorizeEventOps(req.userId, req.role, eventIdNum, [
        'SCAN',
        'WALK_IN_SALE',
        'CHECK_IN',
        'GATE_MANAGE',
      ]);
    } catch (authErr: any) {
      res.status(authErr.status || 403).json({ message: authErr.message || 'Not authorized' });
      return;
    }

    const tickets = await prisma.ticket.findMany({
      where: {
        eventId: eventIdNum,
        status: { in: ['VALID', 'USED'] }
      },
      include: {
        user: ticketSafeUser,
        ticketType: { select: { id: true, name: true, price: true } },
        soldBy: ticketSafeSoldBy,
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

    try {
      if (req.userId) {
        const buyer = await prisma.user.findUnique({ where: { id: req.userId } });
        if (buyer?.phone) {
          await deliverTicketsViaWhatsApp({
            phone: buyer.phone,
            eventTitle: event.title,
            eventDate: event.startDate ? new Date(event.startDate).toLocaleDateString() : 'TBA',
            eventLocation: event.location || 'TBA',
            tickets: tickets.map((t) => ({
              id: t.id,
              qrCode: t.qrCode,
              ticketTypeName: t.ticketType?.name || ticketType.name,
            })),
          });
        }
      }
    } catch (err) {
      console.error('[WhatsApp] Purchase ticket delivery failed:', err);
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

    await writeAuditLog({
      action: 'CHECK_IN',
      entity: 'Ticket',
      entityId: updatedTicket.id,
      eventId: updatedTicket.eventId,
      userId: req.userId ?? null,
      metadata: {
        qrCode: updatedTicket.qrCode,
        ticketType: updatedTicket.ticketType?.name,
        attendee: updatedTicket.user
          ? `${updatedTicket.user.firstName} ${updatedTicket.user.lastName}`.trim()
          : null,
      },
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

    const normalizedPhone = method === 'phone' ? normalizePhone(String(contact)) : null;
    const user = await prisma.user.findFirst({
      where:
        method === 'phone'
          ? {
              OR: [
                { phone: String(contact).trim() },
                ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
              ],
            }
          : { email: contact },
    });

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    if (method === 'phone') {
      const typed = String(contact).trim();
      const phone = normalizePhone(typed) || (user.phone ? normalizePhone(user.phone) : null);
      if (!phone) {
        res.status(400).json({ message: 'Enter a valid phone number.' });
        return;
      }
      const { code } = await createOTP(typed);
      try {
        await sendWhatsAppOtp(phone, code);
      } catch (err: any) {
        res.status(503).json({
          message: err?.message || 'WhatsApp delivery is unavailable. Use email recovery.',
        });
        return;
      }
      res.json({ message: 'Verification code sent on WhatsApp', contact: typed });
      return;
    }

    // Create OTP in database
    const { code, expiresIn } = await createOTP(contact);

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

    const normalizedPhone = normalizePhone(String(contact));
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: contact },
          { phone: contact },
          ...(normalizedPhone ? [{ phone: normalizedPhone }] : []),
        ],
      },
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

    let event;
    try {
      ({ event } = await authorizeEventOps(req.userId, req.role, Number(eventId), 'WALK_IN_SALE'));
    } catch (authErr: any) {
      res.status(authErr.status || 403).json({
        message: authErr.status === 404 ? 'Event not found' : 'Not authorized to add attendees to this event',
      });
      return;
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
    const tickets: any[] = [];
    let payment;
    try {
      payment = resolveGatePayment(ticketType.price, paymentMethod);
    } catch (payErr: any) {
      res.status(400).json({ message: payErr.message });
      return;
    }
    const totalAmount = payment.amountPaid * qty;
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
            paymentMethod: payment.paymentMethod,
            amountPaid: payment.amountPaid,
            soldByUserId: req.userId,
          },
          include: { event: true, ticketType: true, user: ticketSafeUser, soldBy: ticketSafeSoldBy }
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
        const notifyPhone = att.phone?.trim() || guestUser.phone;
        if (notifyPhone) {
          await deliverTicketsViaWhatsApp({
            phone: notifyPhone,
            eventTitle: event.title,
            eventDate: event.startDate ? new Date(event.startDate).toLocaleDateString() : 'TBA',
            eventLocation: event.location || 'TBA',
            tickets: [{ id: ticket.id, qrCode: ticket.qrCode, ticketTypeName: ticketType.name }],
          }).catch((err) => console.error('[WhatsApp] Manual ticket delivery failed:', err));
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
            paymentMethod: payment.paymentMethod,
            amountPaid: payment.amountPaid,
            soldByUserId: req.userId,
          },
          include: { event: true, ticketType: true, user: ticketSafeUser, soldBy: ticketSafeSoldBy }
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
      const notifyPhone = buyerPhone?.trim() || guestUser.phone;
      if (tickets.length > 0 && notifyPhone) {
        await deliverTicketsViaWhatsApp({
          phone: notifyPhone,
          eventTitle: event.title,
          eventDate: event.startDate ? new Date(event.startDate).toLocaleDateString() : 'TBA',
          eventLocation: event.location || 'TBA',
          tickets: tickets.map((t) => ({
            id: t.id,
            qrCode: t.qrCode,
            ticketTypeName: t.ticketType?.name || ticketType.name,
          })),
        }).catch((err) => console.error('[WhatsApp] Manual ticket delivery failed:', err));
      }
    }

    await writeAuditLog({
      action: 'GATE_SALE',
      entity: 'Ticket',
      entityId: tickets.map((t) => t.id).join(','),
      eventId: event.id,
      userId: req.userId,
      metadata: {
        quantity: qty,
        ticketTypeId: ticketType.id,
        ticketTypeName: ticketType.name,
        paymentMethod: payment.paymentMethod,
        amountPaid: totalAmount,
        unitPrice: payment.amountPaid,
        checkInNow: Boolean(checkInNow),
        guests: (attendees && attendees.length > 0
          ? attendees
          : [{ name: buyerName, email: buyerEmail, phone: buyerPhone }]
        ).map((g: any) => ({
          name: g?.name,
          email: g?.email,
          phone: g?.phone,
        })),
      },
    });

    res.status(201).json({
      message: `${qty} ticket(s) registered successfully`,
      tickets,
      checkedIn: checkInNow,
      paymentMethod: payment.paymentMethod,
      amountPaid: totalAmount,
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

/**
 * Fast lookup of an existing attendee by phone/email so gate staff can add another day without retyping.
 */
export const lookupEventAttendee = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const eventIdNum = Number(req.params.eventId);
    const q = String(req.query.q || '').trim();
    if (!eventIdNum) {
      res.status(400).json({ message: 'Invalid Event ID' });
      return;
    }
    if (q.length < 3) {
      res.status(200).json({ matches: [] });
      return;
    }

    try {
      await authorizeEventOps(req.userId, req.role, eventIdNum, 'WALK_IN_SALE');
    } catch (authErr: any) {
      res.status(authErr.status || 403).json({ message: authErr.message || 'Not authorized' });
      return;
    }

    const phone = normalizePhone(q);
    const email = q.includes('@') && isValidEmail(q) ? q.toLowerCase() : null;
    const digits = q.replace(/\D/g, '');

    const or: Array<Record<string, unknown>> = [];
    if (email) or.push({ email });
    if (phone) or.push({ phone });
    if (!email && !phone && digits.length >= 7) {
      or.push({ phone: { contains: digits.slice(-10) } });
    }

    if (or.length === 0) {
      res.status(200).json({ matches: [] });
      return;
    }

    const users = await prisma.user.findMany({
      where: { OR: or as any },
      take: 6,
      select: { id: true, firstName: true, lastName: true, email: true, phone: true },
    });

    const matches = await Promise.all(
      users.map(async (user) => {
        const tickets = await prisma.ticket.findMany({
          where: {
            eventId: eventIdNum,
            userId: user.id,
            status: { in: ['VALID', 'USED'] },
          },
          include: { ticketType: { select: { id: true, name: true, price: true } } },
        });
        const byType = new Map<string, { ticketTypeId: number; ticketTypeName: string; qty: number }>();
        for (const t of tickets) {
          const key = String(t.ticketTypeId);
          const existing = byType.get(key);
          if (existing) existing.qty += 1;
          else {
            byType.set(key, {
              ticketTypeId: t.ticketTypeId,
              ticketTypeName: t.ticketType?.name || 'Ticket',
              qty: 1,
            });
          }
        }
        return {
          userId: user.id,
          name: `${user.firstName} ${user.lastName}`.replace(/\s+Guest$/, '').trim() || user.firstName,
          email: user.email || '',
          phone: user.phone || '',
          existingTickets: Array.from(byType.values()),
        };
      })
    );

    res.status(200).json({ matches });
  } catch (error) {
    console.error('Error looking up attendee:', error);
    res.status(500).json({ message: 'Error looking up attendee' });
  }
};

export const getEventAuditLogs = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    const eventIdNum = Number(req.params.eventId);
    if (!eventIdNum) {
      res.status(400).json({ message: 'Invalid Event ID' });
      return;
    }

    try {
      await authorizeEventOps(req.userId, req.role, eventIdNum, [
        'SCAN',
        'WALK_IN_SALE',
        'CHECK_IN',
        'GATE_MANAGE',
      ]);
    } catch (authErr: any) {
      res.status(authErr.status || 403).json({ message: authErr.message || 'Not authorized' });
      return;
    }

    const take = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const logs = await prisma.auditLog.findMany({
      where: { eventId: eventIdNum },
      include: {
        user: { select: { id: true, firstName: true, lastName: true, isStaff: true } },
      },
      orderBy: { createdAt: 'desc' },
      take,
    });

    res.status(200).json(logs);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({ message: 'Error fetching audit logs' });
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
  lookupEventAttendee,
  getEventAuditLogs,
};
