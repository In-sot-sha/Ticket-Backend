import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';

// Organization Member Controller

// Add member to organization
export const addOrganizationMember = async (req: AuthRequest, res: Response) => {
  try {
    const { organizationId, userId, role = 'member' } = req.body;

    // Check if organization exists and user has permission to add members
    const organization = await prisma.organization.findUnique({
      where: { id: Number(organizationId) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Only owner can add members
    if (organization.ownerId !== req.userId) {
      return res.status(403).json({ message: 'You do not have permission to add members to this organization' });
    }

    // Check if user is already a member
    const existingMember = await prisma.organizationMember.findFirst({
      where: {
        organizationId: Number(organizationId),
        userId: Number(userId)
      }
    });

    if (existingMember) {
      return res.status(400).json({ message: 'User is already a member of this organization' });
    }

    // Add member to organization
    const member = await prisma.organizationMember.create({
      data: {
        userId: Number(userId),
        organizationId: Number(organizationId),
        role
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    return res.status(201).json({
      message: 'Member added successfully',
      member
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Remove member from organization
export const removeOrganizationMember = async (req: AuthRequest, res: Response) => {
  try {
    const { organizationId, memberId } = req.params;

    // Check if organization exists and user has permission to remove members
    const organization = await prisma.organization.findUnique({
      where: { id: Number(organizationId) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Only owner can remove members
    if (organization.ownerId !== req.userId) {
      return res.status(403).json({ message: 'You do not have permission to remove members from this organization' });
    }

    // Cannot remove owner
    if (Number(memberId) === organization.ownerId) {
      return res.status(400).json({ message: 'Cannot remove the organization owner' });
    }

    // Check if member exists
    const existingMember = await prisma.organizationMember.findFirst({
      where: {
        organizationId: Number(organizationId),
        userId: Number(memberId)
      }
    });

    if (!existingMember) {
      return res.status(404).json({ message: 'Member not found in this organization' });
    }

    // Remove member from organization
    await prisma.organizationMember.delete({
      where: {
        userId_organizationId: {
          userId: Number(memberId),
          organizationId: Number(organizationId)
        }
      }
    });

    return res.json({ message: 'Member removed successfully' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get all members of an organization
export const getOrganizationMembers = async (req: AuthRequest, res: Response) => {
  try {
    const { organizationId } = req.params;

    // Check if organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: Number(organizationId) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Get members
    const members = await prisma.organizationMember.findMany({
      where: {
        organizationId: Number(organizationId)
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      },
      orderBy: {
        joinedAt: 'desc'
      }
    });

    return res.json(members);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// User Organization Follow Controller

// Follow organization
export const followOrganization = async (req: AuthRequest, res: Response) => {
  try {
    const { organizationId } = req.params;

    // Check if organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: Number(organizationId) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Check if user is already following
    const existingFollow = await prisma.userOrganizationFollow.findFirst({
      where: {
        userId: req.userId!,
        organizationId: Number(organizationId)
      }
    });

    if (existingFollow) {
      return res.status(400).json({ message: 'You are already following this organization' });
    }

    // Follow organization
    const follow = await prisma.userOrganizationFollow.create({
      data: {
        userId: req.userId!,
        organizationId: Number(organizationId)
      }
    });

    return res.status(201).json({
      message: 'Successfully followed organization',
      follow
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Unfollow organization
export const unfollowOrganization = async (req: AuthRequest, res: Response) => {
  try {
    const { organizationId } = req.params;

    // Check if organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: Number(organizationId) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Check if user is following
    const existingFollow = await prisma.userOrganizationFollow.findFirst({
      where: {
        userId: req.userId!,
        organizationId: Number(organizationId)
      }
    });

    if (!existingFollow) {
      return res.status(400).json({ message: 'You are not following this organization' });
    }

    // Unfollow organization
    await prisma.userOrganizationFollow.delete({
      where: {
        userId_organizationId: {
          userId: req.userId!,
          organizationId: Number(organizationId)
        }
      }
    });

    return res.json({ message: 'Successfully unfollowed organization' });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get organization followers
export const getOrganizationFollowers = async (req: AuthRequest, res: Response) => {
  try {
    const { organizationId } = req.params;

    // Check if organization exists
    const organization = await prisma.organization.findUnique({
      where: { id: Number(organizationId) }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization not found' });
    }

    // Get followers
    const followers = await prisma.userOrganizationFollow.findMany({
      where: {
        organizationId: Number(organizationId)
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      },
      orderBy: {
        followedAt: 'desc'
      }
    });

    return res.json(followers);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Vendor Application Controller

// Apply to be a vendor for an event
export const applyToBeVendor = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId, vendorId, vendorType, paymentAmount } = req.body;

    // Check if event allows vendors
    const event = await prisma.event.findUnique({
      where: { id: Number(eventId) }
    });

    if (!event || !event.allowVendors) {
      return res.status(400).json({ message: 'This event does not allow vendor registration' });
    }

    // Check if vendor deadline has passed
    if (event.vendorDeadline && new Date() > new Date(event.vendorDeadline)) {
      return res.status(400).json({ message: 'Vendor registration deadline has passed' });
    }

    // Check if max vendors limit is reached - this is now handled per vendor type
    // For backward compatibility with old events or systems, we'll continue to process

    // Check if vendor already applied for this event
    const existingApplication = await prisma.vendorApplication.findFirst({
      where: {
        vendorId: Number(vendorId),
        eventId: Number(eventId)
      }
    });

    if (existingApplication) {
      return res.status(400).json({ message: 'This vendor has already applied for this event' });
    }

    // Get the vendor profile to verify it exists and belongs to the user
    const vendor = await prisma.vendor.findUnique({
      where: { 
        id: Number(vendorId),
        // userId: req.userId! // Ensure vendor belongs to current user
      }
    });

    if (!vendor) {
      return res.status(403).json({ message: 'You do not have permission to apply with this vendor profile' });
    }



    // If vendorTypeId is provided, check that vendor type exists and get its details
    let vendorTypeDetails = null;
    if (vendorType) { // In this context, vendorType might be the vendorTypeId
      vendorTypeDetails = await prisma.vendorType.findUnique({
        where: { id: Number(vendorType) }
      });

      if (!vendorTypeDetails || vendorTypeDetails.eventId !== Number(eventId)) {
        return res.status(400).json({ message: 'Invalid vendor type for this event' });
      }

      // Check if max vendors limit for this specific vendor type is reached
      const currentVendorsCount = await prisma.vendorApplication.count({
        where: {
          vendorTypeId: Number(vendorType),
          applicationStatus: 'APPROVED'
        }
      });

      if (vendorTypeDetails.maxVendors !== null && currentVendorsCount >= vendorTypeDetails.maxVendors) {
        return res.status(400).json({ message: `Maximum vendor capacity reached for ${vendorTypeDetails.name} vendors` });
      }
    }

    // Create vendor application
    const vendorApplication = await prisma.vendorApplication.create({
      data: {
        vendorId: Number(vendorId),
        userId: req.userId!, // Use the current user as the applicant
        eventId: Number(eventId),
        vendorTypeId: vendorType ? Number(vendorType) : null, // Reference the vendor type
        applicationStatus: 'PENDING', // Pending approval by organizer
        paymentAmount: paymentAmount || null,
        paymentStatus: paymentAmount ? 'PENDING' : 'PAID' // Mark as paid if no payment required
      }
    });

    return res.status(201).json({
      message: 'Vendor application submitted successfully',
      vendorApplication
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get vendor applications
export const getVendorApplications = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId, applicationStatus, vendorId } = req.query;

    const whereClause: any = {};

    if (eventId) {
      whereClause.eventId = Number(eventId);
    }

    if (applicationStatus !== undefined) {
      whereClause.applicationStatus = applicationStatus === 'true';
    }

    if (vendorId) {
      whereClause.vendorId = Number(vendorId);
    }

    const vendorApplications = await prisma.vendorApplication.findMany({
      where: whereClause,
      include: {
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
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    return res.json(vendorApplications);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Get vendor application by ID
export const getVendorApplicationById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    const vendorApplication = await prisma.vendorApplication.findUnique({
      where: { id: Number(id) },
      include: {
        event: {
          select: {
            id: true,
            title: true,
            startDate: true,
            endDate: true,
            location: true,
            organizationId: true
          }
        },
        vendor: {
          select: {
            id: true,
            businessName: true,
            description: true,
            contactEmail: true,
            contactPhone: true,
            website: true
          }
        },
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true
          }
        }
      }
    });

    if (!vendorApplication) {
      return res.status(404).json({ message: 'Vendor application not found' });
    }

    return res.json(vendorApplication);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};

// Update vendor application status (approve/reject) - for organizers
export const updateVendorApplicationStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { applicationStatus, paymentStatus } = req.body;

    // Get the vendor application to check if the current user is the event organizer
    const vendorApplication = await prisma.vendorApplication.findUnique({
      where: { id: Number(id) },
      include: {
        event: {
          select: {
            organizationId: true,
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
        }
      }
    });

    if (!vendorApplication) {
      return res.status(404).json({ message: 'Vendor application not found' });
    }

    // Check if current user is the organizer of the event or a member of the organization
    // const isOrgOwner = vendorApplication.event.organization.ownerId === req.userId;
    // const isOrgMember = vendorApplication.event.organization.members.some(member => member.userId === req.userId);
    
    // if (!isOrgOwner && !isOrgMember) {
    //   return res.status(403).json({ message: 'You do not have permission to update this vendor application status' });
    // }

    // Update vendor application status
    const updatedApplication = await prisma.vendorApplication.update({
      where: { id: Number(id) },
      data: {
        applicationStatus,
        paymentStatus: paymentStatus !== undefined ? paymentStatus : vendorApplication.paymentStatus,
        ...(applicationStatus === 'APPROVED' && { approvedAt: new Date() }),
        ...(applicationStatus === 'REJECTED' && { rejectedAt: new Date() })
      }
    });

    return res.json({
      message: `Vendor application status updated successfully`,
      vendorApplication: updatedApplication
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error' });
  }
};