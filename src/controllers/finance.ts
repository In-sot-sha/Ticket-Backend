import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { loadPaystackSettlementSnapshot } from '../services/paystack';

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
        absorbFee: true,
        paystackSubaccountCode: true,
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

    // Sum of netAmount / fees from PAID ONLINE orders and vendor applications
    let totalEarnings = 0;
    let grossSales = 0;
    let platformFees = 0;
    let processingFees = 0;
    if (eventIds.length > 0) {
      const [salesAggregate, vendorAggregate] = await Promise.all([
        prisma.order.aggregate({
          where: {
            eventId: { in: eventIds },
            status: 'PAID',
            purchaseType: 'ONLINE'
          },
          _sum: {
            netAmount: true,
            totalAmount: true,
            platformFee: true,
            processingFee: true,
            chargeAmount: true,
          }
        }),
        prisma.vendorApplication.aggregate({
          where: {
            eventId: { in: eventIds },
            paymentStatus: 'PAID'
          },
          _sum: {
            netAmount: true,
            paymentAmount: true,
            platformFee: true,
            processingFee: true,
          }
        })
      ]);
      totalEarnings = (salesAggregate?._sum?.netAmount ?? 0) + (vendorAggregate?._sum?.netAmount ?? 0);
      grossSales =
        (salesAggregate?._sum?.totalAmount ?? 0) +
        (vendorAggregate?._sum?.paymentAmount ?? 0);
      platformFees =
        (salesAggregate?._sum?.platformFee ?? 0) +
        (vendorAggregate?._sum?.platformFee ?? 0);
      processingFees =
        (salesAggregate?._sum?.processingFee ?? 0) +
        (vendorAggregate?._sum?.processingFee ?? 0);
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

    const hasSubaccount = Boolean(organization.paystackSubaccountCode);
    // Split sales already settle to the organizer bank. The ledger balance is only for
    // money still held on the platform, which is none once a subaccount is connected.
    const availableBalance = hasSubaccount
      ? 0
      : Math.max(0, totalEarnings - totalPaidOut - totalPending);
    const settlementMode = hasSubaccount
      ? 'PAYSTACK_SPLIT'
      : 'PLATFORM_LEDGER';

    // Get all payouts history logs
    const payouts = await prisma.payout.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' }
    });

    return res.json({
      totalEarnings,
      grossSales,
      platformFees,
      processingFees,
      totalPaidOut,
      totalPending,
      availableBalance,
      settlementMode,
      payouts,
      bankSettings: {
        payoutBankName: organization.payoutBankName,
        payoutAccountNumber: organization.payoutAccountNumber,
        payoutAccountName: organization.payoutAccountName,
        payoutSchedule: organization.payoutSchedule,
        absorbFee: organization.absorbFee,
        paystackConnected: hasSubaccount,
      }
    });
  } catch (error) {
    console.error('[Finance] getBalanceLedger error:', error);
    return res.status(500).json({ message: 'Server error loading ledger.' });
  }
};

/**
 * Paystack bank payouts for this organizer only.
 */
export const getOrganizerPayouts = async (req: AuthRequest, res: Response) => {
  try {
    const orgId = await getOrgId(req.userId!);
    if (!orgId) {
      return res.status(404).json({ message: 'No organization profile found for this account.' });
    }

    const organization = await prisma.organization.findUnique({
      where: { id: orgId },
      select: { paystackSubaccountCode: true },
    });
    if (!organization) {
      return res.status(404).json({ message: 'Organization profile not found.' });
    }

    const [orders, vendors] = await Promise.all([
      prisma.order.findMany({
        where: {
          status: 'PAID',
          paymentReference: { not: null },
          event: { organizationId: orgId },
        },
        select: { paymentReference: true, netAmount: true },
      }),
      prisma.vendorApplication.findMany({
        where: {
          paymentStatus: 'PAID',
          paymentReference: { not: null },
          event: { organizationId: orgId },
        },
        select: { paymentReference: true, netAmount: true },
      }),
    ]);

    const netByReference = new Map<string, number>();
    for (const row of [...orders, ...vendors]) {
      if (!row.paymentReference) continue;
      netByReference.set(row.paymentReference, (netByReference.get(row.paymentReference) || 0) + (row.netAmount || 0));
    }

    const snapshot = await loadPaystackSettlementSnapshot();
    const code = organization.paystackSubaccountCode;
    const payouts = snapshot.settlements
      .map((settlement) => {
        const matched = settlement.references.filter((reference) => netByReference.has(reference));
        const ownsSettlement = Boolean(code && settlement.subaccountCode === code);
        if (!ownsSettlement && matched.length === 0) return null;
        const amount = ownsSettlement
          ? settlement.amount
          : matched.reduce((sum, reference) => sum + (netByReference.get(reference) || 0), 0);
        return {
          id: settlement.id,
          status: settlement.status,
          amount,
          settlementDate: settlement.settlementDate,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const byReference: typeof snapshot.byReference = {};
    for (const reference of netByReference.keys()) {
      const hit = snapshot.byReference[reference];
      if (hit) byReference[reference] = hit;
    }

    return res.json({
      configured: snapshot.configured,
      payouts,
      byReference,
    });
  } catch (error) {
    console.error('[Finance] getOrganizerPayouts error:', error);
    return res.status(500).json({ message: 'Could not load payouts' });
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

    if (organization.paystackSubaccountCode) {
      return res.status(400).json({
        message: 'Ticket sales settle to your bank automatically. A separate withdrawal is not needed.',
      });
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
