import { Request, Response } from 'express';
import { prisma } from '../prisma';
import cloudinary from '../config/cloudinary';
import path from 'path';
import fs from 'fs';

// Get all events
export const getEvents = async (req: Request, res: Response) => {
  try {
    const { search, location, date, page = 1, limit = 10 } = req.query;

    const skip = (Number(page) - 1) * Number(limit);

    const whereClause: any = {
      isPublished: true // Only return published events
    };

    if (search) {
      whereClause.OR = [
        { title: { contains: String(search), mode: 'insensitive' } },
        { description: { contains: String(search), mode: 'insensitive' } }
      ];
    }

    if (location) {
      whereClause.location = { contains: String(location), mode: 'insensitive' };
    }

    if (date) {
      const dateFilter = new Date(String(date));
      whereClause.startDate = {
        gte: new Date(dateFilter.setHours(0, 0, 0, 0)),
        lte: new Date(dateFilter.setHours(23, 59, 59, 999))
      };
    }

    const events = await prisma.event.findMany({
      where: whereClause,
      include: {
        organizer: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        ticketTypes: {
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true
          }
        }
      },
      skip,
      take: Number(limit)
    });

    const total = await prisma.event.count({ where: whereClause });

    return res.json({
      events,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit))
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get event by ID
export const getEventById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const event = await prisma.event.findUnique({
      where: { id: Number(id) },
      include: {
        organizer: {
          select: {
            id: true,
            firstName: true,
            lastName: true
          }
        },
        ticketTypes: {
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true
          }
        },
        vendors: {
          where: {
            isApproved: true // Only approved vendors
          },
          select: {
            id: true,
            businessName: true,
            description: true
          }
        }
      }
    });

    if (!event) {
      return res.status(404).json({ message: 'Event not found' });
    }

   return res.json(event);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Create a new event
export const createEvent = async (req: any, res: Response) => {
  try {
    const { 
      title, 
      description, 
      startDate, 
      endDate, 
      location, 
      price, 
      capacity,
      ticketTypes,
      allowVendors,
      stallType,
      stallFee,
      maxVendors,
      vendorDeadline,
      gateTicketing
    } = req.body;

    let imageUrl = null;

    // If an image file was uploaded
    if (req.file) {
      try {
        // Upload image to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: 'event_images', // Optional: organize images in a folder
          use_filename: false,
          unique_filename: true,
          overwrite: false,
        });

        // Get the secure URL from Cloudinary
        imageUrl = result.secure_url;

        // Delete the temporary file after upload
        fs.unlinkSync(req.file.path);
      } catch (uploadError) {
        console.error('Cloudinary upload error:', uploadError);
        return res.status(500).json({ message: 'Failed to upload image' });
      }
    }

    // Create event
    const event = await prisma.event.create({
      data: {
        title,
        description,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        location,
        price,
        capacity,
        imageUrl, // Add the image URL to the event
        isPublished: false, // Events are not published by default
        organizerId: req.userId, // Current user is the organizer
        allowVendors,
        stallType,
        stallFee,
        maxVendors,
        vendorDeadline: vendorDeadline ? new Date(vendorDeadline) : null,
        gateTicketing
      }
    });

    // Create ticket types if provided
    if (ticketTypes && Array.isArray(ticketTypes)) {
      for (const ticketType of ticketTypes) {
        await prisma.ticketType.create({
          data: {
            name: ticketType.name,
            price: ticketType.price,
            quantity: ticketType.quantity,
            eventId: event.id
          }
        });
      }
    }

    res.status(201).json({
      message: 'Event created successfully',
      event
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update an event
export const updateEvent = async (req: any, res: Response) => {
  try {
    const { id } = req.params;
    const { 
      title, 
      description, 
      startDate, 
      endDate, 
      location, 
      price, 
      capacity,
      isPublished,
      ticketTypes,
      allowVendors,
      stallType,
      stallFee,
      maxVendors,
      vendorDeadline,
      gateTicketing
    } = req.body;

    // Check if event exists and belongs to the user
    const existingEvent = await prisma.event.findFirst({
      where: {
        id: Number(id),
        organizerId: req.userId
      }
    });

    if (!existingEvent) {
      return res.status(404).json({ message: 'Event not found or you do not have permission to update it' });
    }

    let imageUrl = existingEvent.imageUrl; // Keep the existing image URL by default

    // If a new image file was uploaded
    if (req.file) {
      try {
        // Upload new image to Cloudinary
        const result = await cloudinary.uploader.upload(req.file.path, {
          folder: 'event_images', // Optional: organize images in a folder
          use_filename: false,
          unique_filename: true,
          overwrite: false,
        });

        // Get the secure URL from Cloudinary
        imageUrl = result.secure_url;

        // Delete the temporary file after upload
        fs.unlinkSync(req.file.path);
      } catch (uploadError) {
        console.error('Cloudinary upload error:', uploadError);
        return res.status(500).json({ message: 'Failed to upload image' });
      }
    }

    // Update event
    const event = await prisma.event.update({
      where: { id: Number(id) },
      data: {
        title: title ?? existingEvent.title,
        description: description ?? existingEvent.description,
        startDate: startDate ? new Date(startDate) : existingEvent.startDate,
        endDate: endDate ? new Date(endDate) : existingEvent.endDate,
        location: location ?? existingEvent.location,
        price: price ?? existingEvent.price,
        capacity: capacity ?? existingEvent.capacity,
        imageUrl: imageUrl, // Use the updated imageUrl
        isPublished: isPublished ?? existingEvent.isPublished,
        allowVendors: allowVendors ?? existingEvent.allowVendors,
        stallType: stallType ?? existingEvent.stallType,
        stallFee: stallFee ?? existingEvent.stallFee,
        maxVendors: maxVendors ?? existingEvent.maxVendors,
        vendorDeadline: vendorDeadline ? new Date(vendorDeadline) : existingEvent.vendorDeadline,
        gateTicketing: gateTicketing ?? existingEvent.gateTicketing
      }
    });

    // Update ticket types if provided
    if (ticketTypes && Array.isArray(ticketTypes)) {
      // Delete existing ticket types
      await prisma.ticketType.deleteMany({
        where: { eventId: Number(id) }
      });

      // Create new ticket types
      for (const ticketType of ticketTypes) {
        await prisma.ticketType.create({
          data: {
            name: ticketType.name,
            price: ticketType.price,
            quantity: ticketType.quantity,
            eventId: event.id
          }
        });
      }
    }

    return res.json({
      message: 'Event updated successfully',
      event
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Delete an event
export const deleteEvent = async (req: any, res: Response) => {
  try {
    const { id } = req.params;

    // Check if event exists and belongs to the user
    const existingEvent = await prisma.event.findFirst({
      where: {
        id: Number(id),
        organizerId: req.userId
      }
    });

    if (!existingEvent) {
      return res.status(404).json({ message: 'Event not found or you do not have permission to delete it' });
    }

    // Delete all related records first (due to foreign key constraints)
    await prisma.ticket.deleteMany({
      where: { eventId: Number(id) }
    });

    await prisma.ticketType.deleteMany({
      where: { eventId: Number(id) }
    });

    await prisma.vendor.deleteMany({
      where: { eventId: Number(id) }
    });

    // Finally delete the event
    await prisma.event.delete({
      where: { id: Number(id) }
    });

    return res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};