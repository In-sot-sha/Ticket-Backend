import { prisma } from '../prisma';
import { calculateUnitOrderFees } from '../constants/fees';
import {
  assertMaxPerPerson,
  getMaxPerPerson,
  getOrCreateGuestUser,
} from './guestUser';
import { isValidEmail, isValidName, normalizePhone, sanitizeString } from '../utils/validation';

export type TicketCheckoutPayload = {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  eventId: number;
  ticketTypeId: number;
  quantity: number;
};

export type VendorCheckoutPayload = {
  eventId: number;
  vendorTypeId: number;
  userId: number;
  businessName?: string;
  businessEmail?: string;
  businessPhone?: string;
  description?: string;
  category?: string;
  staffCount?: number;
};

async function sendTicketEmail(params: {
  email: string;
  event: { title: string; startDate: Date | null; location: string | null };
  ticketType: { name: string; ticketStyle?: string | null; accentColor?: string | null };
  tickets: Array<{
    id: number;
    qrCode: string;
    ticketType?: { name?: string; accentColor?: string | null } | null;
  }>;
  totalPrice: number;
  quantity: number;
}) {
  try {
    const { generateTicketConfirmationEmail, sendEmail } = await import('./email');
    const emailContent = generateTicketConfirmationEmail(params.email, {
      ticketId: params.tickets
        .map((t) => `TKT-${t.id.toString().padStart(6, '0')}`)
        .join(' · '),
      eventTitle: params.event.title,
      eventDate: params.event.startDate
        ? new Date(params.event.startDate).toLocaleDateString()
        : 'TBA',
      eventLocation: params.event.location || 'TBA',
      ticketType: params.ticketType.name,
      quantity: params.quantity,
      totalPrice: params.totalPrice,
      ticketStyle: params.ticketType.ticketStyle,
      accentColor: params.ticketType.accentColor,
      passes: params.tickets.map((t) => ({
        label: `TKT-${t.id.toString().padStart(6, '0')}`,
        qrCode: t.qrCode,
        ticketType: t.ticketType?.name || params.ticketType.name,
        accentColor: t.ticketType?.accentColor || params.ticketType.accentColor,
      })),
    });
    await sendEmail({
      to: params.email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
    });
  } catch (err) {
    console.error('Failed to send ticket confirmation email:', err);
  }
}

export async function fulfillTicketCheckout(input: {
  payload: TicketCheckoutPayload;
  paymentReference: string | null;
  fees: {
    subtotal: number;
    platformFee: number;
    processingFee: number;
    netAmount: number;
    chargeAmount: number;
  };
}) {
  const { payload, paymentReference, fees } = input;

  if (!payload.firstName || !isValidName(payload.firstName)) {
    throw Object.assign(new Error('Invalid first name'), { status: 400 });
  }
  if (!payload.lastName || !isValidName(payload.lastName)) {
    throw Object.assign(new Error('Invalid last name'), { status: 400 });
  }

  const cleanEmail = payload.email?.trim() ? String(payload.email).trim().toLowerCase() : null;
  const cleanPhone = payload.phone ? normalizePhone(String(payload.phone)) : null;
  if (!cleanEmail || !isValidEmail(cleanEmail)) {
    throw Object.assign(new Error('A valid email address is required'), { status: 400 });
  }

  if (paymentReference) {
    const existing = await prisma.order.findUnique({
      where: { paymentReference },
      include: {
        tickets: { include: { event: true, ticketType: true } },
        user: true,
      },
    });
    if (existing) {
      return { order: existing, tickets: existing.tickets, user: existing.user, reused: true };
    }
  }

  const event = await prisma.event.findUnique({
    where: { id: Number(payload.eventId) },
    include: { organization: true },
  });
  if (!event) throw Object.assign(new Error('Event not found'), { status: 404 });

  const ticketType = await prisma.ticketType.findUnique({
    where: { id: Number(payload.ticketTypeId) },
  });
  if (!ticketType || ticketType.eventId !== event.id) {
    throw Object.assign(new Error('Ticket type not found'), { status: 404 });
  }

  const sanitizedFirstName = sanitizeString(payload.firstName);
  const sanitizedLastName = sanitizeString(payload.lastName);

  let guestUser = await getOrCreateGuestUser({
    name: `${sanitizedFirstName} ${sanitizedLastName}`,
    email: cleanEmail,
    phone: cleanPhone,
  });

  if (guestUser.firstName === 'Guest' || !guestUser.firstName) {
    guestUser = await prisma.user.update({
      where: { id: guestUser.id },
      data: { firstName: sanitizedFirstName, lastName: sanitizedLastName },
    });
  }

  const quantity = Number(payload.quantity);
  const maxPerPerson = getMaxPerPerson(ticketType);
  try {
    await assertMaxPerPerson({
      eventId: Number(payload.eventId),
      ticketTypeId: Number(payload.ticketTypeId),
      quantity,
      maxPerPerson,
      email: cleanEmail || guestUser.email,
      phone: cleanPhone || guestUser.phone,
      extraUserIds: [guestUser.id],
    });
  } catch (limitErr: any) {
    if (limitErr?.code === 'MAX_PER_PERSON') {
      throw Object.assign(new Error(limitErr.message), {
        status: 400,
        code: 'MAX_PER_PERSON',
        owned: limitErr.owned,
        maxPerPerson: limitErr.maxPerPerson,
        remaining: limitErr.remaining,
      });
    }
    throw limitErr;
  }

  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        userId: guestUser.id,
        eventId: event.id,
        totalAmount: fees.subtotal,
        platformFee: fees.platformFee,
        processingFee: fees.processingFee,
        netAmount: fees.netAmount,
        chargeAmount: fees.chargeAmount,
        paymentReference: paymentReference || undefined,
        status: 'PAID',
        purchaseType: 'ONLINE',
      },
    });

    const tickets = [];
    for (let i = 0; i < quantity; i++) {
      const ticket = await tx.ticket.create({
        data: {
          eventId: event.id,
          ticketTypeId: ticketType.id,
          userId: guestUser.id,
          qrCode: `QR-${Date.now()}-${i}-${Math.random()}`,
          purchaseType: 'ONLINE',
          orderId: order.id,
        },
        include: { event: true, ticketType: true },
      });
      tickets.push(ticket);
    }
    return { order, tickets };
  });

  await sendTicketEmail({
    email: cleanEmail,
    event,
    ticketType,
    tickets: result.tickets,
    totalPrice: fees.chargeAmount || fees.subtotal,
    quantity,
  });

  return { order: result.order, tickets: result.tickets, user: guestUser, reused: false };
}

export async function fulfillVendorCheckout(input: {
  payload: VendorCheckoutPayload;
  paymentReference: string | null;
  fees: {
    subtotal: number;
    platformFee: number;
    processingFee: number;
    netAmount: number;
    chargeAmount: number;
  };
}) {
  const { payload, paymentReference, fees } = input;

  if (paymentReference) {
    const existing = await prisma.vendorApplication.findFirst({
      where: { paymentReference },
    });
    if (existing) {
      return { vendorApplication: existing, reused: true };
    }
  }

  const event = await prisma.event.findUnique({
    where: { id: Number(payload.eventId) },
    include: { organization: true },
  });
  if (!event || !event.allowVendors) {
    throw Object.assign(new Error('This event does not allow vendor registration'), { status: 400 });
  }

  const vendorTypeDetails = await prisma.vendorType.findUnique({
    where: { id: Number(payload.vendorTypeId) },
  });
  if (!vendorTypeDetails || vendorTypeDetails.eventId !== event.id) {
    throw Object.assign(new Error('Invalid vendor type for this event'), { status: 400 });
  }

  const existingApplication = await prisma.vendorApplication.findFirst({
    where: {
      userId: payload.userId,
      eventId: event.id,
      vendorTypeId: vendorTypeDetails.id,
    },
  });
  if (existingApplication) {
    throw Object.assign(new Error('You have already applied for this vendor type at this event'), {
      status: 400,
    });
  }

  const savedVendorCard = await prisma.vendor.findFirst({ where: { userId: payload.userId } });
  const initialStatus = (event as any).vendorApprovalMode === 'auto' ? 'APPROVED' : 'PENDING';

  const vendorApplication = await prisma.vendorApplication.create({
    data: {
      userId: payload.userId,
      eventId: event.id,
      vendorTypeId: vendorTypeDetails.id,
      vendorId: savedVendorCard ? savedVendorCard.id : null,
      businessName: payload.businessName || savedVendorCard?.businessName || null,
      businessEmail: payload.businessEmail || savedVendorCard?.contactEmail || null,
      businessPhone: payload.businessPhone || savedVendorCard?.contactPhone || null,
      description: payload.description || savedVendorCard?.description || null,
      category: payload.category || savedVendorCard?.category || null,
      staffCount: payload.staffCount != null ? String(payload.staffCount) : null,
      applicationStatus: initialStatus as any,
      paymentAmount: fees.chargeAmount,
      paymentReference: paymentReference || null,
      paymentStatus: fees.chargeAmount === 0 || paymentReference ? 'PAID' : 'PENDING',
      platformFee: fees.platformFee,
      processingFee: fees.processingFee,
      netAmount: fees.netAmount,
    },
  });

  try {
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (user?.email) {
      const { generateVendorApplicationEmail, sendEmail } = await import('./email');
      const emailContent = generateVendorApplicationEmail(user.email, {
        eventTitle: event.title,
        businessName: payload.businessName || savedVendorCard?.businessName || 'Your Business',
        stallType: vendorTypeDetails.name || 'General Stall',
      });
      await sendEmail({
        to: user.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
      });
    }
  } catch (err) {
    console.error('Failed to send vendor application email:', err);
  }

  return { vendorApplication, reused: false };
}

export function buildFeesForTicket(unitPrice: number, quantity: number, absorbFee: boolean) {
  return calculateUnitOrderFees(unitPrice, quantity, absorbFee);
}

export function buildFeesForVendor(boothFee: number, absorbFee: boolean) {
  return calculateUnitOrderFees(boothFee, boothFee > 0 ? 1 : 0, absorbFee);
}
