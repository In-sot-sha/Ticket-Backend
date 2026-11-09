import { Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import { loadPaystackSettlementSnapshot, loadPaystackSubaccountSettlements } from '../services/paystack';

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

    // Sum of netAmount / fees from PAID ONLINE & ASSISTED orders and vendor applications
    let totalEarnings = 0;
    let grossSales = 0;
    let platformFees = 0;
    let processingFees = 0;
    let breakdown = {
      online: { gross: 0, platformFee: 0, netAmount: 0, ordersCount: 0 },
      assisted: { gross: 0, partyStormCut: 0, netAmount: 0, discountAmount: 0, ordersCount: 0 },
    };

    if (eventIds.length > 0) {
      const [onlineSalesAggregate, assistedSalesAggregate, vendorAggregate] = await Promise.all([
        prisma.order.aggregate({
          where: {
            eventId: { in: eventIds },
            status: 'PAID',
            purchaseType: 'ONLINE',
          },
          _sum: {
            netAmount: true,
            totalAmount: true,
            platformFee: true,
            processingFee: true,
            chargeAmount: true,
            discountAmount: true,
          },
          _count: { id: true },
        }),
        prisma.order.aggregate({
          where: {
            eventId: { in: eventIds },
            status: 'PAID',
            purchaseType: 'ASSISTED',
          },
          _sum: {
            netAmount: true,
            totalAmount: true,
            platformFee: true,
            processingFee: true,
            chargeAmount: true,
            discountAmount: true,
          },
          _count: { id: true },
        }),
        prisma.vendorApplication.aggregate({
          where: {
            eventId: { in: eventIds },
            paymentStatus: 'PAID',
          },
          _sum: {
            netAmount: true,
            paymentAmount: true,
            platformFee: true,
            processingFee: true,
          },
          _count: { id: true },
        }),
      ]);

      const onlineGross = onlineSalesAggregate?._sum?.totalAmount ?? 0;
      const onlineFee = onlineSalesAggregate?._sum?.platformFee ?? 0;
      const onlineNet = onlineSalesAggregate?._sum?.netAmount ?? 0;

      const assistedGross = assistedSalesAggregate?._sum?.totalAmount ?? 0;
      const assistedCut = assistedSalesAggregate?._sum?.platformFee ?? 0;
      const assistedNet = assistedSalesAggregate?._sum?.netAmount ?? 0;
      const assistedDiscount = assistedSalesAggregate?._sum?.discountAmount ?? 0;

      totalEarnings = onlineNet + assistedNet + (vendorAggregate?._sum?.netAmount ?? 0);
      grossSales = onlineGross + assistedGross + (vendorAggregate?._sum?.paymentAmount ?? 0);
      platformFees = onlineFee + assistedCut + (vendorAggregate?._sum?.platformFee ?? 0);
      processingFees =
        (onlineSalesAggregate?._sum?.processingFee ?? 0) +
        (vendorAggregate?._sum?.processingFee ?? 0);

      breakdown = {
        online: {
          gross: onlineGross,
          platformFee: onlineFee,
          netAmount: onlineNet,
          ordersCount: onlineSalesAggregate?._count?.id ?? 0,
        },
        assisted: {
          gross: assistedGross,
          partyStormCut: assistedCut,
          netAmount: assistedNet,
          discountAmount: assistedDiscount,
          ordersCount: assistedSalesAggregate?._count?.id ?? 0,
        },
      };
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
    // Split sales already settle to the organizer bank via Paystack T+1.
    // For assisted sales (or orgs without Paystack subaccounts), funds held on platform ledger
    // are available for settlement.
    const assistedNetEarnings = breakdown.assisted.netAmount;
    const availableBalance = hasSubaccount
      ? Math.max(0, assistedNetEarnings - totalPaidOut - totalPending)
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
      breakdown,
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

function nextBusinessDay(date: Date): Date {
  let cursor = new Date(date);
  for (let i = 0; i < 8; i += 1) {
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) return cursor;
  }
  return cursor;
}

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
      select: {
        paystackSubaccountCode: true,
        payoutBankName: true,
        payoutAccountNumber: true,
        payoutAccountName: true,
      },
    });
    if (!organization) {
      return res.status(404).json({ message: 'Organization profile not found.' });
    }

    const [orders, vendors, dbPayouts] = await Promise.all([
      prisma.order.findMany({
        where: {
          status: 'PAID',
          event: { organizationId: orgId },
        },
        select: {
          id: true,
          paymentReference: true,
          totalAmount: true,
          netAmount: true,
          purchaseType: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.vendorApplication.findMany({
        where: {
          paymentStatus: 'PAID',
          event: { organizationId: orgId },
        },
        select: {
          id: true,
          paymentReference: true,
          paymentAmount: true,
          netAmount: true,
          appliedAt: true,
        },
        orderBy: { appliedAt: 'desc' },
      }),
      prisma.payout.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const byReference: Record<string, { status: string; settlementDate: string | null }> = {};
    const batchMap = new Map<string, { settleDate: Date; amount: number }>();
    const now = Date.now();

    for (const o of orders) {
      const net = o.netAmount > 0 ? o.netAmount : o.totalAmount;
      if (net <= 0) continue;
      const settleDate = nextBusinessDay(o.createdAt);
      const isPast = settleDate.getTime() <= now;
      const status = isPast ? 'success' : 'pending';

      if (o.paymentReference) {
        byReference[o.paymentReference] = {
          status,
          settlementDate: settleDate.toISOString(),
        };
      }

      // Group online orders into daily settlement batches for the bank
      if (o.purchaseType === 'ONLINE') {
        const dayKey = settleDate.toISOString().slice(0, 10);
        const existing = batchMap.get(dayKey) || { settleDate, amount: 0 };
        existing.amount += net;
        batchMap.set(dayKey, existing);
      }
    }

    for (const v of vendors) {
      const net = (v.netAmount ?? 0) > 0 ? v.netAmount! : (v.paymentAmount ?? 0);
      if (net <= 0) continue;
      const settleDate = nextBusinessDay(v.appliedAt);
      const isPast = settleDate.getTime() <= now;
      const status = isPast ? 'success' : 'pending';

      if (v.paymentReference) {
        byReference[v.paymentReference] = {
          status,
          settlementDate: settleDate.toISOString(),
        };
      }

      const dayKey = settleDate.toISOString().slice(0, 10);
      const existing = batchMap.get(dayKey) || { settleDate, amount: 0 };
      existing.amount += net;
      batchMap.set(dayKey, existing);
    }

    // Try fetching Paystack subaccount settlements if code exists
    let paystackPayouts: any[] = [];
    if (organization.paystackSubaccountCode) {
      try {
        const snapshot = await loadPaystackSubaccountSettlements(organization.paystackSubaccountCode);
        if (snapshot.settlements && snapshot.settlements.length > 0) {
          paystackPayouts = snapshot.settlements
            .filter((s: any) => !s.subaccountCode || s.subaccountCode === organization.paystackSubaccountCode)
            .map((s: any) => ({
              id: `paystack-${s.id}`,
              status: s.status,
              amount: s.amount,
              settlementDate: s.settlementDate,
            }));
          if (snapshot.byReference) {
            Object.assign(byReference, snapshot.byReference);
          }
        }
      } catch (err) {
        console.error('[Finance] Paystack settlements fetch error:', err);
      }
    }

    // Daily batch payouts from online ticket/vendor sales
    const dailyBatchPayouts = Array.from(batchMap.entries()).map(([dayKey, batch]) => ({
      id: `batch-${dayKey}`,
      status: batch.settleDate.getTime() <= now ? 'success' : 'pending',
      amount: batch.amount,
      settlementDate: batch.settleDate.toISOString(),
    }));

    // Manual or requested payouts logged in database
    const mappedDbPayouts = dbPayouts.map((p) => ({
      id: `payout-${p.id}`,
      status: p.status === 'PAID' ? 'success' : p.status === 'REFUNDED' ? 'failed' : 'pending',
      amount: p.amount,
      settlementDate: (p.status === 'PAID' ? p.updatedAt : p.createdAt).toISOString(),
    }));

    // Combine payouts and order by settlementDate descending
    const autoPayouts = paystackPayouts.length > 0 ? paystackPayouts : dailyBatchPayouts;
    const allPayouts = [...autoPayouts, ...mappedDbPayouts];
    allPayouts.sort(
      (a, b) =>
        new Date(b.settlementDate || 0).getTime() - new Date(a.settlementDate || 0).getTime()
    );

    return res.json({
      configured: Boolean(process.env.PAYSTACK_SECRET_KEY),
      payouts: allPayouts,
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
            purchaseType: { in: ['ONLINE', 'ASSISTED'] }
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
