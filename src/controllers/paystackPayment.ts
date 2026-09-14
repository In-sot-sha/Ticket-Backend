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
  buildFeesForTicket,
  buildFeesForVendor,
  fulfillTicketCheckout,
  fulfillVendorCheckout,
  TicketCheckoutPayload,
  VendorCheckoutPayload,
} from '../services/checkoutFulfillment';
import { isValidEmail } from '../utils/validation';

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
      const { firstName, lastName, email, phone, eventId, ticketTypeId, quantity } = req.body;
      if (!eventId || !ticketTypeId || !quantity || !email) {
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

      const ticketType = await prisma.ticketType.findUnique({
        where: { id: Number(ticketTypeId) },
      });
      if (!ticketType || ticketType.eventId !== event.id) {
        return res.status(404).json({ message: 'Ticket type not found' });
      }

      const absorbFee = event.organization?.absorbFee ?? false;
      const fees = buildFeesForTicket(ticketType.price, Number(quantity), absorbFee);

      // Free checkout — no Paystack
      if (fees.chargeAmount <= 0) {
        const reference = makePaymentReference('FREE', event.id);
        const payload: TicketCheckoutPayload = {
          firstName,
          lastName,
          email: String(email).trim().toLowerCase(),
          phone,
          eventId: Number(eventId),
          ticketTypeId: Number(ticketTypeId),
          quantity: Number(quantity),
        };
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
      const payload: TicketCheckoutPayload = {
        firstName,
        lastName,
        email: String(email).trim().toLowerCase(),
        phone,
        eventId: Number(eventId),
        ticketTypeId: Number(ticketTypeId),
        quantity: Number(quantity),
      };

      const amountKobo = Math.round(fees.chargeAmount * 100);
      const subaccount = event.organization?.paystackSubaccountCode || undefined;
      const transactionChargeKobo = Math.round(fees.platformFee * 100);
      const bearer = absorbFee ? 'subaccount' : 'account';

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
            ticketTypeId: ticketType.id,
            quantity: Number(quantity),
            custom_fields: [
              {
                display_name: 'Customer Name',
                variable_name: 'customer_name',
                value: `${firstName} ${lastName}`,
              },
            ],
          },
          subaccount: subaccount || undefined,
          transactionChargeKobo: subaccount ? transactionChargeKobo : undefined,
          bearer: subaccount ? bearer : undefined,
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
      const subaccount = event.organization?.paystackSubaccountCode || undefined;

      let accessCode: string | undefined;
      let authorizationUrl: string | undefined;
      if (process.env.PAYSTACK_SECRET_KEY) {
        const init = await initializePaystackTransaction({
          email,
          amountKobo,
          reference,
          metadata: { kind: 'VENDOR', eventId: event.id, vendorTypeId: vendorType.id },
          subaccount,
          transactionChargeKobo: subaccount ? Math.round(fees.platformFee * 100) : undefined,
          bearer: subaccount ? (absorbFee ? 'subaccount' : 'account') : undefined,
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
    return res.status(status).json({
      message: error.message || 'Failed to initialize payment',
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

    return res.json({
      found: true,
      resolved: intent.status === 'FULFILLED',
      reference,
      intent,
      paystack,
    });
  } catch (error: any) {
    console.error('[Paystack Resolve]', error);
    return res.status(500).json({ message: error.message || 'Resolve failed' });
  }
};

/**
 * Ensure org has a Paystack subaccount from payout bank details.
 */
export async function syncOrganizationSubaccount(organizationId: number): Promise<string | null> {
  const org = await prisma.organization.findUnique({ where: { id: organizationId } });
  if (!org?.payoutBankName || !org.payoutAccountNumber || !org.payoutAccountName) {
    return null;
  }
  if (!process.env.PAYSTACK_SECRET_KEY) return org.paystackSubaccountCode;

  try {
    const bankCode = await resolveBankCode(org.payoutBankName);
    if (!bankCode) {
      console.warn(`[Paystack Subaccount] Could not resolve bank code for "${org.payoutBankName}"`);
      return org.paystackSubaccountCode;
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
  } catch (err) {
    console.error('[Paystack Subaccount] sync failed:', err);
    return org.paystackSubaccountCode;
  }
}
