import { Request, Response } from 'express';
import { prisma } from '../prisma';
import { AuthRequest } from '../middleware/auth';
import {
  createOrUpdatePaystackSubaccount,
  initializePaystackTransaction,
  makePaymentReference,
  paystackPublicKey,
  resolveBankCode,
  verifyPaystackTransaction,
  verifyPaystackWebhookSignature,
} from '../services/paystack';
import {
  buildFeesForTicketCart,
  buildFeesForVendor,
  fulfillTicketCheckout,
  fulfillVendorCheckout,
  normalizeTicketItems,
  TicketCheckoutPayload,
  VendorCheckoutPayload,
} from '../services/checkoutFulfillment';
import { paystackTransactionSplit } from '../constants/fees';
import { isValidEmail, normalizePhone } from '../utils/validation';
import { assertTicketSalesOpen } from '../services/ticketSales';
import { assertMaxPerPerson, getMaxPerPerson } from '../services/guestUser';

async function fulfillPaymentIntent(reference: string, paystackStatus?: string) {
  const intent = await prisma.paymentIntent.findUnique({ where: { reference } });
  if (!intent) {
    throw Object.assign(new Error('Payment intent not found'), { status: 404 });
  }

  if (intent.status === 'FULFILLED') {
    if (intent.kind === 'TICKET' && intent.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: intent.orderId },
        include: { tickets: { include: { event: true, ticketType: true } }, user: true },
      });
      return { intent, result: { order, tickets: order?.tickets || [], user: order?.user }, reused: true };
    }
    if (intent.kind === 'VENDOR') {
      const vendorApplication = await prisma.vendorApplication.findFirst({
        where: { paymentReference: reference },
      });
      return { intent, result: { vendorApplication }, reused: true };
    }
    return { intent, result: null, reused: true };
  }

  const fees = {
    subtotal: intent.subtotal,
    platformFee: intent.platformFee,
    processingFee: intent.processingFee,
    netAmount: intent.netAmount,
    chargeAmount: intent.chargeAmount,
  };
  const payload = JSON.parse(intent.payload);

  let result: any;
  if (intent.kind === 'TICKET') {
    result = await fulfillTicketCheckout({
      payload: payload as TicketCheckoutPayload,
      paymentReference: reference,
      fees,
    });
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'FULFILLED',
        fulfilledAt: new Date(),
        orderId: result.order?.id ?? null,
        paystackStatus: paystackStatus || intent.paystackStatus,
      },
    });
  } else if (intent.kind === 'VENDOR') {
    result = await fulfillVendorCheckout({
      payload: payload as VendorCheckoutPayload,
      paymentReference: reference,
      fees,
    });
    await prisma.paymentIntent.update({
      where: { id: intent.id },
      data: {
        status: 'FULFILLED',
        fulfilledAt: new Date(),
        paystackStatus: paystackStatus || intent.paystackStatus,
      },
    });
  } else {
    throw Object.assign(new Error('Unknown payment intent kind'), { status: 400 });
  }

  return { intent, result, reused: Boolean(result?.reused) };
}

/**
 * POST /payments/paystack/initialize
 * Body: { kind: 'TICKET'|'VENDOR', ...checkout fields }
 */
export const initializePaystackCheckout = async (req: AuthRequest, res: Response) => {
  try {
    const kind = String(req.body.kind || 'TICKET').toUpperCase();
    const frontendBase = process.env.FRONTEND_URL || 'http://localhost:5181';

    if (kind === 'TICKET') {
      const items = normalizeTicketItems(req.body);
      const { firstName, lastName, email, phone, eventId, acceptedTerms, acceptedMarketing } = req.body;
      if (!eventId || items.length === 0 || !email) {
        return res.status(400).json({ message: 'Missing required ticket checkout fields' });
      }
      if (!isValidEmail(String(email).trim())) {
        return res.status(400).json({ message: 'A valid email is required' });
      }

      const event = await prisma.event.findUnique({
        where: { id: Number(eventId) },
        include: { organization: true },
      });
      if (!event) return res.status(404).json({ message: 'Event not found' });

      if (event.organizerTerms && !acceptedTerms) {
        return res.status(400).json({ message: 'You must agree to the organizer’s terms to continue.' });
      }

      const ticketTypes = await prisma.ticketType.findMany({
        where: { id: { in: items.map((i) => i.ticketTypeId) } },
      });
      const typeById = new Map(ticketTypes.map((t) => [t.id, t]));
      const cleanEmail = email ? String(email).trim().toLowerCase() : null;
      const cleanPhone = phone ? normalizePhone(String(phone)) : null;

      for (const item of items) {
        const ticketType = typeById.get(item.ticketTypeId);
        if (!ticketType || ticketType.eventId !== event.id) {
          return res.status(404).json({ message: 'Ticket type not found' });
        }
        try {
          assertTicketSalesOpen(ticketType);
        } catch (err: any) {
          return res.status(err.status || 400).json({ message: err.message, code: err.code });
        }

        const maxPerPerson = getMaxPerPerson(ticketType);
        try {
          await assertMaxPerPerson({
            eventId: event.id,
            ticketTypeId: item.ticketTypeId,
            quantity: item.quantity,
            maxPerPerson,
            email: cleanEmail,
            phone: cleanPhone,
            extraUserIds: req.userId ? [req.userId] : [],
          });
        } catch (limitErr: any) {
          return res.status(400).json({
            message: limitErr.message || `Maximum ${maxPerPerson} ticket(s) per person.`,
            code: limitErr.code || 'MAX_PER_PERSON',
            owned: limitErr.owned,
            maxPerPerson: limitErr.maxPerPerson,
            remaining: limitErr.remaining,
          });
        }
      }

      const absorbFee = event.organization?.absorbFee ?? false;
      const fees = buildFeesForTicketCart(
        items.map((item) => {
          const ticketType = typeById.get(item.ticketTypeId);
          return {
            unitPrice: Number(ticketType?.price || 0),
            quantity: item.quantity,
            platformFeeNaira: ticketType?.platformFeeNaira ?? null,
          };
        }),
        absorbFee,
      );

      const payload: TicketCheckoutPayload = {
        firstName,
        lastName,
        email: String(email).trim().toLowerCase(),
        phone,
        eventId: Number(eventId),
        items,
        acceptedTerms: Boolean(acceptedTerms),
        acceptedMarketing: Boolean(acceptedMarketing),
      };

      // Free checkout — no Paystack
      if (fees.chargeAmount <= 0) {
        const reference = makePaymentReference('FREE', event.id);
        await prisma.paymentIntent.create({
          data: {
            reference,
            kind: 'TICKET',
            status: 'PENDING',
            eventId: event.id,
            amountKobo: 0,
            chargeAmount: 0,
            subtotal: fees.subtotal,
            platformFee: fees.platformFee,
            processingFee: fees.processingFee,
            netAmount: fees.netAmount,
            absorbFee,
            payload: JSON.stringify(payload),
          },
        });
        const fulfilled = await fulfillPaymentIntent(reference, 'free');
        return res.json({
          free: true,
          reference,
          ...fulfilled.result,
          message: 'Guest checkout successful',
        });
      }

      const reference = makePaymentReference('EVT', event.id);

      const amountKobo = Math.round(fees.chargeAmount * 100);
      let subaccount: string | undefined;
      try {
        const code = await requireOrganizerSubaccount(event.organization);
        subaccount = code || undefined;
      } catch (err: any) {
        return res.status(err.status || 400).json({ message: err.message });
      }
      const split = paystackTransactionSplit(fees);

      let accessCode: string | undefined;
      let authorizationUrl: string | undefined;
      try {
        const init = await initializePaystackTransaction({
          email: payload.email,
          amountKobo,
          reference,
          callbackUrl: `${frontendBase}/booking/paystack-return?reference=${encodeURIComponent(reference)}`,
          metadata: {
            kind: 'TICKET',
            eventId: event.id,
            items,
            quantity: items.reduce((sum, item) => sum + item.quantity, 0),
            custom_fields: [
              {
                display_name: 'Customer Name',
                variable_name: 'customer_name',
                value: `${firstName} ${lastName}`,
              },
            ],
          },
          subaccount: subaccount || undefined,
          transactionChargeKobo: subaccount ? split.transactionChargeKobo : undefined,
          bearer: subaccount ? split.bearer : undefined,
        });
        accessCode = init.accessCode;
        authorizationUrl = init.authorizationUrl;
      } catch (err: any) {
        // If Paystack secret missing in local/dev, still create intent for confirm mock later
        if (!process.env.PAYSTACK_SECRET_KEY) {
          console.warn('[Paystack] SECRET missing — creating local intent only');
        } else {
          throw err;
        }
      }

      await prisma.paymentIntent.create({
        data: {
          reference,
          kind: 'TICKET',
          status: 'PENDING',
          eventId: event.id,
          amountKobo,
          chargeAmount: fees.chargeAmount,
          subtotal: fees.subtotal,
          platformFee: fees.platformFee,
          processingFee: fees.processingFee,
          netAmount: fees.netAmount,
          absorbFee,
          payload: JSON.stringify(payload),
        },
      });

      return res.json({
        free: false,
        reference,
        amount: fees.chargeAmount,
        amountKobo,
        email: payload.email,
        publicKey: paystackPublicKey(),
        accessCode,
        authorizationUrl,
        subaccount: subaccount || null,
      });
    }

    if (kind === 'VENDOR') {
      if (!req.userId) {
        return res.status(401).json({ message: 'Authentication required for vendor checkout' });
      }
      const {
        eventId,
        vendorTypeId,
        businessName,
        businessEmail,
        businessPhone,
        description,
        category,
        staffCount,
      } = req.body;

      if (!eventId || !vendorTypeId) {
        return res.status(400).json({ message: 'eventId and vendorTypeId are required' });
      }

      const event = await prisma.event.findUnique({
        where: { id: Number(eventId) },
        include: { organization: true },
      });
      if (!event || !event.allowVendors) {
        return res.status(400).json({ message: 'This event does not allow vendor registration' });
      }

      const vendorType = await prisma.vendorType.findUnique({
        where: { id: Number(vendorTypeId) },
      });
      if (!vendorType || vendorType.eventId !== event.id) {
        return res.status(400).json({ message: 'Invalid vendor type' });
      }

      const absorbFee = event.organization?.absorbFee ?? false;
      const fees = buildFeesForVendor(vendorType.fee || 0, absorbFee);
      const email =
        (businessEmail && String(businessEmail).trim()) ||
        (await prisma.user.findUnique({ where: { id: req.userId } }))?.email;

      if (!email || !isValidEmail(email)) {
        return res.status(400).json({ message: 'A valid business email is required' });
      }

      const payload: VendorCheckoutPayload = {
        eventId: event.id,
        vendorTypeId: vendorType.id,
        userId: req.userId,
        businessName,
        businessEmail: email,
        businessPhone,
        description,
        category,
        staffCount,
      };

      if (fees.chargeAmount <= 0) {
        const reference = makePaymentReference('VFREE', event.id);
        await prisma.paymentIntent.create({
          data: {
            reference,
            kind: 'VENDOR',
            status: 'PENDING',
            eventId: event.id,
            amountKobo: 0,
            chargeAmount: 0,
            subtotal: fees.subtotal,
            platformFee: fees.platformFee,
            processingFee: fees.processingFee,
            netAmount: fees.netAmount,
            absorbFee,
            payload: JSON.stringify(payload),
          },
        });
        const fulfilled = await fulfillPaymentIntent(reference, 'free');
        return res.json({
          free: true,
          reference,
          vendorApplication: fulfilled.result?.vendorApplication,
          message: 'Vendor application submitted successfully',
        });
      }

      const reference = makePaymentReference('VND', event.id);
      const amountKobo = Math.round(fees.chargeAmount * 100);
      let subaccount: string | undefined;
      try {
        const code = await requireOrganizerSubaccount(event.organization);
        subaccount = code || undefined;
      } catch (err: any) {
        return res.status(err.status || 400).json({ message: err.message });
      }
      const split = paystackTransactionSplit(fees);

      let accessCode: string | undefined;
      let authorizationUrl: string | undefined;
      if (process.env.PAYSTACK_SECRET_KEY) {
        const init = await initializePaystackTransaction({
          email,
          amountKobo,
          reference,
          metadata: { kind: 'VENDOR', eventId: event.id, vendorTypeId: vendorType.id },
          subaccount,
          transactionChargeKobo: subaccount ? split.transactionChargeKobo : undefined,
          bearer: subaccount ? split.bearer : undefined,
        });
        accessCode = init.accessCode;
        authorizationUrl = init.authorizationUrl;
      }

      await prisma.paymentIntent.create({
        data: {
          reference,
          kind: 'VENDOR',
          status: 'PENDING',
          eventId: event.id,
          amountKobo,
          chargeAmount: fees.chargeAmount,
          subtotal: fees.subtotal,
          platformFee: fees.platformFee,
          processingFee: fees.processingFee,
          netAmount: fees.netAmount,
          absorbFee,
          payload: JSON.stringify(payload),
        },
      });

      return res.json({
        free: false,
        reference,
        amount: fees.chargeAmount,
        amountKobo,
        email,
        publicKey: paystackPublicKey(),
        accessCode,
        authorizationUrl,
      });
    }

    return res.status(400).json({ message: 'kind must be TICKET or VENDOR' });
  } catch (error: any) {
    console.error('[Paystack Initialize]', error);
    const status = error.status || 500;
    let message = error.message || 'Failed to initialize payment';
    if (error?.code === 'P2002') {
      message = 'An account with this phone number or email already exists.';
    } else if (typeof message === 'string' && (message.includes('prisma.') || message.includes('invocation:'))) {
      message = 'Could not complete ticket reservation. Please check your details and try again.';
    }
    return res.status(status).json({
      message,
      code: error.code,
      owned: error.owned,
      maxPerPerson: error.maxPerPerson,
      remaining: error.remaining,
    });
  }
};

/**
 * POST /payments/paystack/confirm
 * Verifies with Paystack then fulfills tickets / vendor application.
 */
export const confirmPaystackCheckout = async (req: Request, res: Response) => {
  try {
    const { reference } = req.body;
    if (!reference) {
      return res.status(400).json({ message: 'reference is required' });
    }

    const intent = await prisma.paymentIntent.findUnique({ where: { reference: String(reference) } });
    if (!intent) {
      return res.status(404).json({ message: 'Payment intent not found' });
    }

    if (intent.status === 'FULFILLED') {
      const fulfilled = await fulfillPaymentIntent(String(reference));
      return res.json({
        message: 'Already fulfilled',
        reference,
        kind: intent.kind,
        ...fulfilled.result,
      });
    }

    if (intent.amountKobo > 0) {
      if (!process.env.PAYSTACK_SECRET_KEY) {
        // Dev fallback when Paystack is not configured
        console.warn('[Paystack Confirm] No SECRET — fulfilling without gateway verify (dev only)');
      } else {
        const verified = await verifyPaystackTransaction(String(reference));
        if (verified.status !== 'success') {
          await prisma.paymentIntent.update({
            where: { id: intent.id },
            data: { status: 'FAILED', paystackStatus: verified.status },
          });
          return res.status(402).json({
            message: 'Payment not successful',
            paystackStatus: verified.status,
          });
        }
        if (verified.amount < intent.amountKobo) {
          return res.status(400).json({
            message: 'Paid amount does not match expected charge',
            expectedKobo: intent.amountKobo,
            paidKobo: verified.amount,
          });
        }
        await prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { paystackStatus: verified.status },
        });
      }
    }

    const fulfilled = await fulfillPaymentIntent(String(reference), 'success');
    return res.status(201).json({
      message: intent.kind === 'TICKET' ? 'Guest checkout successful' : 'Vendor application submitted successfully',
      reference,
      kind: intent.kind,
      ...fulfilled.result,
    });
  } catch (error: any) {
    console.error('[Paystack Confirm]', error);
    const status = error.status || 500;
    return res.status(status).json({
      message: error.message || 'Failed to confirm payment',
      code: error.code,
      owned: error.owned,
      maxPerPerson: error.maxPerPerson,
      remaining: error.remaining,
    });
  }
};

/**
 * POST /payments/paystack/webhook
 */
export const paystackWebhook = async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-paystack-signature'] as string | undefined;
    const rawBody =
      (req as any).rawBody ||
      (typeof req.body === 'string' ? req.body : JSON.stringify(req.body));

    if (process.env.PAYSTACK_SECRET_KEY) {
      if (!verifyPaystackWebhookSignature(rawBody, signature)) {
        return res.status(401).json({ message: 'Invalid signature' });
      }
    }

    const event = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const eventType = event?.event;
    const data = event?.data;

    if (eventType === 'charge.success' && data?.reference) {
      try {
        await fulfillPaymentIntent(String(data.reference), data.status || 'success');
      } catch (err) {
        console.error('[Paystack Webhook] Fulfill error:', err);
      }
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error('[Paystack Webhook]', error);
    return res.status(500).json({ message: 'Webhook error' });
  }
};

/** Ignore brand-new checkouts still open on Paystack. */
const PENDING_MIN_AGE_MS = 2 * 60 * 1000;
/** Don't surface ancient abandoned checkouts in the stuck list. */
const PENDING_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** Paystack statuses that mean money was never successfully captured. */
const PAYSTACK_DEAD_STATUSES = new Set([
  'abandoned',
  'failed',
  'reversed',
  'cancelled',
  'canceled',
]);

function emailFromIntentPayload(payloadRaw: string | null | undefined): string | null {
  try {
    const payload = JSON.parse(payloadRaw || '{}');
    const email = String(payload.email || payload.businessEmail || '').trim();
    return email || null;
  } catch {
    return null;
  }
}

async function markIntentFailed(id: number, paystackStatus: string) {
  await prisma.paymentIntent.update({
    where: { id },
    data: { status: 'FAILED', paystackStatus },
  });
}

/**
 * Admin: list PENDING intents that might be paid-but-unfulfilled.
 * Abandoned/canceled checkouts are NOT tracked until we verify with Paystack (sweep);
 * this list only shows recent PENDING rows (2 min … 14 days old).
 * GET /admin/payments/pending
 */
export const listPendingPaymentIntents = async (_req: AuthRequest, res: Response) => {
  try {
    const now = Date.now();
    const minCreatedAt = new Date(now - PENDING_MAX_AGE_MS);
    const maxCreatedAt = new Date(now - PENDING_MIN_AGE_MS);

    // Expire very old PENDING rows without calling Paystack (buyer never finished checkout).
    await prisma.paymentIntent.updateMany({
      where: {
        status: 'PENDING',
        amountKobo: { gt: 0 },
        createdAt: { lt: minCreatedAt },
      },
      data: { status: 'FAILED', paystackStatus: 'expired_unpaid' },
    });

    const intents = await prisma.paymentIntent.findMany({
      where: {
        status: 'PENDING',
        amountKobo: { gt: 0 },
        createdAt: { gt: minCreatedAt, lt: maxCreatedAt },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const eventIds = [...new Set(intents.map((i) => i.eventId))];
    const events = eventIds.length
      ? await prisma.event.findMany({
          where: { id: { in: eventIds } },
          select: { id: true, title: true },
        })
      : [];
    const eventTitle = new Map(events.map((e) => [e.id, e.title]));

    return res.json({
      pending: intents.map((i) => ({
        id: i.id,
        reference: i.reference,
        kind: i.kind,
        status: i.status,
        eventId: i.eventId,
        eventTitle: eventTitle.get(i.eventId) ?? null,
        amountKobo: i.amountKobo,
        chargeAmount: i.chargeAmount,
        email: emailFromIntentPayload(i.payload),
        paystackStatus: i.paystackStatus,
        createdAt: i.createdAt,
      })),
      count: intents.length,
      note: 'Includes abandoned checkouts until Retry marks them failed. Only paid ones get tickets.',
    });
  } catch (error: any) {
    console.error('[Paystack Pending]', error);
    return res.status(500).json({ message: error.message || 'Failed to list pending payments' });
  }
};

/**
 * Admin: verify each recent PENDING intent with Paystack.
 * - success → fulfill tickets
 * - abandoned / failed / reversed → mark FAILED (drops off stuck list)
 * - ongoing → leave PENDING
 * POST /admin/payments/sweep-pending
 */
export const sweepPendingPaymentIntents = async (_req: AuthRequest, res: Response) => {
  try {
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return res.status(400).json({ message: 'Paystack is not configured' });
    }

    const now = Date.now();
    const minCreatedAt = new Date(now - PENDING_MAX_AGE_MS);
    const maxCreatedAt = new Date(now - PENDING_MIN_AGE_MS);

    await prisma.paymentIntent.updateMany({
      where: {
        status: 'PENDING',
        amountKobo: { gt: 0 },
        createdAt: { lt: minCreatedAt },
      },
      data: { status: 'FAILED', paystackStatus: 'expired_unpaid' },
    });

    const intents = await prisma.paymentIntent.findMany({
      where: {
        status: 'PENDING',
        amountKobo: { gt: 0 },
        createdAt: { gt: minCreatedAt, lt: maxCreatedAt },
      },
      orderBy: { createdAt: 'asc' },
      take: 50,
    });

    const results: Array<{
      reference: string;
      outcome: 'fulfilled' | 'still_pending' | 'abandoned' | 'failed';
      message?: string;
      email?: string | null;
    }> = [];

    for (const intent of intents) {
      const email = emailFromIntentPayload(intent.payload);
      try {
        const paystack = await verifyPaystackTransaction(intent.reference);
        const ps = String(paystack.status || '').toLowerCase();

        if (ps === 'success') {
          if (paystack.amount && paystack.amount < intent.amountKobo) {
            await markIntentFailed(intent.id, `amount_mismatch:${paystack.amount}`);
            results.push({
              reference: intent.reference,
              outcome: 'failed',
              message: `Paid ${paystack.amount} kobo < expected ${intent.amountKobo}`,
              email,
            });
            continue;
          }
          await fulfillPaymentIntent(intent.reference, paystack.status);
          results.push({
            reference: intent.reference,
            outcome: 'fulfilled',
            message: `Fulfilled; email → ${email || 'unknown'}`,
            email,
          });
          continue;
        }

        if (PAYSTACK_DEAD_STATUSES.has(ps) || ps.startsWith('fail')) {
          await markIntentFailed(intent.id, ps || 'abandoned');
          results.push({
            reference: intent.reference,
            outcome: 'abandoned',
            message: `Marked failed (${ps || 'abandoned'}) — not paid`,
            email,
          });
          continue;
        }

        // ongoing / pending on Paystack — leave alone
        await prisma.paymentIntent.update({
          where: { id: intent.id },
          data: { paystackStatus: paystack.status },
        });
        results.push({
          reference: intent.reference,
          outcome: 'still_pending',
          message: `Paystack still ${ps || 'unknown'}`,
          email,
        });
      } catch (err: any) {
        results.push({
          reference: intent.reference,
          outcome: 'failed',
          message: err.message || 'Sweep failed for this reference',
          email,
        });
      }
    }

    return res.json({
      scanned: intents.length,
      fulfilled: results.filter((r) => r.outcome === 'fulfilled').length,
      abandoned: results.filter((r) => r.outcome === 'abandoned').length,
      stillPending: results.filter((r) => r.outcome === 'still_pending').length,
      failed: results.filter((r) => r.outcome === 'failed').length,
      results,
    });
  } catch (error: any) {
    console.error('[Paystack Sweep]', error);
    return res.status(500).json({ message: error.message || 'Sweep failed' });
  }
};

/**
 * Admin: resolve a payment reference (verify + fulfill if needed)
 * POST /admin/payments/resolve { reference }
 */
export const resolvePaystackPayment = async (req: AuthRequest, res: Response) => {
  try {
    const { reference } = req.body;
    if (!reference) {
      return res.status(400).json({ message: 'reference is required' });
    }

    const intent = await prisma.paymentIntent.findUnique({ where: { reference: String(reference) } });
    let paystack: any = null;

    if (process.env.PAYSTACK_SECRET_KEY) {
      try {
        paystack = await verifyPaystackTransaction(String(reference));
      } catch (err: any) {
        paystack = { error: err.message };
      }
    }

    if (!intent) {
      return res.json({
        found: false,
        reference,
        paystack,
        message: 'No local payment intent for this reference',
      });
    }

    if (
      intent.status !== 'FULFILLED' &&
      paystack?.status === 'success' &&
      (!paystack.amount || paystack.amount >= intent.amountKobo)
    ) {
      const fulfilled = await fulfillPaymentIntent(String(reference), paystack.status);
      return res.json({
        found: true,
        resolved: true,
        reference,
        intent: await prisma.paymentIntent.findUnique({ where: { reference: String(reference) } }),
        paystack,
        result: fulfilled.result,
      });
    }

    const ps = String(paystack?.status || '').toLowerCase();
    if (
      intent.status === 'PENDING' &&
      paystack?.status &&
      (PAYSTACK_DEAD_STATUSES.has(ps) || ps.startsWith('fail'))
    ) {
      await markIntentFailed(intent.id, ps);
      return res.json({
        found: true,
        resolved: false,
        abandoned: true,
        reference,
        intent: await prisma.paymentIntent.findUnique({ where: { reference: String(reference) } }),
        paystack,
        message: `Not paid — marked failed (${ps}). No tickets to issue.`,
      });
    }

    return res.json({
      found: true,
      resolved: intent.status === 'FULFILLED',
      reference,
      intent: await prisma.paymentIntent.findUnique({ where: { reference: String(reference) } }),
      paystack,
    });
  } catch (error: any) {
    console.error('[Paystack Resolve]', error);
    return res.status(500).json({ message: error.message || 'Resolve failed' });
  }
};

/**
 * Create or update the organizer's Paystack subaccount from the saved bank details.
 * Returns null when bank details are incomplete.
 * Throws when details are present but Paystack cannot accept them.
 * An existing subaccount is updated in place, so a bank change keeps the same code.
 */
export async function syncOrganizationSubaccount(organizationId: number): Promise<string | null> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org?.payoutBankName || !org.payoutAccountNumber || !org.payoutAccountName) {
    return null;
  }
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error('Paystack is not configured, so this bank account could not be connected.');
  }

  const bankCode = await resolveBankCode(org.payoutBankName);
  if (!bankCode) {
    throw new Error(
      `Paystack does not recognize "${org.payoutBankName}". Choose the bank from the list and save again.`,
    );
  }

  const code = await createOrUpdatePaystackSubaccount({
    businessName: org.name,
    settlementBank: bankCode,
    accountNumber: org.payoutAccountNumber,
    percentageCharge: 0,
    existingCode: org.paystackSubaccountCode,
  });
  if (code !== org.paystackSubaccountCode) {
    await prisma.organization.update({
      where: { id: org.id },
      data: { paystackSubaccountCode: code },
    });
  }
  return code;
}

const PAYOUT_ACCOUNT_REQUIRED =
  'This event cannot take payment yet. The organizer needs to connect a payout bank account.';

/** Paid checkout must split to a subaccount. Tries once to create it from saved bank details. */
async function requireOrganizerSubaccount(
  org: { id: number; paystackSubaccountCode?: string | null } | null | undefined,
): Promise<string> {
  if (!process.env.PAYSTACK_SECRET_KEY) {
    return org?.paystackSubaccountCode || '';
  }
  if (org?.paystackSubaccountCode) return org.paystackSubaccountCode;
  if (org?.id) {
    try {
      const code = await syncOrganizationSubaccount(org.id);
      if (code) return code;
    } catch (err) {
      console.error('[Paystack Subaccount] checkout sync failed:', err);
    }
  }
  throw Object.assign(new Error(PAYOUT_ACCOUNT_REQUIRED), { status: 400 });
}
