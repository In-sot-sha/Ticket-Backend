import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';

// Request to become an organizer
export const becomeOrganizer = async (req: AuthRequest, res: Response) => {
  try {
    const { businessName, description, contactInfo } = req.body;

    // Update user to set organizer-related fields
    const user = await prisma.user.update({
      where: { id: Number(req.userId) },
      data: {
        role: 'ORGANIZER',
        isOrganizerVerified: false, // Set to false initially, requires admin verification
        organizerBusinessName: businessName,
        organizerDescription: description,
        organizerContactInfo: contactInfo,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isOrganizerVerified: true,
        organizerBusinessName: true,
        organizerDescription: true,
        organizerContactInfo: true,
      }
    });

    return res.status(200).json({
      message: 'Successfully requested organizer status',
      user
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during organizer request' });
  }
};

// Request to become a vendor (this is different from applying to a specific event)
export const becomeVendor = async (req: AuthRequest, res: Response) => {
  try {
    // In this case, becoming a vendor just means updating the user's role
    // Actual vendor applications to specific events are handled separately
    const user = await prisma.user.update({
      where: { id: Number(req.userId) },
      data: {
        role: 'VENDOR',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
      }
    });

    return res.status(200).json({
      message: 'Successfully updated to vendor role',
      user
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during vendor role update' });
  }
};

// Get organizer profile
export const getOrganizerProfile = async (req: AuthRequest, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: Number(req.userId) },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isOrganizerVerified: true,
        organizerBusinessName: true,
        organizerDescription: true,
        organizerContactInfo: true,
      }
    });

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json(user);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Update organizer profile
export const updateOrganizerProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { businessName, description, contactInfo, phone } = req.body;

    const user = await prisma.user.update({
      where: { id: Number(req.userId) },
      data: {
        organizerBusinessName: businessName,
        organizerDescription: description,
        organizerContactInfo: contactInfo,
        phone: phone,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        role: true,
        isOrganizerVerified: true,
        organizerBusinessName: true,
        organizerDescription: true,
        organizerContactInfo: true,
      }
    });

    return res.json({
      message: 'Organizer profile updated successfully',
      user
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get vendor applications for an organizer's events
export const getVendorApplications = async (req: AuthRequest, res: Response) => {
  try {
    // Only return vendor applications for events organized by this user
    const vendorApplications = await prisma.vendor.findMany({
      where: {
        event: {
          organizerId: Number(req.userId)
        }
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        },
        event: {
          select: {
            id: true,
            title: true,
            startDate: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.json(vendorApplications);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get user's vendor applications
export const getMyVendorApplications = async (req: AuthRequest, res: Response) => {
  try {
    const vendorApplications = await prisma.vendor.findMany({
      where: {
        userId: Number(req.userId)
      },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            location: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    return res.json(vendorApplications);
    
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
    
  }
};