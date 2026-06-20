import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { isValidEmail, isValidName, isValidPhone, sanitizeString } from '../utils/validation';
import { createOTP, verifyOTP, consumeOTP, cleanupExpiredOTPs } from '../services/otp';
import { sendEmail, generateOTPEmail } from '../services/email';

/**
 * Get all tickets for the authenticated user
 * Users can only see their own tickets unless they're admins
 * Admins can see all tickets
 */
export const getTickets = async (req: AuthRequest, res: Response) => {
  try {
    // Require authentication
    if (!req.userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    let tickets;

    // Admins can see all tickets
    if (req.role === 'ADMIN') {
      tickets = await prisma.ticket.findMany({
        include: {
          event: true,
          user: true,
          ticketType: true,
        },
      });
    } else {
      // Regular users can only see their own tickets
      tickets = await prisma.ticket.findMany({
        where: {
          userId: req.userId,
        },
        include: {
          event: true,
          user: true,
          ticketType: true,
        },
      });
    }

    res.status(200).json(tickets);
  } catch (error) {
    console.error('Error fetching tickets:', error);
    res.status(500).json({ message: 'Error fetching tickets' });
  }
};

/**
 * Get a specific ticket by ID
 */
export const getTicketById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const ticket = await prisma.ticket.findUnique({
      where: { id: parseInt(id) },
      include: {
        event: true,
        user: true,
        ticketType: true,
      },
    });

    if (!ticket) {
      res.status(404).json({ message: 'Ticket not found' });
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
    const { id } = req.params;

    const ticket = await prisma.ticket.findUnique({
      where: { id: parseInt(id) },
    });

    if (!ticket) {
      res.status(404).json({ message: 'Ticket not found' });
      return;
    }

    if (ticket.status === 'USED') {
      res.status(400).json({ message: 'Ticket already used' });
      return;
    }

    if (ticket.status === 'CANCELLED') {
      res.status(400).json({ message: 'Ticket is cancelled' });
      return;
    }

    res.status(200).json({ valid: true, ticket });
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
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ message: 'Email is required' });
      return;
    }

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      res.status(404).json({ message: 'User not found' });
      return;
    }

    // Create OTP in database (now async)
    const { code, expiresIn } = await createOTP(email);

    // Send OTP email
    const emailTemplate = generateOTPEmail(email, code, expiresIn);
    const sent = await sendEmail({
      to: email,
      subject: emailTemplate.subject,
      html: emailTemplate.html,
      text: emailTemplate.text,
    });

    if (!sent) {
      res.status(500).json({ message: 'Failed to send verification code. Please try again.' });
      return;
    }

    res.json({ message: 'Verification code sent successfully', email });
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
    if (process.env.VERCEL === '1') {
      cleanupExpiredOTPs().catch(err => console.error('[OTP] Cleanup error:', err));
    }

    const { email, code } = req.body;

    if (!email || !code) {
      res.status(400).json({ message: 'Email and verification code are required.' });
      return;
    }

    // Verify OTP from database (now async)
    const result = await verifyOTP(email, code);

    if (!result.valid) {
      res.status(400).json({ message: result.message });
      return;
    }

    // Consume the OTP (now async)
    await consumeOTP(email);

    // Find user by email
    const user = await prisma.user.findUnique({
      where: { email }
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
 * Checkout as guest
 * Add input validation for firstName, lastName, email, phone
 */
export const checkoutGuest = async (req: AuthRequest, res: Response) => {
  try {
    const { firstName, lastName, email, phone, eventId, ticketTypeId, quantity } = req.body;

    // Input validation for firstName
    if (!firstName || !isValidName(firstName)) {
      res.status(400).json({ message: 'Invalid first name' });
      return;
    }

    // Input validation for lastName
    if (!lastName || !isValidName(lastName)) {
      res.status(400).json({ message: 'Invalid last name' });
      return;
    }

    // Input validation for email
    if (!email || !isValidEmail(email)) {
      res.status(400).json({ message: 'Invalid email address' });
      return;
    }

    // Input validation for phone
    if (phone && !isValidPhone(phone)) {
      res.status(400).json({ message: 'Invalid phone number' });
      return;
    }

    // Validate ticket fields
    if (!eventId || !ticketTypeId || !quantity) {
      res.status(400).json({ message: 'Missing required fields for ticket' });
      return;
    }

    // Sanitize string inputs
    const sanitizedFirstName = sanitizeString(firstName);
    const sanitizedLastName = sanitizeString(lastName);
    const sanitizedPhone = phone ? sanitizeString(phone) : undefined;

    // Check if event exists
    const event = await prisma.event.findUnique({
      where: { id: eventId },
    });

    if (!event) {
      res.status(404).json({ message: 'Event not found' });
      return;
    }

    // Check if ticket type exists
    const ticketType = await prisma.ticketType.findUnique({
      where: { id: ticketTypeId },
    });

    if (!ticketType) {
      res.status(404).json({ message: 'Ticket type not found' });
      return;
    }

    // Find or create guest user
    let guestUser = await prisma.user.findUnique({
      where: { email },
    });

    if (!guestUser) {
      guestUser = await prisma.user.create({
        data: {
          email,
          firstName: sanitizedFirstName,
          lastName: sanitizedLastName,
          phone: sanitizedPhone,
          isGuest: true,
          role: 'USER',
        },
      });
    }

    // Use database transaction to ensure order + tickets are created atomically
    const result = await prisma.$transaction(async (tx) => {
      // Calculate totals
      const totalAmount = ticketType.price * quantity;
      const platformFee = totalAmount > 0 ? totalAmount * 0.05 : 0;
      const processingFee = totalAmount > 0 ? (totalAmount * 0.015) + 100 : 0;
      const netAmount = totalAmount > 0 ? totalAmount - platformFee - processingFee : 0;

      // Create order first
      const order = await tx.order.create({
        data: {
          userId: guestUser.id,
          eventId,
          totalAmount,
          platformFee,
          processingFee,
          netAmount,
          status: 'PAID',
          purchaseType: 'ONLINE',
        },
      });

      // Create tickets linked to the order
      const tickets = [];
      for (let i = 0; i < quantity; i++) {
        const ticket = await tx.ticket.create({
          data: {
            eventId,
            ticketTypeId,
            userId: guestUser.id,
            qrCode: `QR-${Date.now()}-${i}-${Math.random()}`,
            purchaseType: 'ONLINE',
            orderId: order.id,
          },
          include: {
            event: true,
            ticketType: true,
          },
        });
        tickets.push(ticket);
      }

      return { order, tickets };
    });

    res.status(201).json({
      message: 'Guest checkout successful',
      user: guestUser,
      order: result.order,
      tickets: result.tickets,
    });
  } catch (error) {
    console.error('Error during guest checkout:', error);
    res.status(500).json({ message: 'Error during guest checkout' });
  }
};

// Export all functions
export default {
  getTickets,
  getTicketById,
  purchaseTicket,
  createTicket,
  validateTicket,
  requestTicketRecovery,
  verifyTicketRecovery,
  checkoutGuest,
};
