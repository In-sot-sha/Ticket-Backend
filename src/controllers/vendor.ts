import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';

// Register a vendor for an event
export const registerVendor = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId, businessName, description, contactEmail, contactPhone, paymentAmount } = req.body;

    // Check if event allows vendors
    const event = await prisma.event.findUnique({
      where: { id: Number(eventId) }
    });

    if (!event || !event.allowVendors) {
      res.status(400).json({ message: 'This event does not allow vendor registration' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Check if vendor deadline has passed
    if (event.vendorDeadline && new Date() > new Date(event.vendorDeadline)) {
      res.status(400).json({ message: 'Vendor registration deadline has passed' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Check if max vendors limit is reached
    if (event.maxVendors !== null) {
      const currentVendorsCount = await prisma.vendor.count({
        where: {
          eventId: Number(eventId),
          isApproved: true
        }
      });

      if (currentVendorsCount >= event.maxVendors) {
        res.status(400).json({ message: 'Maximum vendor capacity reached for this event' });
        return; // Explicitly return to satisfy TypeScript
      }
    }

    // Check if user is already registered as a vendor for this event
    const existingRegistration = await prisma.vendor.findFirst({
      where: {
        eventId: Number(eventId),
        contactEmail
      }
    });

    if (existingRegistration) {
      res.status(400).json({ message: 'A vendor with this contact email is already registered for this event' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Create vendor registration
    const vendor = await prisma.vendor.create({
      data: {
        eventId: Number(eventId),
        userId: req.userId!, // Use the current user as the vendor
        name: `${req.firstName || ''} ${req.lastName || ''}`, // Use the registering user's name as contact
        businessName,
        description,
        contactEmail,
        contactPhone,
        isApproved: false, // Pending approval by organizer
        isPaid: paymentAmount ? false : true, // Mark as paid if no payment required
        paymentAmount: paymentAmount || null
      }
    });

    res.status(201).json({
      message: 'Vendor registration submitted successfully',
      vendor
    });
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return; // Explicitly return to satisfy TypeScript
  }
};

// Get vendors (filtered by event or approval status)
export const getVendors = async (req: Request, res: Response) => {
  try {
    const { eventId, isApproved, organizerId } = req.query;

    const whereClause: any = {};

    if (eventId) {
      whereClause.eventId = Number(eventId);
    }

    if (isApproved !== undefined) {
      whereClause.isApproved = isApproved === 'true';
    }

    // If organizerId is provided, only show vendors for events they organize
    if (organizerId) {
      whereClause.event = {
        organizerId: Number(organizerId)
      };
    }

    const vendors = await prisma.vendor.findMany({
      where: whereClause,
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true
          }
        }
      }
    });

    res.json(vendors);
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return; // Explicitly return to satisfy TypeScript
  }
};

// Get vendor by ID
export const getVendorById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const vendor = await prisma.vendor.findUnique({
      where: { id: Number(id) },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            endDate: true,
            location: true,
            organizerId: true
          }
        }
      }
    });

    if (!vendor) {
      res.status(404).json({ message: 'Vendor not found' });
      return; // Explicitly return to satisfy TypeScript
    }

    res.json(vendor);
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return; // Explicitly return to satisfy TypeScript
  }
};

// Update vendor status (approve/reject) - for organizers
export const updateVendorStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { isApproved, isPaid } = req.body;

    // Get the vendor to check if the current user is the event organizer
    const vendor = await prisma.vendor.findUnique({
      where: { id: Number(id) },
      include: {
        event: {
          select: {
            organizerId: true
          }
        }
      }
    });

    if (!vendor) {
      res.status(404).json({ message: 'Vendor not found' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Check if current user is the organizer of the event
    if (vendor.event.organizerId !== req.userId) {
      res.status(403).json({ message: 'You do not have permission to update this vendor status' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Update vendor status
    const updatedVendor = await prisma.vendor.update({
      where: { id: Number(id) },
      data: {
        isApproved,
        isPaid: isPaid !== undefined ? isPaid : vendor.isPaid
      }
    });

    res.json({
      message: `Vendor status updated successfully`,
      vendor: updatedVendor
    });
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return; // Explicitly return to satisfy TypeScript
  }
};