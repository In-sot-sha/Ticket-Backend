/** PartyStorm platform fee: 6% per paid ticket/booth unit, min ₦100, max ₦2,000. */
export const PLATFORM_FEE_RATE = 0.06;
export const PLATFORM_FEE_MIN = 100;
export const PLATFORM_FEE_MAX = 2000;

/** Paystack local: 1.5% + ₦100 (flat waived under ₦2,500), capped at ₦2,000. */
export const PAYSTACK_RATE = 0.015;
export const PAYSTACK_FLAT = 100;
export const PAYSTACK_FLAT_WAIVE_BELOW = 2500;
export const PAYSTACK_LOCAL_CAP = 2000;

/** @deprecated Use PAYSTACK_* constants; kept for older call sites. */
export const PROCESSING_FEE_RATE = PAYSTACK_RATE;
export const PROCESSING_FEE_FLAT = PAYSTACK_FLAT;

export function platformFeeForUnit(price: number): number {
  if (price <= 0) return 0;
  return Math.min(
    PLATFORM_FEE_MAX,
    Math.max(PLATFORM_FEE_MIN, Math.round(price * PLATFORM_FEE_RATE)),
  );
}

export function paystackLocalFee(amountNgn: number): number {
  if (amountNgn <= 0) return 0;
  const flat = amountNgn < PAYSTACK_FLAT_WAIVE_BELOW ? 0 : PAYSTACK_FLAT;
  return Math.min(amountNgn * PAYSTACK_RATE + flat, PAYSTACK_LOCAL_CAP);
}

export type OrderFeeBreakdown = {
  /** Ticket / booth face value (what organizers sell). */
  subtotal: number;
  platformFee: number;
  processingFee: number;
  /** Amount shown as Fee to the buyer (0 when absorb). */
  feeChargedToBuyer: number;
  /** Amount the buyer / payment provider should charge. */
  chargeAmount: number;
  /** Organizer share after PartyStorm (+ Paystack when absorbed). */
  netAmount: number;
  absorbFee: boolean;
};

const emptyFees = (absorbFee: boolean): OrderFeeBreakdown => ({
  subtotal: 0,
  platformFee: 0,
  processingFee: 0,
  feeChargedToBuyer: 0,
  chargeAmount: 0,
  netAmount: 0,
  absorbFee,
});

/**
 * Cart-level fees from summed face value + per-unit platform fees.
 * Paystack processing is applied once on the cart (not per line).
 * Absorb: buyer pays face value only; host covers platform + processing from payout.
 * Free / RSVP lines have ₦0 platform fee.
 */
export function feesFromSubtotalAndPlatform(
  subtotal: number,
  platformFee: number,
  absorbFee: boolean,
): OrderFeeBreakdown {
  const safeSubtotal = Math.max(0, Math.round(subtotal));
  const safePlatform = Math.max(0, Math.round(platformFee));
  if (safeSubtotal <= 0 && safePlatform <= 0) {
    return emptyFees(absorbFee);
  }

  const canAbsorb = absorbFee && safeSubtotal > 0;
  if (canAbsorb) {
    const processingFee = Math.round(paystackLocalFee(safeSubtotal));
    return {
      subtotal: safeSubtotal,
      platformFee: safePlatform,
      processingFee,
      feeChargedToBuyer: 0,
      chargeAmount: safeSubtotal,
      netAmount: Math.max(0, safeSubtotal - safePlatform - processingFee),
      absorbFee: true,
    };
  }

  const base = safeSubtotal + safePlatform;
  let chargeAmount = base;
  for (let i = 0; i < 5; i++) {
    chargeAmount = base + paystackLocalFee(chargeAmount);
  }
  chargeAmount = Math.round(chargeAmount);
  const processingFee = Math.max(0, chargeAmount - base);

  return {
    subtotal: safeSubtotal,
    platformFee: safePlatform,
    processingFee,
    feeChargedToBuyer: chargeAmount - safeSubtotal,
    chargeAmount,
    netAmount: Math.max(0, safeSubtotal - safePlatform),
    absorbFee: false,
  };
}

/**
 * Fee breakdown for a line of identical units (one ticket type × qty, or one booth).
 */
export function calculateUnitOrderFees(
  unitPrice: number,
  quantity: number,
  absorbFee: boolean,
): OrderFeeBreakdown {
  const qty = Math.max(0, Math.floor(quantity));
  if (qty <= 0) return emptyFees(absorbFee);
  const subtotal = Math.round(Number(unitPrice) * qty);
  const platformFee = platformFeeForUnit(Number(unitPrice)) * qty;
  return feesFromSubtotalAndPlatform(subtotal, platformFee, absorbFee);
}

/** Combine several ticket lines into one Paystack charge. */
export function calculateCartOrderFees(
  lines: Array<{ unitPrice: number; quantity: number }>,
  absorbFee: boolean,
): OrderFeeBreakdown {
  let subtotal = 0;
  let platformFee = 0;
  for (const line of lines) {
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    if (qty <= 0) continue;
    const unit = Number(line.unitPrice) || 0;
    subtotal += Math.round(unit * qty);
    platformFee += platformFeeForUnit(unit) * qty;
  }
  return feesFromSubtotalAndPlatform(subtotal, platformFee, absorbFee);
}

/**
 * Legacy helper: fees from a gross face-value amount treated as one unit.
 * Prefer calculateUnitOrderFees when unit price + qty are known (min/max apply per unit).
 */
export function calculateOrderFees(grossAmount: number, absorbFee = false) {
  return calculateUnitOrderFees(grossAmount, grossAmount > 0 ? 1 : 0, absorbFee);
}
