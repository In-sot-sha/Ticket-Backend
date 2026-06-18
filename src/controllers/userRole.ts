import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { uploadOrgLogoImage } from '../utils/imageUpload';

// Request to become an organizer (or resubmit after rejection)
export const becomeOrganizer = async (req: AuthRequest, res: Response) => {
  try {
    const { businessName, description, contactInfo, logo, socials } = req.body;

    const existingOrg = await prisma.organization.findFirst({
      where: { ownerId: req.userId! },
    });

    if (existingOrg?.isVerified) {
      return res.status(400).json({ message: 'You already have a verified organization' });
    }

    if (existingOrg && !existingOrg.rejectedAt) {
      return res.status(400).json({ message: 'Your application is already pending review' });
    }

    let organization;

    if (existingOrg) {
      organization = await prisma.organization.update({
        where: { id: existingOrg.id },
        data: {
          name: businessName,
          description,
          website: contactInfo,
          logo: logo || existingOrg.logo,
          socials,
          isVerified: false,
          rejectionReason: null,
          rejectedAt: null,
        },
      });
    } else {
      organization = await prisma.organization.create({
        data: {
          name: businessName,
          description,
          website: contactInfo,
          logo,
          socials,
          ownerId: req.userId!,
          isVerified: false,
        },
      });

      await prisma.organizationMember.create({
        data: {
          userId: req.userId!,
          organizationId: organization.id,
          role: 'admin',
        },
      });
    }

    const user = await prisma.user.update({
      where: { id: Number(req.userId) },
      data: { role: 'ORGANIZER' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        ownedOrganizations: true,
      },
    });

    return res.status(200).json({
      message: existingOrg ? 'Application resubmitted successfully' : 'Successfully became an organizer',
      user,
      organization,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Server error during organizer request' });
  }
};

export const uploadOrgLogo = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file provided' });
    }

    const url = await uploadOrgLogoImage(req.file, req);
    return res.json({ message: 'Logo uploaded successfully', url });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: 'Failed to upload logo' });
  }
};

// Request to become a vendor (this creates a vendor profile, different from applying to events)
export const becomeVendor = async (req: AuthRequest, res: Response) => {
  try {
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
    const { 
      organizationId, 
      businessName, 
      description, 
      contactInfo, 
      logo, 
      socials,
      payoutBankName,
      payoutAccountNumber,
      payoutAccountName,
      payoutSchedule,
      taxId,
      vatNumber,
      businessAddress
    } = req.body;

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
        logo: logo !== undefined ? logo : organization.logo,
        socials: socials !== undefined ? socials : organization.socials,
        payoutBankName: payoutBankName !== undefined ? payoutBankName : organization.payoutBankName,
        payoutAccountNumber: payoutAccountNumber !== undefined ? payoutAccountNumber : organization.payoutAccountNumber,
        payoutAccountName: payoutAccountName !== undefined ? payoutAccountName : organization.payoutAccountName,
        payoutSchedule: payoutSchedule !== undefined ? payoutSchedule : organization.payoutSchedule,
        taxId: taxId !== undefined ? taxId : organization.taxId,
        vatNumber: vatNumber !== undefined ? vatNumber : organization.vatNumber,
        businessAddress: businessAddress !== undefined ? businessAddress : organization.businessAddress
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
