import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';

// Register a vendor for an event (using new VendorApplication model with vendor types)
export const registerVendor = async (req: AuthRequest, res: Response) => {
  try {
    const { eventId, vendorId, vendorTypeId, vendorType, paymentAmount } = req.body;

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

    // If vendorTypeId is provided, check that vendor type exists and get its details
    let vendorTypeDetails = null;
    if (vendorTypeId) {
      vendorTypeDetails = await prisma.vendorType.findUnique({
        where: { id: Number(vendorTypeId) }
      });

      if (!vendorTypeDetails || vendorTypeDetails.eventId !== Number(eventId)) {
        res.status(400).json({ message: 'Invalid vendor type for this event' });
        return; // Explicitly return to satisfy TypeScript
      }

      // Check if max vendors limit for this specific vendor type is reached
      const currentVendorsCount = await prisma.vendorApplication.count({
        where: {
          vendorTypeId: Number(vendorTypeId),
          applicationStatus: 'APPROVED'
        }
      });

      if (vendorTypeDetails.maxVendors !== null && currentVendorsCount >= vendorTypeDetails.maxVendors) {
        res.status(400).json({ message: `Maximum vendor capacity reached for ${vendorTypeDetails.name} vendors` });
        return; // Explicitly return to satisfy TypeScript
      }
    } else if (vendorType) {
      // Backward compatibility: if vendorTypeId is not provided but vendorType is,
      // we look for a vendor type with the given name
      vendorTypeDetails = await prisma.vendorType.findFirst({
        where: {
          eventId: Number(eventId),
          name: vendorType
        }
      });

      if (!vendorTypeDetails) {
        res.status(400).json({ message: `No vendor type found with name: ${vendorType}` });
        return; // Explicitly return to satisfy TypeScript
      }

      // Check if max vendors limit for this specific vendor type is reached
      const currentVendorsCount = await prisma.vendorApplication.count({
        where: {
          vendorTypeId: vendorTypeDetails.id,
          applicationStatus: 'APPROVED'
        }
      });

      if (vendorTypeDetails.maxVendors !== null && currentVendorsCount >= vendorTypeDetails.maxVendors) {
        res.status(400).json({ message: `Maximum vendor capacity reached for ${vendorTypeDetails.name} vendors` });
        return; // Explicitly return to satisfy TypeScript
      }
    } else {
      // If neither vendorTypeId nor vendorType is provided, use the first available vendor type
      vendorTypeDetails = await prisma.vendorType.findFirst({
        where: { eventId: Number(eventId) }
      });

      if (!vendorTypeDetails) {
        res.status(400).json({ message: 'No vendor types available for this event' });
        return; // Explicitly return to satisfy TypeScript
      }
    }

    // Check if vendor already applied for this event with the same vendor type
    const existingApplication = await prisma.vendorApplication.findFirst({
      where: {
        vendorId: Number(vendorId),
        eventId: Number(eventId),
        vendorTypeId: vendorTypeDetails!.id
      }
    });

    if (existingApplication) {
      res.status(400).json({ message: 'This vendor has already applied for this vendor type at this event' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Get the vendor profile to verify it exists and belongs to the user
    const vendor = await prisma.vendor.findUnique({
      where: { 
        id: Number(vendorId),
        // userId: req.userId! // Ensure vendor belongs to current user
      }
    });

    if (!vendor) {
      res.status(403).json({ message: 'You do not have permission to apply with this vendor profile' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Create vendor application
    const vendorApplication = await prisma.vendorApplication.create({
      data: {
        vendorId: Number(vendorId),
        userId: req.userId!, // Use the current user as the applicant
        eventId: Number(eventId),
        vendorTypeId: vendorTypeDetails!.id, // Reference the vendor type
        applicationStatus: 'PENDING', // Pending approval by organizer
        paymentAmount: paymentAmount || null,
        paymentStatus: paymentAmount ? 'PENDING' : 'PAID' // Mark as paid if no payment required
      }
    });

    res.status(201).json({
      message: 'Vendor application submitted successfully',
      vendorApplication
    });
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return; // Explicitly return to satisfy TypeScript
  }
};

// Get vendor applications (filtered by event or approval status)
export const getVendorApplications = async (req: Request, res: Response) => {
  try {
    const { eventId, applicationStatus, organizerId } = req.query;

    const whereClause: any = {};

    if (eventId) {
      whereClause.eventId = Number(eventId);
    }

    if (applicationStatus !== undefined) {
      whereClause.applicationStatus = applicationStatus === 'true';
    }

    // If organizerId is provided, only show applications for events they organize
    if (organizerId) {
      whereClause.event = {
        organization: {
          OR: [
            { ownerId: Number(organizerId) },
            { members: {
                some: {
                  userId: Number(organizerId)
                }
              }
            }
          ]
        }
      };
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

    res.json(vendorApplications);
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return; // Explicitly return to satisfy TypeScript
  }
};

// Get vendor application by ID
export const getVendorApplicationById = async (req: Request, res: Response) => {
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
      res.status(404).json({ message: 'Vendor application not found' });
      return; // Explicitly return to satisfy TypeScript
    }

    res.json(vendorApplication);
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return; // Explicitly return to satisfy TypeScript
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
      res.status(404).json({ message: 'Vendor application not found' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Check if current user is the organizer of the event or a member of the organization
    // const isOrgOwner = vendorApplication.event.organization.ownerId === req.userId;
    // const isOrgMember = vendorApplication.event.organization.members.some(member => member.userId === req.userId);
    
    // if (!isOrgOwner && !isOrgMember) {
    //   res.status(403).json({ message: 'You do not have permission to update this vendor application status' });
    //   return; // Explicitly return to satisfy TypeScript
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

    res.json({
      message: `Vendor application status updated successfully`,
      vendorApplication: updatedApplication
    });
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return; // Explicitly return to satisfy TypeScript
  }
};

// Create a vendor profile
export const createVendorProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { businessName, description, contactEmail, contactPhone, website, category } = req.body;

    // Check if vendor with this business name already exists for this user
    const existingVendor = await prisma.vendor.findFirst({
      where: {
        userId: req.userId!,
        businessName
      }
    });

    if (existingVendor) {
      res.status(400).json({ message: 'A vendor profile with this business name already exists' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Create vendor profile
    const vendor = await prisma.vendor.create({
      data: {
        userId: req.userId!,
        businessName,
        description,
        contactEmail,
        contactPhone,
        website,
        category,
        isVerified: false // Pending verification
      }
    });

    res.status(201).json({
      message: 'Vendor profile created successfully',
      vendor
    });
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return; // Explicitly return to satisfy TypeScript
  }
};

// Get vendor profiles for the current user
export const getUserVendorProfiles = async (req: AuthRequest, res: Response) => {
  try {
    const vendors = await prisma.vendor.findMany({
      where: {
        userId: req.userId!
      },
      include: {
        applications: {
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
            vendorType: {
              select: {
                id: true,
                name: true
              }
            }
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

// Update vendor profile
export const updateVendorProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { businessName, description, contactEmail, contactPhone, website, category } = req.body;

    // Check if vendor exists and belongs to the user
    const existingVendor = await prisma.vendor.findFirst({
      where: {
        id: Number(id),
        userId: req.userId!
      }
    });

    if (!existingVendor) {
      res.status(404).json({ message: 'Vendor profile not found or you do not have permission to update it' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Update vendor profile
    const vendor = await prisma.vendor.update({
      where: { id: Number(id) },
      data: {
        businessName,
        description,
        contactEmail,
        contactPhone,
        website,
        category
      }
    });

    res.json({
      message: 'Vendor profile updated successfully',
      vendor
    });
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return; // Explicitly return to satisfy TypeScript
  }
};

// Delete vendor profile
export const deleteVendorProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;

    // Check if vendor exists and belongs to the user
    const existingVendor = await prisma.vendor.findFirst({
      where: {
        id: Number(id),
        userId: req.userId!
      }
    });

    if (!existingVendor) {
      res.status(404).json({ message: 'Vendor profile not found or you do not have permission to delete it' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Check if vendor has any applications (can't delete if they do)
    const applicationCount = await prisma.vendorApplication.count({
      where: {
        vendorId: Number(id)
      }
    });

    if (applicationCount > 0) {
      res.status(400).json({ message: 'Cannot delete vendor profile with existing applications' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Delete vendor profile
    await prisma.vendor.delete({
      where: { id: Number(id) }
    });

    res.json({ message: 'Vendor profile deleted successfully' });
    return; // Explicitly return to satisfy TypeScript
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return; // Explicitly return to satisfy TypeScript
  }
};