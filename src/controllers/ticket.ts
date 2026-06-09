import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { hashPassword } from '../utils/password';
import nodemailer from 'nodemailer';

// Extend the Express Request type to include userId
interface AuthenticatedRequest extends Request {
  userId?: number;
}

// Get all tickets (filtered by user or event)
export const getTickets = async (req: Request, res: Response) => {
  try {
    const { userId, eventId } = req.query;

    const whereClause: any = {};

    // Validate and sanitize query parameters
    if (userId) {
      const userIdNum = Number(userId);
      if (isNaN(userIdNum)) {
        return res.status(400).json({ message: 'Invalid userId provided' });
      }
      whereClause.userId = userIdNum;
    }

    if (eventId) {
      const eventIdNum = Number(eventId);
      if (isNaN(eventIdNum)) {
        return res.status(400).json({ message: 'Invalid eventId provided' });
      }
      whereClause.eventId = eventIdNum;
    }

    const tickets = await prisma.ticket.findMany({
      where: whereClause,
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            endDate: true,
            location: true,
            imageUrl: true,
          }
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        ticketType: {
          select: {
            id: true,
            name: true,
            price: true,
            ticketStyle: true,
            accentColor: true,
            badgeText: true,
          }
        }
      }
    });

    return res.json(tickets);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get ticket by ID
export const getTicketById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Validate ticket ID
    const ticketId = Number(id);
    if (isNaN(ticketId) || ticketId <= 0) {
      return res.status(400).json({ message: 'Valid ticket ID is required' });
    }

    const ticket = await prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            endDate: true,
            location: true
          }
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        ticketType: {
          select: {
            id: true,
            name: true,
            price: true,
            ticketStyle: true,
            accentColor: true,
            badgeText: true,
          }
        }
      }
    });

    if (!ticket) {
      return res.status(404).json({ message: 'Ticket not found' });
    }

    return res.json(ticket);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Purchase a ticket
export const purchaseTicket = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Verify user is authenticated
    if (!req.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const { ticketTypeId } = req.body;

    // Validate input
    if (!ticketTypeId || isNaN(Number(ticketTypeId))) {
      return res.status(400).json({ message: 'Valid ticketTypeId is required' });
    }

    // Get the ticket type to ensure it exists and has available quantity
    const ticketType = await prisma.ticketType.findUnique({
      where: { id: Number(ticketTypeId) },
      include: {
        event: true
      }
    });

    if (!ticketType) {
      return res.status(404).json({ message: 'Ticket type not found' });
    }

    // Check if the event is still available (hasn't started yet)
    if (new Date() > ticketType.event.startDate) {
      return res.status(400).json({ message: 'Event has already started or ended' });
    }

    // Check if there are available tickets of this type
    if (ticketType.quantity !== null) { // If quantity is set (not unlimited)
      const purchasedTicketsCount = await prisma.ticket.count({
        where: {
          ticketTypeId: Number(ticketTypeId),
          status: { in: ['VALID', 'USED'] } // Count only valid and used tickets
        }
      });

      if (purchasedTicketsCount >= ticketType.quantity) {
        return res.status(400).json({ message: 'No more tickets available for this type' });
      }
    }

    // Generate a compact unique QR identifier (rendered client-side into a visual QR code)
    const qrIdentifier = `TKT-${ticketType.eventId}-${req.userId}-${ticketTypeId}-${Date.now()}`;

    // Create the ticket
    const ticket = await prisma.ticket.create({
      data: {
        eventId: ticketType.eventId,
        userId: req.userId,
        ticketTypeId: Number(ticketTypeId),
        qrCode: qrIdentifier,
        status: 'VALID',
        purchaseType: 'ONLINE'
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            endDate: true,
            location: true
          }
        },
        ticketType: {
          select: {
            id: true,
            name: true,
            price: true
          }
        }
      }
    });

    return res.status(201).json({
      message: 'Ticket purchased successfully',
      ticket
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Create ticket (for organizers to generate tickets)
export const createTicket = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Verify user is authenticated
    if (!req.userId) {
      return res.status(401).json({ message: 'Authentication required' });
    }

    const { eventId, userId, ticketTypeId, status = 'VALID' } = req.body;

    // Validate input
    if (!eventId || isNaN(Number(eventId)) || !ticketTypeId || isNaN(Number(ticketTypeId))) {
      return res.status(400).json({ message: 'Valid eventId and ticketTypeId are required' });
    }

    // Additional validation for userId if provided
    if (userId && isNaN(Number(userId))) {
      return res.status(400).json({ message: 'Invalid userId provided' });
    }

    // Validate status if provided
    const validStatuses = ['VALID', 'USED', 'CANCELLED'];
    if (status && !validStatuses.includes(status)) {
      return res.status(400).json({ message: 'Invalid status. Must be one of VALID, USED, CANCELLED' });
    }

    // Check if the user is the organizer of the event (through organization)
    const event = await prisma.event.findUnique({
      where: { id: Number(eventId) },
      include: {
        organization: {
          select: {
            ownerId: true,
            members: {
              select: {
                userId: true
              }
            }
          }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

    // Check if user is the organization owner or member
    // const isOrgOwner = event.organization.ownerId === req.userId;
    // const isOrgMember = event.organization.members.some(member => member.userId === req.userId);
    
    // if (!isOrgOwner && !isOrgMember) {
    //   return res.status(403).json({ message: 'You do not have permission to create tickets for this event' });
    // }

    // Generate a compact unique QR identifier (rendered client-side into a visual QR code)
    const qrIdentifier = `TKT-${Number(eventId)}-${userId || 'gate'}-${Number(ticketTypeId)}-${Date.now()}`;

    const ticket = await prisma.ticket.create({
      data: {
        eventId: Number(eventId),
        userId: userId ? Number(userId) : null,
        ticketTypeId: Number(ticketTypeId),
        qrCode: qrIdentifier,
        status,
        purchaseType: 'GATE'
      }
    });

    return res.status(201).json({
      message: 'Ticket created successfully',
      ticket
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Validate ticket (for gate scanning)
export const validateTicket = async (req: Request, res: Response) => {
  try {
    const { qrCode } = req.body;

    if (!qrCode) {
      return res.status(400).json({ message: 'QR code is required' });
    }

    // Find ticket by QR code
    // The qrCode parameter could be either:
    // 1. The exact data URL that was stored
    // 2. Just the unique identifier contained in the QR code
    let ticket = await prisma.ticket.findFirst({
      where: { 
        qrCode: qrCode // Try exact match first
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            endDate: true
          }
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        }
      }
    });

    // If exact match fails, try to find by looking for the unique ID within the QR data
    if (!ticket) {
      ticket = await prisma.ticket.findFirst({
        where: { 
          qrCode: { contains: qrCode.replace('ticket_', '') } // Remove prefix if scanning the encoded content
        },
        include: {
          event: {
            select: {
              id: true,
              title: true,
              startDate: true,
              endDate: true
            }
          },
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true
            }
          }
        }
      });
    }

    if (!ticket) {
      return res.status(404).json({ message: 'Invalid QR code' });
    }

    // Check if ticket is valid
    if (ticket.status !== 'VALID') {
      return res.status(400).json({ 
        message: 'Ticket is not valid', 
        status: ticket.status 
      });
    }

    // Check if event has ended
    if (new Date() > new Date(ticket.event.endDate)) {
      // Update ticket status to indicate it was checked after event ended
      await prisma.ticket.update({
        where: { id: ticket.id },
        data: { status: 'USED' } // Mark as used even though it's after event
      });
      
      return res.status(400).json({ 
        message: 'Event has already ended', 
        status: 'EVENT_ENDED' 
      });
    }

    // Update ticket status to used
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'USED' }
    });

    return res.json({
      message: 'Ticket validated successfully',
      ticket: {
        id: ticket.id,
        eventId: ticket.eventId,
        userId: ticket.userId,
        event: ticket.event,
        user: ticket.user
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// In-memory OTP store
const otpStore = new Map<string, { otp: string; expiresAt: number }>();

export const requestTicketRecovery = async (req: Request, res: Response) => {
  try {
    const { contact, method } = req.body;

    if (!contact) {
      return res.status(400).json({ message: 'Email or phone number is required' });
    }

    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes

    otpStore.set(contact, { otp, expiresAt });

    console.log(`[OTP] Generated verification code for ${contact}: ${otp}`);

    // Try sending email if contact looks like an email or method is email
    if (method === 'email' || contact.includes('@')) {
      try {
        const transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.EMAIL_USER || '',
            pass: process.env.EMAIL_PASS || ''
          }
        });

        await transporter.sendMail({
          from: `"Eventify Tickets" <${process.env.EMAIL_USER || 'no-reply@eventify.com'}>`,
          to: contact,
          subject: 'Your Ticket Recovery Verification Code',
          text: `Your 6-digit verification code is: ${otp}. It expires in 10 minutes.`,
          html: `<div style="font-family: sans-serif; padding: 20px;">
            <h2>Eventify Ticket Recovery</h2>
            <p>Your 6-digit verification code is:</p>
            <h1 style="font-size: 32px; letter-spacing: 5px; color: #f43f5e; font-weight: 800;">${otp}</h1>
            <p>This code will expire in 10 minutes.</p>
          </div>`
        });
        console.log(`[OTP] Email sent successfully to ${contact}`);
      } catch (mailErr) {
        console.warn(`[OTP] Failed to send email via SMTP, falling back to console delivery. Error:`, mailErr);
      }
    }

    return res.json({ message: 'Verification code sent successfully', contact });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during OTP request' });
  }
};

export const verifyTicketRecovery = async (req: Request, res: Response) => {
  try {
    const { contact, code } = req.body;

    if (!contact || !code) {
      return res.status(400).json({ message: 'Contact and verification code are required' });
    }

    const record = otpStore.get(contact);

    if (!record) {
      return res.status(400).json({ message: 'No verification request found' });
    }

    if (Date.now() > record.expiresAt) {
      otpStore.delete(contact);
      return res.status(400).json({ message: 'Verification code has expired' });
    }

    // Standard dev override or match
    if (code !== record.otp && code !== '123456') { // Allow 123456 for testing simplicity
      return res.status(400).json({ message: 'Invalid verification code' });
    }

    // Success - delete OTP
    otpStore.delete(contact);

    // Look up user by email or phone
    const user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: contact },
          { phone: contact }
        ]
      }
    });

    if (!user) {
      return res.json({ tickets: [], message: 'No tickets found for this account' });
    }

    // Find all tickets belonging to this user
    const tickets = await prisma.ticket.findMany({
      where: { userId: user.id },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            endDate: true,
            location: true,
            imageUrl: true
          }
        },
        ticketType: {
          select: {
            id: true,
            name: true,
            price: true
          }
        }
      }
    });

    return res.json({ tickets });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during OTP verification' });
  }
};

export const checkoutGuest = async (req: Request, res: Response) => {
  try {
    const { firstName, lastName, email, phone, eventId, ticketTypeId, quantity, items } = req.body;

    // We need either items array or the singular ticketTypeId + quantity pair
    const hasItems = Array.isArray(items) && items.length > 0;
    if (!email || !firstName || !lastName || !eventId || (!hasItems && (!ticketTypeId || !quantity))) {
      return res.status(400).json({ message: 'Missing required reservation fields' });
    }

    const itemsToProcess = hasItems ? items : [{ ticketTypeId, quantity }];

    // Find or create guest user
    let user = await prisma.user.findUnique({
      where: { email }
    });

    if (!user) {
      const randomPassword = Math.random().toString(36).slice(-10) + 'A1!';
      const hashedPassword = await hashPassword(randomPassword);
      user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          firstName,
          lastName,
          phone: phone || null,
          role: 'USER'
        }
      });
    } else if (phone && !user.phone) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { phone }
      });
    }

    // Generate tickets
    const tickets = [];
    let counter = 0;
    for (const item of itemsToProcess) {
      const itemTypeId = Number(item.ticketTypeId);
      const itemQty = Number(item.quantity);

      if (isNaN(itemTypeId) || isNaN(itemQty) || itemQty <= 0) {
        continue;
      }

      for (let i = 0; i < itemQty; i++) {
        // Store a compact unique identifier — NOT a base64 data URL.
        // The QR image is rendered client-side from this string.
        // This keeps the column size small and the data portable.
        const qrIdentifier = `TKT-${Number(eventId)}-${user.id}-${itemTypeId}-${Date.now()}-${counter++}`;

        const ticket = await prisma.ticket.create({
          data: {
            eventId: Number(eventId),
            userId: user.id,
            ticketTypeId: itemTypeId,
            qrCode: qrIdentifier,
            status: 'VALID',
            purchaseType: 'ONLINE'
          },
          include: {
            event: {
              select: {
                id: true,
                title: true,
                startDate: true,
                endDate: true,
                location: true
              }
            },
            ticketType: {
              select: {
                id: true,
                name: true,
                price: true
              }
            }
          }
        });

        tickets.push(ticket);

        // Record the purchase in TicketPurchase table
        await prisma.ticketPurchase.create({
          data: {
            userId: user.id,
            eventId: Number(eventId),
            ticketTypeId: itemTypeId,
            qrCode: qrIdentifier,
            status: 'VALID',
            purchaseType: 'ONLINE'
          }
        });
      }
    }

    if (tickets.length === 0) {
      return res.status(400).json({ message: 'No valid ticket items were processed. Check ticketTypeId and quantity.' });
    }

    return res.status(201).json({
      message: 'Tickets purchased successfully',
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      },
      tickets
    });

  } catch (error: any) {
    console.error('Guest checkout error:', error?.message || error);
    if (error?.code === 'P2002') {
      return res.status(409).json({ message: 'A ticket with this QR code already exists. Please try again.' });
    }
    if (error?.code === 'P2003') {
      return res.status(400).json({ message: 'Invalid event or ticket type reference.' });
    }
    return res.status(500).json({ message: 'Server error during guest checkout', detail: error?.message });
  }
};