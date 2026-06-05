import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';

// Request to become an organizer
export const becomeOrganizer = async (req: AuthRequest, res: Response) => {
  try {
    const { businessName, description, contactInfo } = req.body;

    // Check if user already has organizations
    const existingOrgs = await prisma.organization.count({
      where: { ownerId: req.userId! }
    });

    if (existingOrgs > 0) {
      return res.status(400).json({ message: 'You already have organizations' });
    }

    // Create organization for the user
    const organization = await prisma.organization.create({
      data: {
        name: businessName,
        description: description,
        website: contactInfo,
        ownerId: req.userId!,
        isVerified: false // Set to false initially, requires admin verification
      }
    });

    // Add user as owner member
    await prisma.organizationMember.create({
      data: {
        userId: req.userId!,
        organizationId: organization.id,
        role: 'admin'
      }
    });

    // Update user role
    const user = await prisma.user.update({
      where: { id: Number(req.userId) },
      data: {
        role: 'ORGANIZER'
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true
      }
    });

    return res.status(200).json({
      message: 'Successfully became an organizer',
      user,
      organization
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during organizer request' });
  }
};

// Request to become a vendor (this creates a vendor profile, different from applying to events)
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

// Get organizer profile (organization details)
export const getOrganizerProfile = async (req: AuthRequest, res: Response) => {
  try {
    const organizations = await prisma.organization.findMany({
      where: {
        OR: [
          { ownerId: req.userId! },
          { members: {
              some: {
                userId: req.userId!
              }
            }
          }
        ]
      },
      include: {
        _count: {
          select: {
            members: true,
            events: true
          }
        }
      }
    });

    if (organizations.length === 0) {
      return res.status(404).json({ message: 'No organizations found for this user' });
    }

    return res.json(organizations);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Update organizer profile (organization details)
export const updateOrganizerProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { organizationId, businessName, description, contactInfo, } = req.body;

    // Check if user owns this organization
    const organization = await prisma.organization.findFirst({
      where: {
        id: Number(organizationId),
        ownerId: req.userId!
      }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found or you do not have permission to update it' });
    }

    const updatedOrg = await prisma.organization.update({
      where: { id: Number(organizationId) },
      data: {
        name: businessName || organization.name,
        description: description || organization.description,
        website: contactInfo || organization.website,
        // phone: phone || organization.phone
      }
    });

    return res.json({
      message: 'Organizer profile updated successfully',
      organization: updatedOrg
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get vendor applications for an organizer's organizations
export const getVendorApplications = async (req: AuthRequest, res: Response) => {
  try {
    // Only return vendor applications for events organized by organizations this user owns or is a member of
    const vendorApplications = await prisma.vendorApplication.findMany({
      where: {
        event: {
          organization: {
            OR: [
              { ownerId: Number(req.userId) },
              { members: {
                  some: {
                    userId: Number(req.userId)
                  }
                }
              }
            ]
          }
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
        },
        vendor: {
          select: {
            id: true,
            businessName: true,
            description: true,
            contactEmail: true
          }
        }
      },
      orderBy: {
        appliedAt: 'desc'
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
    const vendorApplications = await prisma.vendorApplication.findMany({
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
        },
        vendor: {
          select: {
            id: true,
            businessName: true,
            description: true
          }
        }
      },
      orderBy: {
        appliedAt: 'desc'
      }
    });

    return res.json(vendorApplications);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};