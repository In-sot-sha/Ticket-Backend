import { Request, Response } from 'express';
import { prisma } from '../prisma';
import * as QRCode from 'qrcode';

// Get all tickets (filtered by user or event)
export const getTickets = async (req: Request, res: Response) => {
  try {
    const { userId, eventId } = req.query;

    const whereClause: any = {};

    if (userId) {
      whereClause.userId = Number(userId);
    }

    if (eventId) {
      whereClause.eventId = Number(eventId);
    }

    const tickets = await prisma.ticket.findMany({
      where: whereClause,
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
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
            price: true
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

    const ticket = await prisma.ticket.findUnique({
      where: { id: Number(id) },
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
            price: true
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
export const purchaseTicket = async (req: any, res: Response) => {
  try {
    const { ticketTypeId } = req.body;

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
export const createTicket = async (req: any, res: Response) => {
  try {
    const { eventId, userId, ticketTypeId, status = 'VALID' } = req.body;

    // Check if the user is the organizer of the event
    const event = await prisma.event.findUnique({
      where: { id: Number(eventId) }
    });

    if (!event || event.organizerId !== req.userId) {
      return res.status(403).json({ message: 'You do not have permission to create tickets for this event' });
    }

    // Generate unique QR code
    const uniqueId = `ticket_${Date.now()}_${userId || 'guest'}_${eventId}`;
    const qrCodeData = await QRCode.toDataURL(uniqueId);

    const ticket = await prisma.ticket.create({
      data: {
        eventId: Number(eventId),
        userId: userId || null, // Could be for a specific user or for gate purchase
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
    const ticket = await prisma.ticket.findFirst({
      where: { 
        qrCode: { contains: qrCode.split(',')[1] || qrCode } // Extract base64 from data URL if needed
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

    if (!ticket) {
      return res.status(404).json({ message: 'Invalid QR code' });
    }

    // Check if ticket is valid and event hasn't ended
    if (ticket.status !== 'VALID') {
      return res.status(400).json({ 
        message: 'Ticket is not valid', 
        status: ticket.status 
      });
    }

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