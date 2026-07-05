import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';

// Helper to get organizer's organization ID
async function getOrgId(userId: number): Promise<number | null> {
  const org = await prisma.organization.findFirst({ where: { ownerId: userId } });
  return org?.id ?? null;
}

/**
 * Get organization balance ledger and payout history
 */
export const getBalanceLedger = async (req: AuthRequest, res: Response) => {
  try {
    const orgId = await getOrgId(req.userId!);
    if (!orgId) {
      return res.status(404).json({ message: 'No organization profile found for this account.' });
    }

    // Fetch the organization details
    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: {
        id: true,
        name: true,
        payoutBankName: true,
        payoutAccountNumber: true,
        payoutAccountName: true,
        payoutSchedule: true,
      }
    });

    if (!organization) {
      return res.status(404).json({ message: 'Organization profile not found.' });
    }

    // Fetch all events for this organization
    const events = await prisma.event.findMany({
      where: { organizationId: orgId },
      select: { id: true }
    });
    const eventIds = events.map(e => e.id);

    // Sum of netAmount from PAID ONLINE orders and vendor applications for these events
    let totalEarnings = 0;
    if (eventIds.length > 0) {
      const [salesAggregate, vendorAggregate] = await Promise.all([
        prisma.order.aggregate({
          where: {
            eventId: { in: eventIds },
            status: 'PAID',
            purchaseType: 'ONLINE' // CASH sales are pocketed directly at the gate
          },
          _sum: {
            netAmount: true
          }
        }),
        prisma.vendorApplication.aggregate({
          where: {
            eventId: { in: eventIds },
            paymentStatus: 'PAID'
          },
          _sum: {
            netAmount: true
          }
        })
      ]);
      totalEarnings = (salesAggregate?._sum?.netAmount ?? 0) + (vendorAggregate?._sum?.netAmount ?? 0);
    }

    // Get completed payouts (status: PAID)
    const completedPayoutsAggregate = await prisma.payout.aggregate({
      where: {
        organizationId: orgId,
        status: 'PAID'
      },
      _sum: {
        amount: true
      }
    });
    const totalPaidOut = completedPayoutsAggregate?._sum?.amount ?? 0;

    // Get pending payouts (status: PENDING)
    const pendingPayoutsAggregate = await prisma.payout.aggregate({
      where: {
        organizationId: orgId,
        status: 'PENDING'
      },
      _sum: {
        amount: true
      }
    });
    const totalPending = pendingPayoutsAggregate?._sum?.amount ?? 0;

    const availableBalance = Math.max(0, totalEarnings - totalPaidOut - totalPending);

    // Get all payouts history logs
    const payouts = await prisma.payout.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({
      totalEarnings,
      totalPaidOut,
      totalPending,
      availableBalance,
      payouts,
      bankSettings: {
        payoutBankName: organization.payoutBankName,
        payoutAccountNumber: organization.payoutAccountNumber,
        payoutAccountName: organization.payoutAccountName,
        payoutSchedule: organization.payoutSchedule,
      }
    });
  } catch (error) {
    console.error('[Finance] getBalanceLedger error:', error);
    return res.status(500).json({ message: 'Server error loading ledger.' });
  }
};

/**
 * Submit a withdrawal request
 */
export const requestPayout = async (req: AuthRequest, res: Response) => {
  try {
    const { amount } = req.body;
    const payoutAmount = parseFloat(amount);

    if (isNaN(payoutAmount) || payoutAmount <= 0) {
      return res.status(400).json({ message: 'A valid payout amount is required.' });
    }

    const orgId = await getOrgId(req.userId!);
    if (!orgId) {
      return res.status(404).json({ message: 'No organization profile found for this account.' });
    }

    // Verify organization has configured bank details
    const organization = await prisma.organization.findUnique({
      where: { id: orgId }
    });

    if (!organization || !organization.payoutBankName || !organization.payoutAccountNumber || !organization.payoutAccountName) {
      return res.status(400).json({ message: 'Please update your bank payout settings before requesting withdrawals.' });
    }

    // Verify available balance
    const events = await prisma.event.findMany({
      where: { organizationId: orgId },
      select: { id: true }
    });
    const eventIds = events.map(e => e.id);

    let totalEarnings = 0;
    if (eventIds.length > 0) {
      const [salesAggregate, vendorAggregate] = await Promise.all([
        prisma.order.aggregate({
          where: {
            eventId: { in: eventIds },
            status: 'PAID',
            purchaseType: 'ONLINE'
          },
          _sum: {
            netAmount: true
          }
        }),
        prisma.vendorApplication.aggregate({
          where: {
            eventId: { in: eventIds },
            paymentStatus: 'PAID'
          },
          _sum: {
            netAmount: true
          }
        })
      ]);
      totalEarnings = (salesAggregate?._sum?.netAmount ?? 0) + (vendorAggregate?._sum?.netAmount ?? 0);
    }

    const completedPayoutsAggregate = await prisma.payout.aggregate({
      where: { organizationId: orgId, status: 'PAID' },
      _sum: { amount: true }
    });
    const totalPaidOut = completedPayoutsAggregate?._sum?.amount ?? 0;

    const pendingPayoutsAggregate = await prisma.payout.aggregate({
      where: { organizationId: orgId, status: 'PENDING' },
      _sum: { amount: true }
    });
    const totalPending = pendingPayoutsAggregate?._sum?.amount ?? 0;

    const availableBalance = Math.max(0, totalEarnings - totalPaidOut - totalPending);

    if (payoutAmount > availableBalance) {
      return res.status(400).json({ message: `Insufficient funds. Your available balance is ₦${availableBalance.toLocaleString()}` });
    }

    // Generate random payout reference
    const reference = `PAY-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;

    // Create the payout request snapshotting active bank details
    const payout = await prisma.payout.create({
      data: {
        organizationId: orgId,
        amount: payoutAmount,
        status: 'PENDING',
        reference,
        bankName: organization.payoutBankName,
        accountNumber: organization.payoutAccountNumber,
        accountName: organization.payoutAccountName,
      }
    });

    return res.status(201).json({
      message: 'Withdrawal request submitted successfully.',
      payout
    });
  } catch (error) {
    console.error('[Finance] requestPayout error:', error);
    return res.status(500).json({ message: 'Server error processing payout request.' });
  }
};
