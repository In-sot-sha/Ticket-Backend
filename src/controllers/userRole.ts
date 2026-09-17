import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../prisma';
import { uploadOrgLogoImage } from '../utils/imageUpload';
import {
  sendEmail,
  getAdminNotifyEmail,
  generateHostApplicationReceivedEmail,
  generateHostApplicationAdminNoticeEmail,
} from '../services/email';

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

    if (user.email) {
      const received = generateHostApplicationReceivedEmail({
        firstName: user.firstName,
        organizationName: organization.name,
      });
      void sendEmail({
        to: user.email,
        subject: received.subject,
        html: received.html,
        text: received.text,
      }).catch((err) => console.error('[Host] Applicant confirmation email failed:', err));
    }

    const adminTo = getAdminNotifyEmail();
    if (adminTo) {
      const notice = generateHostApplicationAdminNoticeEmail({
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email || 'no-email',
        organizationName: organization.name,
        description,
        contactInfo,
      });
      void sendEmail({
        to: adminTo,
        subject: notice.subject,
        html: notice.html,
        text: notice.text,
      }).catch((err) => console.error('[Host] Admin notice email failed:', err));
    }

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
      businessAddress,
      absorbFee,
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
        businessAddress: businessAddress !== undefined ? businessAddress : organization.businessAddress,
        ...(typeof absorbFee === 'boolean' ? { absorbFee } : {}),
      }
    });

    // Best-effort: create/update Paystack subaccount when bank details present
    try {
      const { syncOrganizationSubaccount } = await import('./paystackPayment');
      await syncOrganizationSubaccount(updatedOrg.id);
    } catch (err) {
      console.warn('[Organizer Profile] Subaccount sync skipped:', err);
    }

    const refreshed = await prisma.organization.findUnique({ where: { id: updatedOrg.id } });

    return res.json({
      message: 'Organizer profile updated successfully',
      organization: refreshed || updatedOrg
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

// Fetch supported banks from Paystack (with local fallback)
export const getBanks = async (req: AuthRequest, res: Response) => {
  try {
    const { listPaystackBanks } = await import('../services/paystack');
    let banks: Array<{ name: string; code: string }> = [];
    try {
      banks = await listPaystackBanks('NGN');
    } catch (e) {
      console.warn('[GetBanks] Paystack bank list fetch fallback:', e);
    }

    if (!banks || banks.length === 0) {
      banks = [
        { name: 'Access Bank', code: '044' },
        { name: 'Access Bank (Diamond)', code: '063' },
        { name: 'ALAT by WEMA', code: '035A' },
        { name: 'First Bank of Nigeria', code: '011' },
        { name: 'First City Monument Bank (FCMB)', code: '214' },
        { name: 'Guaranty Trust Bank (GTBank)', code: '058' },
        { name: 'Kuda Bank', code: '50211' },
        { name: 'Moniepoint MFB', code: '50515' },
        { name: 'OPay Digital Services', code: '999992' },
        { name: 'PalmPay', code: '999991' },
        { name: 'Polaris Bank', code: '076' },
        { name: 'Stanbic IBTC Bank', code: '221' },
        { name: 'Sterling Bank', code: '232' },
        { name: 'Union Bank of Nigeria', code: '032' },
        { name: 'United Bank for Africa (UBA)', code: '033' },
        { name: 'Wema Bank', code: '035' },
        { name: 'Zenith Bank', code: '057' },
      ];
    }

    return res.json({ banks });
  } catch (error) {
    console.error('[GetBanks] Error:', error);
    return res.status(500).json({ message: 'Failed to fetch banks' });
  }
};

