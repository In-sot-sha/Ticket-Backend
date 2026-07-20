import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';

// Register a vendor for an event
// No separate vendorId required — uses userId + inline snapshot fields
export const registerVendor = async (req: AuthRequest, res: Response) => {
  try {
    const {
      eventId,
      vendorTypeId,
      vendorType,
      paymentAmount,
      paymentReference,
      // Inline snapshot fields
      businessName,
      businessEmail,
      businessPhone,
      description,
      category,
      staffCount,
    } = req.body;

    if (!req.userId) {
      res.status(401).json({ message: 'Authentication required' });
      return;
    }

    // Check if event allows vendors
    const event = await prisma.event.findUnique({
      where: { id: Number(eventId) },
      include: { organization: true }
    });

    if (!event || !event.allowVendors) {
      res.status(400).json({ message: 'This event does not allow vendor registration' });
      return;
    }

    // Check if vendor deadline has passed
    if (event.vendorDeadline && new Date() > new Date(event.vendorDeadline)) {
      res.status(400).json({ message: 'Vendor registration deadline has passed' });
      return;
    }

    // Resolve vendor type
    let vendorTypeDetails: any = null;
    if (vendorTypeId) {
      vendorTypeDetails = await prisma.vendorType.findUnique({ where: { id: Number(vendorTypeId) } });
      if (!vendorTypeDetails || vendorTypeDetails.eventId !== Number(eventId)) {
        res.status(400).json({ message: 'Invalid vendor type for this event' });
        return;
      }
    } else if (vendorType) {
      vendorTypeDetails = await prisma.vendorType.findFirst({ where: { eventId: Number(eventId), name: vendorType } });
      if (!vendorTypeDetails) {
        res.status(400).json({ message: `No vendor type found with name: ${vendorType}` });
        return;
      }
    } else {
      vendorTypeDetails = await prisma.vendorType.findFirst({ where: { eventId: Number(eventId) } });
      if (!vendorTypeDetails) {
        res.status(400).json({ message: 'No vendor types available for this event' });
        return;
      }
    }

    // Check capacity
    const currentVendorsCount = await prisma.vendorApplication.count({
      where: { vendorTypeId: vendorTypeDetails.id, applicationStatus: 'APPROVED' }
    });
    if (vendorTypeDetails.maxVendors !== null && currentVendorsCount >= vendorTypeDetails.maxVendors) {
      res.status(400).json({ message: `Maximum vendor capacity reached for ${vendorTypeDetails.name} vendors` });
      return;
    }

    // Check duplicate application for this user/event/stallType
    const existingApplication = await prisma.vendorApplication.findFirst({
      where: { userId: req.userId, eventId: Number(eventId), vendorTypeId: vendorTypeDetails.id }
    });

    if (existingApplication) {
      res.status(400).json({ message: 'You have already applied for this vendor type at this event' });
      return;
    }

    // Look up user's saved Vendor business card (optional — for email + vendorId reference)
    const savedVendorCard = await prisma.vendor.findFirst({ where: { userId: req.userId! } });

    // Calculate service charge (platform fee), processing fee, and net amount
    const serviceFeePercent = event.organization?.serviceFeePercent ?? 5.0;
    const absorbFee = event.organization?.absorbFee ?? false;
    const baseFee = vendorTypeDetails!.fee || 0;

    const platformFee = baseFee > 0 ? Math.round(baseFee * (serviceFeePercent / 100)) : 0;
    const processingFee = baseFee > 0 ? Math.round((baseFee * 0.015) + 100) : 0;

    // Vendor pays booth fee + service fee if not absorbed
    const calculatedPaymentAmount = absorbFee ? baseFee : (baseFee + platformFee);
    const netAmount = absorbFee
      ? Math.max(0, baseFee - platformFee - processingFee)
      : Math.max(0, baseFee - processingFee);

    // Determine initial status based on event auto-approval settings
    const initialStatus = (event as any).vendorApprovalMode === 'auto' ? 'APPROVED' : 'PENDING';

    // Create vendor application with snapshot of business details
    const vendorApplication = await prisma.vendorApplication.create({
      data: {
        userId: req.userId!,
        eventId: Number(eventId),
        vendorTypeId: vendorTypeDetails!.id,
        vendorId: savedVendorCard ? savedVendorCard.id : null,
        // Snapshot fields — editable per event, stored independently
        businessName: businessName || savedVendorCard?.businessName || null,
        businessEmail: businessEmail || savedVendorCard?.contactEmail || null,
        businessPhone: businessPhone || savedVendorCard?.contactPhone || null,
        description: description || savedVendorCard?.description || null,
        category: category || savedVendorCard?.category || null,
        staffCount: staffCount || null,
        applicationStatus: initialStatus as any,
        paymentAmount: paymentAmount || calculatedPaymentAmount,
        paymentReference: paymentReference || null,
        paymentStatus: paymentReference ? 'PAID' : (calculatedPaymentAmount === 0 ? 'PAID' : 'PENDING'),
        platformFee,
        processingFee,
        netAmount,
      }
    });

    // Send application confirmation email
    try {
      const user = await prisma.user.findUnique({ where: { id: req.userId! } });
      if (user?.email) {
        const { generateVendorApplicationEmail, sendEmail } = await import('../services/email');
        const emailContent = generateVendorApplicationEmail(user.email, {
          eventTitle: event.title,
          businessName: businessName || savedVendorCard?.businessName || 'Your Business',
          stallType: vendorTypeDetails!.name || 'General Stall',
        });
        await sendEmail({ to: user.email, subject: emailContent.subject, html: emailContent.html, text: emailContent.text });
      }
    } catch (err) {
      console.error('Failed to send vendor application email:', err);
    }

    res.status(201).json({ message: 'Vendor application submitted successfully', vendorApplication });
    return;
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return;
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

    if (applicationStatus) {
      const statusString = String(applicationStatus).toUpperCase();
      if (['PENDING', 'APPROVED', 'REJECTED'].includes(statusString)) {
        whereClause.applicationStatus = statusString;
      }
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
        event: { select: { id: true, title: true, startDate: true } },
        vendorType: { select: { id: true, name: true, fee: true } },
        vendor: { select: { id: true, businessName: true, description: true, contactEmail: true } },
        user: { select: { id: true, firstName: true, lastName: true, email: true } }
      },
      orderBy: { appliedAt: 'desc' }
    });

    res.json(vendorApplications);
    return;
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return;
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
    const { applicationStatus, paymentStatus, stallNumber } = req.body;

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
    const isOrgOwner = vendorApplication.event?.organization?.ownerId === req.userId;
    const isOrgMember = vendorApplication.event?.organization?.members.some(member => member.userId === req.userId);
    
    if (!isOrgOwner && !isOrgMember) {
      res.status(403).json({ message: 'You do not have permission to update this vendor application status' });
      return; // Explicitly return to satisfy TypeScript
    }

    // Update vendor application status
    const updatedApplication = await prisma.vendorApplication.update({
      where: { id: Number(id) },
      data: {
        applicationStatus,
        paymentStatus: paymentStatus !== undefined ? paymentStatus : vendorApplication.paymentStatus,
        ...(stallNumber !== undefined && {
          stallNumber: stallNumber === null || stallNumber === '' ? null : String(stallNumber).trim(),
        }),
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

// Get the current user's vendor business card (their single profile)
export const getMyVendorProfile = async (req: AuthRequest, res: Response) => {
  try {
    const vendor = await prisma.vendor.findFirst({
      where: { userId: req.userId! }
    });
    // Return null if not set yet — frontend will show empty form
    res.json(vendor || null);
    return;
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return;
  }
};

// Save or update the user's vendor business card (upsert — one per user)
export const createVendorProfile = async (req: AuthRequest, res: Response) => {
  try {
    const { businessName, description, contactEmail, contactPhone, website, category } = req.body;

    if (!businessName || !contactEmail) {
      res.status(400).json({ message: 'Business name and contact email are required' });
      return;
    }

    // Upsert — user can only have one business card
    const existing = await prisma.vendor.findFirst({ where: { userId: req.userId! } });

    const vendor = existing
      ? await prisma.vendor.update({
          where: { id: existing.id },
          data: { businessName, description, contactEmail, contactPhone, website, category }
        })
      : await prisma.vendor.create({
          data: { userId: req.userId!, businessName, description, contactEmail, contactPhone, website, category, isVerified: false }
        });

    res.status(existing ? 200 : 201).json({
      message: existing ? 'Vendor profile updated' : 'Vendor profile created',
      vendor
    });
    return;
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
    return;
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