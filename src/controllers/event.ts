import { Request, Response } from 'express';
import { prisma } from '../prisma';
import cloudinary from '../config/cloudinary';
import fs from 'fs';
import { AuthRequest } from '../middleware/auth';

// Get all events
export const getEvents = async (req: Request, res: Response) => {
  try {
    const { search, location, date, page = 1, limit = 10 } = req.query;

    // Validate pagination parameters
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit))); // Set reasonable limits
    const skip = (pageNum - 1) * limitNum;

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
        organization: {
          select: {
            id: true,
            name: true
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
        vendorTypes: {
          select: {
            id: true,
            name: true,
            fee: true,
            maxVendors: true
          }
        }
      },
      skip,
      take: limitNum
    });

    const total = await prisma.event.count({ where: whereClause });

    return res.json({
      events,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get event by ID
export const getEventById = async (req: Request, res: Response) => {
  console.log('here')
  try {
    const { id } = req.params;

    // Validate that ID is a valid number
    const eventId = Number(id);
    if (isNaN(eventId) || eventId <= 0) {
      return res.status(400).json({ message: 'Invalid event ID' });
    }

    const event = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organization: {
          select: {
            id: true,
            name: true
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
        vendorTypes: {
          select: {
            id: true,
            name: true,
            fee: true,
            maxVendors: true
          }
        },
        vendorApplications: {
          where: {
            applicationStatus: 'APPROVED' // Only approved vendors
          },
          select: {
            id: true,
            vendor: {
              select: {
                businessName: true,
                description: true
              }
            }
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
export const createEvent = async (req: AuthRequest, res: Response) => {
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
      gateTicketing,
      isPublished,
      locationType,
      website,
      organizationId, // New field for organization
      vendorTypes // Added to support multiple vendor types
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

    // Determine the actual location to store based on locationType
    const actualLocation = locationType === 'online' ? (website || location) : location;

    // Check if organizationId is provided, otherwise create a default organization for the user
    let orgId = organizationId;
    if (!orgId) {
      // Check if user already has an organization
      const existingOrg = await prisma.organization.findFirst({
        where: { ownerId: req.userId! }
      });
      
      if (existingOrg) {
        orgId = existingOrg.id;
      } else {
        // Create a default organization for the user
        const newOrg = await prisma.organization.create({
          data: {
            name: `${req.firstName || ''} ${req.lastName || ''}'s Organization`.trim() || 'Default Organization',
            ownerId: req.userId!,
            isVerified: false
          }
        });
        orgId = newOrg.id;
      }
    }

    // Create event with organization reference instead of direct user reference
    const event = await prisma.event.create({
      data: {
        title,
        description,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        location: actualLocation,
        price: price ? parseFloat(price) : null,
        capacity: capacity ? parseInt(capacity) : null,
        imageUrl, // Add the image URL to the event
        isPublished: isPublished === 'true', // Convert string to boolean
        organizationId: orgId, // Use organization ID instead of organizerId
        allowVendors: allowVendors === 'true',
        vendorDeadline: vendorDeadline ? new Date(vendorDeadline) : null,
        gateTicketing: gateTicketing === 'true',
        locationType: locationType || 'physical',
        onlineUrl: locationType === 'online' ? website : null
      }
    });

    // Create ticket types if provided
    if (ticketTypes && Array.isArray(ticketTypes)) {
      for (const ticketType of ticketTypes) {
        await prisma.ticketType.create({
          data: {
            name: ticketType.name,
            price: parseFloat(ticketType.price || 0),
            quantity: parseInt(ticketType.quantity || 0),
            eventId: event.id
          }
        });
      }
    }
    
    // Create vendor types if provided
    if (allowVendors === 'true' && vendorTypes && Array.isArray(vendorTypes)) {
      for (const vendorType of vendorTypes) {
        await prisma.vendorType.create({
          data: {
            name: vendorType.name || vendorType.stallType,
            fee: vendorType.fee ? parseFloat(vendorType.fee) : 0,
            maxVendors: vendorType.maxVendors ? parseInt(vendorType.maxVendors) : null,
            eventId: event.id
          }
        });
      }
    } else if (allowVendors === 'true' && stallType) {
      // Backward compatibility: if vendorTypes is not provided but individual fields are, 
      // create a single vendor type using the old format
      await prisma.vendorType.create({
        data: {
          name: stallType || 'General Vendor',
          fee: stallFee ? parseFloat(stallFee) : 0,
          maxVendors: maxVendors ? parseInt(maxVendors) : null,
          eventId: event.id
        }
      });
    }

   return res.status(201).json({
      message: 'Event created successfully',
      event
    });
  } catch (error) {
    console.error(error);
   return res.status(500).json({ message: 'Server error' });
  }
};

// Update an event
export const updateEvent = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const eventId = Number(id);
    
    // Validate that ID is a valid number
    if (isNaN(eventId) || eventId <= 0) {
      return res.status(400).json({ message: 'Invalid event ID' });
    }
    
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
      gateTicketing,
      locationType,
      website,
      organizationId, // New field
      vendorTypes // Added to support multiple vendor types
    } = req.body;

    // Check if event exists and belongs to an organization the user owns or is a member of
    const existingEvent = await prisma.event.findFirst({
      where: {
        id: eventId,
        organization: {
          OR: [
            { ownerId: req.userId! },
            { members: {
                some: {
                  userId: req.userId!
                }
              }
            }
          ]
        }
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

    // Determine the actual location to store based on locationType
    const actualLocation = locationType === 'online' 
      ? (website || existingEvent.location) 
      : (location || existingEvent.location);

    // Prepare update data
    const updateData: any = {
      title: title ?? existingEvent.title,
      description: description ?? existingEvent.description,
      startDate: startDate ? new Date(startDate) : existingEvent.startDate,
      endDate: endDate ? new Date(endDate) : existingEvent.endDate,
      location: actualLocation,
      price: price ? parseFloat(price) : existingEvent.price,
      capacity: capacity ? parseInt(capacity) : existingEvent.capacity,
      imageUrl: imageUrl, // Use the updated imageUrl
      isPublished: isPublished ? isPublished === 'true' : existingEvent.isPublished, // Convert string to boolean
      allowVendors: allowVendors ? allowVendors === 'true' : existingEvent.allowVendors,
      vendorDeadline: vendorDeadline ? new Date(vendorDeadline) : existingEvent.vendorDeadline,
      gateTicketing: gateTicketing ? gateTicketing === 'true' : existingEvent.gateTicketing,
      locationType: locationType || existingEvent.locationType,
      onlineUrl: locationType === 'online' ? (website || existingEvent.onlineUrl) : existingEvent.onlineUrl
    };

    // If organizationId is provided and different from current, check permissions
    if (organizationId && organizationId !== existingEvent.organizationId) {
      // Check if user has permission to move event to this organization
      const targetOrg = await prisma.organization.findFirst({
        where: {
          id: organizationId,
          OR: [
            { ownerId: req.userId! },
            { members: {
                some: {
                  userId: req.userId!
                }
              }
            }
          ]
        }
      });
      
      if (targetOrg) {
        updateData.organizationId = organizationId;
      } else {
        return res.status(403).json({ message: 'You do not have permission to move this event to the specified organization' });
      }
    }

    // Update event
    const event = await prisma.event.update({
      where: { id: Number(id) },
      data: updateData
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
            price: parseFloat(ticketType.price || 0),
            quantity: parseInt(ticketType.quantity),
            eventId: event.id
          }
        });
      }
    }
    
    // Update vendor types if provided
    if (allowVendors) {
      // Delete existing vendor types
      await prisma.vendorType.deleteMany({
        where: { eventId: Number(id) }
      });
      
      // Create new vendor types if provided in the new format
      if (vendorTypes && Array.isArray(vendorTypes)) {
        for (const vendorType of vendorTypes) {
          await prisma.vendorType.create({
            data: {
              name: vendorType.name || vendorType.stallType,
              fee: vendorType.fee ? parseFloat(vendorType.fee) : 0,
              maxVendors: vendorType.maxVendors ? parseInt(vendorType.maxVendors) : null,
              eventId: event.id
            }
          });
        }
      } else if (stallType) {
        // Backward compatibility: if vendorTypes is not provided but individual fields are, 
        // create a single vendor type using the old format
        await prisma.vendorType.create({
          data: {
            name: stallType,
            fee: stallFee ? parseFloat(stallFee) : 0,
            maxVendors: maxVendors ? parseInt(maxVendors) : null,
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

// Get events for the authenticated organizer (now organization owner or member)
export const getOrganizerEvents = async (req: AuthRequest, res: Response) => {
  console.log('here')
  try {
    const { page = 1, limit = 10 } = req.query;

    // Validate pagination parameters
    const pageNum = Math.max(1, Number(page));
    const limitNum = Math.min(100, Math.max(1, Number(limit))); // Set reasonable limits
    const skip = (pageNum - 1) * limitNum;

    // Get events organized by organizations the current user owns or is a member of
    const events = await prisma.event.findMany({
      where: {
        organization: {
          OR: [
            { ownerId: req.userId! },
            { members: {
                some: {
                  userId: req.userId!
                }
              }
            }
          ]
        }
      },
      include: {
        organization: {
          select: {
            id: true,
            name: true
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
        vendorTypes: {
          select: {
            id: true,
            name: true,
            fee: true,
            maxVendors: true
          }
        },
        _count: {
          select: {
            tickets: true // Count of tickets sold for this event
          }
        }
      },
      skip,
      take: limitNum,
      orderBy: {
        createdAt: 'desc' // Most recent events first
      }
    });

    const total = await prisma.event.count({
      where: {
        organization: {
          OR: [
            { ownerId: req.userId! },
            { members: {
                some: {
                  userId: req.userId!
                }
              }
            }
          ]
        }
      }
    });

    // Calculate revenue for each event based on ticket sales
    const eventsWithRevenue = await Promise.all(events.map(async (event) => {
      // Calculate revenue based on actual ticket sales
      let revenue = 0;
      
      // For each ticket type, get the count of tickets sold
      for (const ticketType of event.ticketTypes) {
        // Validate ticketTypeId is a valid number
        if (!isNaN(ticketType.id) && ticketType.id > 0) {
          // Count how many tickets were sold for this specific ticket type
          const ticketSalesCount = await prisma.ticket.count({
            where: {
              ticketTypeId: ticketType.id,
              status: { not: 'CANCELLED' } // Count only non-cancelled tickets
            }
          });
          
          // Add to revenue: price * number sold
          revenue += ticketType.price * ticketSalesCount;
        }
      }

      return {
        ...event,
        revenue: revenue,
        attendees: event._count.tickets // Total number of tickets sold
      };
    }));

    return res.json({
      events: eventsWithRevenue,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Delete an event
export const deleteEvent = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const eventId = Number(id);
    
    // Validate that ID is a valid number
    if (isNaN(eventId) || eventId <= 0) {
      return res.status(400).json({ message: 'Invalid event ID' });
    }

    // Check if event exists and belongs to an organization the user owns or is a member of
    const existingEvent = await prisma.event.findFirst({
      where: {
        id: eventId,
        organization: {
          OR: [
            { ownerId: req.userId! },
            { members: {
                some: {
                  userId: req.userId!
                }
              }
            }
          ]
        }
      }
    });

    if (!existingEvent) {
      return res.status(404).json({ message: 'Event not found or you do not have permission to delete it' });
    }

    // Delete all related records first (due to foreign key constraints)
    await prisma.ticket.deleteMany({
      where: { eventId: eventId }
    });

    await prisma.ticketType.deleteMany({
      where: { eventId: eventId }
    });

    await prisma.vendorApplication.deleteMany({
      where: { eventId: eventId }
    });

    // Finally delete the event
    await prisma.event.delete({
      where: { id: eventId }
    });

    return res.json({ message: 'Event deleted successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};