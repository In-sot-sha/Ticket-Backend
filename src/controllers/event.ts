import { Request, Response } from 'express';
import { TicketStatus } from '@prisma/client';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { uploadEventImage } from '../utils/imageUpload';

type TicketSoldGroupRow = {
  ticketTypeId: number;
  status: TicketStatus;
  _count: { id: number };
};

function organizerOrgFilter(userId: number) {
  return {
    OR: [
      { ownerId: userId },
      { members: { some: { userId } } },
    ],
  };
}

function parseJsonField<T>(value: unknown): T | undefined {
  if (value == null || value === '') return undefined;
  if (Array.isArray(value)) return value as T;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function parseBoolean(value: unknown): boolean {
  return value === true || value === 'true';
}

type TicketTypeRow = { id: number; name: string; price: number; quantity: number | null };

function getEventPhase(isPublished: boolean, startDate: Date, endDate: Date): string {
  if (!isPublished) return 'draft';
  const now = new Date();
  if (now < startDate) return 'upcoming';
  if (now <= endDate) return 'live';
  return 'past';
}

async function buildEventStats(
  eventId: number,
  ticketTypes: TicketTypeRow[],
  eventCapacity: number | null
) {
  const soldByType = await prisma.ticket.groupBy({
    by: ['ticketTypeId', 'status'],
    where: { eventId },
    _count: { id: true },
  });

  const rows = soldByType as TicketSoldGroupRow[];
  const countFor = (ticketTypeId: number, statuses: TicketStatus[]) =>
    rows
      .filter((r) => r.ticketTypeId === ticketTypeId && statuses.includes(r.status))
      .reduce((sum: number, r) => sum + r._count.id, 0);

  let ticketsSold = 0;
  let ticketsCheckedIn = 0;
  let actualRevenue = 0;
  let expectedRevenue = 0;
  let ticketInventory = 0;

  const ticketTypeStats = ticketTypes.map((tt) => {
    const sold = countFor(tt.id, ['VALID', 'USED']);
    const checkedIn = countFor(tt.id, ['USED']);
    const revenue = tt.price * sold;
    const expected = tt.price * (tt.quantity ?? 0);
    ticketsSold += sold;
    ticketsCheckedIn += checkedIn;
    actualRevenue += revenue;
    expectedRevenue += expected;
    ticketInventory += tt.quantity ?? 0;
    return {
      id: tt.id,
      name: tt.name,
      price: tt.price,
      quantity: tt.quantity,
      sold,
      checkedIn,
      revenue,
      expectedRevenue: expected,
    };
  });

  const capacity = eventCapacity ?? ticketInventory;

  return {
    ticketsSold,
    ticketsCheckedIn,
    actualRevenue,
    expectedRevenue,
    capacity,
    ticketInventory,
    sellThroughPercent: ticketInventory > 0 ? Math.round((ticketsSold / ticketInventory) * 100) : 0,
    ticketTypeStats,
  };
}

async function userCanManageEvent(userId: number, eventId: number) {
  return prisma.event.findFirst({
    where: {
      id: eventId,
      organization: organizerOrgFilter(userId),
    },
  });
}

// Get all events
export const getEvents = async (req: Request, res: Response) => {
  try {
    const { search, location, date, category, page = 1, limit = 10 } = req.query;

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

    if (category) {
      whereClause.category = String(category);
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
            quantity: true,
            ticketStyle: true,
            accentColor: true,
            badgeText: true,
            ticketHeadline: true,
            venueLabel: true,
          },
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
            quantity: true,
            ticketStyle: true,
            accentColor: true,
            badgeText: true,
            ticketHeadline: true,
            venueLabel: true,
          },
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
      category: _category,
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
      onlineUrl,
      organizationId, // New field for organization
      vendorTypes, // Added to support multiple vendor types
      amenities,
      highlights,
    } = req.body;

    const parsedTicketTypes = parseJsonField<Array<{
      name: string;
      price?: string | number;
      quantity?: string | number;
      ticketStyle?: string;
      accentColor?: string;
      badgeText?: string;
      ticketHeadline?: string;
      venueLabel?: string;
    }>>(ticketTypes);
    const parsedVendorTypes = parseJsonField<Array<{ name?: string; stallType?: string; fee?: string | number; maxVendors?: string | number }>>(vendorTypes);
    const parsedAmenities = parseJsonField<string[]>(amenities);
    const parsedHighlights = parseJsonField<Array<{ icon: string; label: string }>>(highlights);

    let imageUrl = null;

    // If an image file was uploaded
    if (req.file) {
      try {
        imageUrl = await uploadEventImage(req.file, req);
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return res.status(500).json({ message: 'Failed to upload image' });
      }
    }

    const resolvedLocationType = locationType || 'physical';
    const resolvedOnlineUrl = onlineUrl || website || null;
    // Determine the actual location to store based on locationType
    const actualLocation = resolvedLocationType === 'online'
      ? (resolvedOnlineUrl || location)
      : location;

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
        imageUrl,
        amenities: parsedAmenities?.length ? JSON.stringify(parsedAmenities) : null,
        highlights: parsedHighlights?.length ? JSON.stringify(parsedHighlights) : null,
        isPublished: parseBoolean(isPublished),
        organizationId: orgId, // Use organization ID instead of organizerId
        allowVendors: parseBoolean(allowVendors),
        vendorDeadline: vendorDeadline ? new Date(vendorDeadline) : null,
        gateTicketing: parseBoolean(gateTicketing),
        locationType: resolvedLocationType,
        onlineUrl: resolvedLocationType === 'online' ? resolvedOnlineUrl : null
      }
    });

    // Create ticket types if provided
    if (parsedTicketTypes?.length) {
      for (const ticketType of parsedTicketTypes) {
        await prisma.ticketType.create({
          data: {
            name: ticketType.name,
            price: parseFloat(String(ticketType.price ?? 0)),
            quantity: parseInt(String(ticketType.quantity ?? 0), 10),
            ticketStyle: ticketType.ticketStyle || 'rose',
            accentColor: ticketType.accentColor || null,
            badgeText: ticketType.badgeText || null,
            ticketHeadline: ticketType.ticketHeadline || null,
            venueLabel: ticketType.venueLabel || null,
            eventId: event.id
          }
        });
      }
    }
    
    // Create vendor types if provided
    if (parseBoolean(allowVendors) && parsedVendorTypes?.length) {
      for (const vendorType of parsedVendorTypes) {
        await prisma.vendorType.create({
          data: {
            name: vendorType.name || vendorType.stallType || 'General Vendor',
            fee: vendorType.fee ? parseFloat(String(vendorType.fee)) : 0,
            maxVendors: vendorType.maxVendors ? parseInt(String(vendorType.maxVendors), 10) : null,
            eventId: event.id
          }
        });
      }
    } else if (parseBoolean(allowVendors) && stallType) {
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

    const eventWithRelations = await prisma.event.findUnique({
      where: { id: event.id },
      include: {
        ticketTypes: true,
        vendorTypes: true,
        organization: { select: { id: true, name: true } },
      },
    });

   return res.status(201).json({
      message: 'Event created successfully',
      event: eventWithRelations ?? event
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
      category: _category2,
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
      onlineUrl,
      organizationId, // New field
      vendorTypes,
      amenities,
      highlights,
    } = req.body;

    const parsedTicketTypes = parseJsonField<Array<{
      name: string;
      price?: string | number;
      quantity?: string | number;
      ticketStyle?: string;
      accentColor?: string;
      badgeText?: string;
      ticketHeadline?: string;
      venueLabel?: string;
    }>>(ticketTypes);
    const parsedVendorTypes = parseJsonField<Array<{ name?: string; stallType?: string; fee?: string | number; maxVendors?: string | number }>>(vendorTypes);
    const parsedAmenities = parseJsonField<string[]>(amenities);
    const parsedHighlights = parseJsonField<Array<{ icon: string; label: string }>>(highlights);

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
        imageUrl = await uploadEventImage(req.file, req);
      } catch (uploadError) {
        console.error('Image upload error:', uploadError);
        return res.status(500).json({ message: 'Failed to upload image' });
      }
    }

    const resolvedLocationType = locationType || existingEvent.locationType;
    const resolvedOnlineUrl = onlineUrl || website || existingEvent.onlineUrl;
    // Determine the actual location to store based on locationType
    const actualLocation = resolvedLocationType === 'online'
      ? (resolvedOnlineUrl || existingEvent.location)
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
      imageUrl: imageUrl,
      ...(amenities !== undefined && {
        amenities: parsedAmenities?.length ? JSON.stringify(parsedAmenities) : null,
      }),
      ...(highlights !== undefined && {
        highlights: parsedHighlights?.length ? JSON.stringify(parsedHighlights) : null,
      }),
      isPublished: isPublished !== undefined ? parseBoolean(isPublished) : existingEvent.isPublished,
      allowVendors: allowVendors !== undefined ? parseBoolean(allowVendors) : existingEvent.allowVendors,
      vendorDeadline: vendorDeadline ? new Date(vendorDeadline) : existingEvent.vendorDeadline,
      gateTicketing: gateTicketing !== undefined ? parseBoolean(gateTicketing) : existingEvent.gateTicketing,
      locationType: resolvedLocationType,
      onlineUrl: resolvedLocationType === 'online' ? resolvedOnlineUrl : null
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
    if (parsedTicketTypes?.length) {
      // We cannot simply deleteMany because existing Ticket rows reference ticketTypeId via a
      // foreign key. Instead:
      //   1. Update ticket types that still exist (matched by name)
      //   2. Create brand-new ones
      //   3. For removed types: only delete if no tickets have been sold against them;
      //      otherwise mark quantity=0 so no more can be sold but history is preserved.

      const existingTypes = await prisma.ticketType.findMany({
        where: { eventId: Number(id) },
        select: { id: true, name: true },
      });

      const incomingNames = new Set(parsedTicketTypes.map((t) => t.name));

      // Handle removed ticket types
      for (const existing of existingTypes) {
        if (!incomingNames.has(existing.name)) {
          const soldCount = await prisma.ticket.count({
            where: { ticketTypeId: existing.id, status: { in: ['VALID', 'USED'] } },
          });
          if (soldCount === 0) {
            // Safe to delete — nobody has bought this type
            await prisma.ticketType.delete({ where: { id: existing.id } });
          } else {
            // Tickets exist — set quantity to 0 to prevent future sales, don't delete
            await prisma.ticketType.update({
              where: { id: existing.id },
              data: { quantity: 0 },
            });
          }
        }
      }

      // Upsert incoming ticket types
      for (const ticketType of parsedTicketTypes) {
        const match = existingTypes.find((e) => e.name === ticketType.name);
        if (match) {
          await prisma.ticketType.update({
            where: { id: match.id },
            data: {
              price: parseFloat(String(ticketType.price ?? 0)),
              quantity: parseInt(String(ticketType.quantity ?? 0), 10),
              ticketStyle: ticketType.ticketStyle || 'rose',
              accentColor: ticketType.accentColor || null,
              badgeText: ticketType.badgeText || null,
              ticketHeadline: ticketType.ticketHeadline || null,
              venueLabel: ticketType.venueLabel || null,
            },
          });
        } else {
          await prisma.ticketType.create({
            data: {
              name: ticketType.name,
              price: parseFloat(String(ticketType.price ?? 0)),
              quantity: parseInt(String(ticketType.quantity ?? 0), 10),
              ticketStyle: ticketType.ticketStyle || 'rose',
              accentColor: ticketType.accentColor || null,
              badgeText: ticketType.badgeText || null,
              ticketHeadline: ticketType.ticketHeadline || null,
              venueLabel: ticketType.venueLabel || null,
              eventId: event.id,
            },
          });
        }
      }
    }
    
    // Update vendor types if provided
    if (allowVendors !== undefined && parseBoolean(allowVendors)) {
      // Delete existing vendor types
      await prisma.vendorType.deleteMany({
        where: { eventId: Number(id) }
      });
      
      // Create new vendor types if provided in the new format
      if (parsedVendorTypes?.length) {
        for (const vendorType of parsedVendorTypes) {
          await prisma.vendorType.create({
            data: {
              name: vendorType.name || vendorType.stallType || 'General Vendor',
              fee: vendorType.fee ? parseFloat(String(vendorType.fee)) : 0,
              maxVendors: vendorType.maxVendors ? parseInt(String(vendorType.maxVendors), 10) : null,
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
            quantity: true,
            ticketStyle: true,
            accentColor: true,
            badgeText: true,
            ticketHeadline: true,
            venueLabel: true,
          },
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

    const eventsWithStats = await Promise.all(
      events.map(async (event: (typeof events)[number]) => {
        const stats = await buildEventStats(event.id, event.ticketTypes, event.capacity);
        const { _count, ...rest } = event;
        return {
          ...rest,
          phase: getEventPhase(event.isPublished, event.startDate, event.endDate),
          revenue: stats.actualRevenue,
          attendees: stats.ticketsSold,
          stats,
        };
      })
    );

    return res.json({
      events: eventsWithStats,
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

// Get a single organizer event with full sales stats
export const getOrganizerEventById = async (req: AuthRequest, res: Response) => {
  try {
    const eventId = Number(req.params.id);
    if (isNaN(eventId) || eventId <= 0) {
      return res.status(400).json({ message: 'Invalid event ID' });
    }

    const event = await userCanManageEvent(req.userId!, eventId);
    if (!event) {
      return res.status(404).json({ message: 'Event not found or you do not have permission' });
    }

    const fullEvent = await prisma.event.findUnique({
      where: { id: eventId },
      include: {
        organization: { select: { id: true, name: true } },
        ticketTypes: {
          select: {
            id: true,
            name: true,
            price: true,
            quantity: true,
            ticketStyle: true,
            badgeText: true,
          },
        },
      },
    });

    if (!fullEvent) {
      return res.status(404).json({ message: 'Event not found' });
    }

    const stats = await buildEventStats(fullEvent.id, fullEvent.ticketTypes, fullEvent.capacity);

    return res.json({
      ...fullEvent,
      phase: getEventPhase(fullEvent.isPublished, fullEvent.startDate, fullEvent.endDate),
      revenue: stats.actualRevenue,
      attendees: stats.ticketsSold,
      stats,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Aggregated analytics & finance data for the organizer dashboard
export const getOrganizerAnalytics = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const orgWhere = { organization: organizerOrgFilter(userId) };

    const events = await prisma.event.findMany({
      where: orgWhere,
      include: {
        ticketTypes: {
          select: { id: true, name: true, price: true, quantity: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    type EventWithStats = {
      id: number;
      title: string;
      startDate: Date;
      endDate: Date;
      isPublished: boolean;
      phase: string;
      stats: Awaited<ReturnType<typeof buildEventStats>>;
    };

    const eventsWithStats: EventWithStats[] = await Promise.all(
      events.map(async (event: (typeof events)[number]) => {
        const stats = await buildEventStats(event.id, event.ticketTypes, event.capacity);
        return {
          id: event.id,
          title: event.title,
          startDate: event.startDate,
          endDate: event.endDate,
          isPublished: event.isPublished,
          phase: getEventPhase(event.isPublished, event.startDate, event.endDate),
          stats,
        };
      })
    );

    const summary = eventsWithStats.reduce(
      (acc: {
        totalEvents: number;
        publishedEvents: number;
        draftEvents: number;
        upcomingEvents: number;
        liveEvents: number;
        pastEvents: number;
        ticketsSold: number;
        ticketsCheckedIn: number;
        actualRevenue: number;
        expectedRevenue: number;
      }, e: EventWithStats) => ({
        totalEvents: acc.totalEvents + 1,
        publishedEvents: acc.publishedEvents + (e.isPublished ? 1 : 0),
        draftEvents: acc.draftEvents + (e.isPublished ? 0 : 1),
        upcomingEvents: acc.upcomingEvents + (e.phase === 'upcoming' ? 1 : 0),
        liveEvents: acc.liveEvents + (e.phase === 'live' ? 1 : 0),
        pastEvents: acc.pastEvents + (e.phase === 'past' ? 1 : 0),
        ticketsSold: acc.ticketsSold + e.stats.ticketsSold,
        ticketsCheckedIn: acc.ticketsCheckedIn + e.stats.ticketsCheckedIn,
        actualRevenue: acc.actualRevenue + e.stats.actualRevenue,
        expectedRevenue: acc.expectedRevenue + e.stats.expectedRevenue,
      }),
      {
        totalEvents: 0,
        publishedEvents: 0,
        draftEvents: 0,
        upcomingEvents: 0,
        liveEvents: 0,
        pastEvents: 0,
        ticketsSold: 0,
        ticketsCheckedIn: 0,
        actualRevenue: 0,
        expectedRevenue: 0,
      }
    );

    const remainingPotential = Math.max(0, summary.expectedRevenue - summary.actualRevenue);
    const sellThroughPercent =
      summary.expectedRevenue > 0
        ? Math.round((summary.actualRevenue / summary.expectedRevenue) * 100)
        : 0;

    // Last 6 months: tickets sold & revenue per month
    const monthKeys: string[] = [];
    const monthlyMap = new Map<string, { month: string; ticketsSold: number; revenue: number; events: number }>();
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      monthKeys.push(key);
      monthlyMap.set(key, { month: label, ticketsSold: 0, revenue: 0, events: 0 });
    }

    for (const e of events) {
      const key = `${e.createdAt.getFullYear()}-${String(e.createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (monthlyMap.has(key)) {
        monthlyMap.get(key)!.events += 1;
      }
    }

    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const recentTickets = await prisma.ticket.findMany({
      where: {
        createdAt: { gte: sixMonthsAgo },
        status: { not: 'CANCELLED' },
        event: orgWhere,
      },
      select: {
        createdAt: true,
        ticketType: { select: { price: true } },
      },
    });

    for (const t of recentTickets) {
      const key = `${t.createdAt.getFullYear()}-${String(t.createdAt.getMonth() + 1).padStart(2, '0')}`;
      const bucket = monthlyMap.get(key);
      if (bucket) {
        bucket.ticketsSold += 1;
        bucket.revenue += t.ticketType.price;
      }
    }

    const monthly = monthKeys.map((k) => monthlyMap.get(k)!);

    const topEvents = [...eventsWithStats]
      .sort((a: EventWithStats, b: EventWithStats) => b.stats.actualRevenue - a.stats.actualRevenue)
      .slice(0, 5)
      .map((e) => ({
        id: e.id,
        title: e.title,
        startDate: e.startDate,
        phase: e.phase,
        ticketsSold: e.stats.ticketsSold,
        ticketsCheckedIn: e.stats.ticketsCheckedIn,
        revenue: e.stats.actualRevenue,
        expectedRevenue: e.stats.expectedRevenue,
      }));

    const recentSales = await prisma.ticket.findMany({
      where: {
        status: { not: 'CANCELLED' },
        event: orgWhere,
      },
      include: {
        event: { select: { id: true, title: true } },
        ticketType: { select: { name: true, price: true } },
        user: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 15,
    });

    const transactions = recentSales.map((t: (typeof recentSales)[number]) => ({
      id: t.id,
      eventId: t.event.id,
      eventTitle: t.event.title,
      ticketType: t.ticketType.name,
      amount: t.ticketType.price,
      buyerName: t.user ? `${t.user.firstName} ${t.user.lastName}`.trim() : 'Guest',
      date: t.createdAt,
      status: t.status === 'USED' ? 'checked_in' : 'sold',
    }));

    const revenueByEvent = eventsWithStats
      .filter((e: EventWithStats) => e.stats.actualRevenue > 0 || e.stats.ticketsSold > 0)
      .map((e: EventWithStats) => ({
        id: e.id,
        title: e.title,
        revenue: e.stats.actualRevenue,
        expectedRevenue: e.stats.expectedRevenue,
        ticketsSold: e.stats.ticketsSold,
        phase: e.phase,
      }))
      .sort((a: { revenue: number }, b: { revenue: number }) => b.revenue - a.revenue);

    return res.json({
      summary: {
        ...summary,
        remainingPotential,
        sellThroughPercent,
        checkInRate:
          summary.ticketsSold > 0
            ? Math.round((summary.ticketsCheckedIn / summary.ticketsSold) * 100)
            : 0,
      },
      monthly,
      topEvents,
      revenueByEvent,
      recentSales: transactions,
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