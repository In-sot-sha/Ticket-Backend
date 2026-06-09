import { Request, Response } from 'express';
import { prisma } from '../prisma';
import * as QRCode from 'qrcode';

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

    // Generate unique QR code
    const uniqueId = `ticket_${Date.now()}_${req.userId}_${ticketTypeId}`;
    const qrCodeData = await QRCode.toDataURL(uniqueId);

    // Create the ticket
    const ticket = await prisma.ticket.create({
      data: {
        eventId: ticketType.eventId,
        userId: req.userId,
        ticketTypeId: Number(ticketTypeId),
        qrCode: qrCodeData,
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

    // Generate unique QR code
    const uniqueId = `ticket_${Date.now()}_${userId || 'guest'}_${eventId}`;
    const qrCodeData = await QRCode.toDataURL(uniqueId);

    const ticket = await prisma.ticket.create({
      data: {
        eventId: Number(eventId),
        userId: userId ? Number(userId) : null, // Convert to number if provided
        ticketTypeId: Number(ticketTypeId),
        qrCode: qrCodeData,
        status,
        purchaseType: 'GATE' // Tickets created by organizers are typically for gate
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