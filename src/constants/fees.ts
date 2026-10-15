/**
 * PartyStorm checkout fee (published): 7.5% + ₦100 per paid ticket/booth unit.
 * Free / RSVP (₦0) is never charged.
 * Paystack (≈1.5% + ₦100) is settled from this take — not added again for the buyer.
 */
export const PLATFORM_FEE_RATE = 0.075;
export const PLATFORM_FEE_FLAT = 100;

/** @deprecated Kept for older call sites; default formula no longer uses min/max. */
export const PLATFORM_FEE_MIN = PLATFORM_FEE_FLAT;
export const PLATFORM_FEE_MAX = 2_000_000;

/** Paystack local (internal cost): 1.5% + ₦100 (flat waived under ₦2,500), capped at ₦2,000. */
export const PAYSTACK_RATE = 0.015;
export const PAYSTACK_FLAT = 100;
export const PAYSTACK_FLAT_WAIVE_BELOW = 2500;
export const PAYSTACK_LOCAL_CAP = 2000;

/** @deprecated Use PAYSTACK_* constants; kept for older call sites. */
export const PROCESSING_FEE_RATE = PAYSTACK_RATE;
export const PROCESSING_FEE_FLAT = PAYSTACK_FLAT;

/**
 * PartyStorm take / buyer checkout fee per unit.
 * Pass `platformFeeNaira` to override the default 7.5% + ₦100 formula.
 */
export function platformFeeForUnit(
  price: number,
  platformFeeNaira?: number | null,
): number {
  if (price <= 0) return 0;
  if (platformFeeNaira != null && Number.isFinite(Number(platformFeeNaira))) {
    return Math.max(0, Math.round(Number(platformFeeNaira)));
  }
  return Math.round(price * PLATFORM_FEE_RATE) + PLATFORM_FEE_FLAT;
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
  /** Estimated Paystack cost (borne by PartyStorm from platformFee). */
  processingFee: number;
  /** Amount shown as Fee to the buyer (0 when absorb). Equals platformFee when passed through. */
  feeChargedToBuyer: number;
  /** Amount the buyer / payment provider should charge. */
  chargeAmount: number;
  /**
   * Organizer share (subaccount).
   * Face value when the buyer pays the fee.
   * Face value minus PartyStorm take when fees are absorbed (Paystack is borne by PartyStorm).
   */
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
 * Pass-through: buyer pays face + unified fee (7.5% + ₦100). Organizer net is the face value.
 * Absorb: buyer pays face only. Organizer net is face − PartyStorm take.
 * Paystack is always settled from PartyStorm’s take (not added on top for the buyer).
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
    const chargeAmount = safeSubtotal;
    const processingFee = Math.round(paystackLocalFee(chargeAmount));
    return {
      subtotal: safeSubtotal,
      platformFee: safePlatform,
      processingFee,
      feeChargedToBuyer: 0,
      chargeAmount,
      // Organizer keeps face − PartyStorm take; Paystack comes out of our take.
      netAmount: Math.max(0, safeSubtotal - safePlatform),
      absorbFee: true,
    };
  }

  // Unified fee only — do not stack Paystack again for the buyer.
  const chargeAmount = safeSubtotal + safePlatform;
  const processingFee = Math.round(paystackLocalFee(chargeAmount));

  return {
    subtotal: safeSubtotal,
    platformFee: safePlatform,
    processingFee,
    feeChargedToBuyer: safePlatform,
    chargeAmount,
    netAmount: safeSubtotal,
    absorbFee: false,
  };
}

/**
 * Paystack split for one charge.
 * Always bearer = account so Paystack fees come from PartyStorm, not the organizer subaccount.
 *
 * Pass-through: main takes the unified fee; Paystack deducts from that → we net fee − Paystack.
 * Absorb: main takes only the PartyStorm take (Paystack deducts from that → we net take − Paystack).
 * Subaccount gets charge − transaction_charge (= face, or face − take when absorbed).
 */
export function paystackTransactionSplit(fees: OrderFeeBreakdown): {
  transactionChargeKobo: number;
  bearer: 'account' | 'subaccount';
} {
  return {
    transactionChargeKobo: Math.round(fees.platformFee * 100),
    bearer: 'account',
  };
}

/**
 * Fee breakdown for a line of identical units (one ticket type × qty, or one booth).
 */
export function calculateUnitOrderFees(
  unitPrice: number,
  quantity: number,
  absorbFee: boolean,
  platformFeeNaira?: number | null,
): OrderFeeBreakdown {
  const qty = Math.max(0, Math.floor(quantity));
  if (qty <= 0) return emptyFees(absorbFee);
  const subtotal = Math.round(Number(unitPrice) * qty);
  const platformFee = platformFeeForUnit(Number(unitPrice), platformFeeNaira) * qty;
  return feesFromSubtotalAndPlatform(subtotal, platformFee, absorbFee);
}

export type CartFeeLine = {
  unitPrice: number;
  quantity: number;
  /** Admin override per unit; null/undefined uses the default formula. */
  platformFeeNaira?: number | null;
};

/** Combine several ticket lines into one Paystack charge. */
export function calculateCartOrderFees(
  lines: Array<CartFeeLine>,
  absorbFee: boolean,
): OrderFeeBreakdown {
  let subtotal = 0;
  let platformFee = 0;
  for (const line of lines) {
    const qty = Math.max(0, Math.floor(Number(line.quantity) || 0));
    if (qty <= 0) continue;
    const unit = Number(line.unitPrice) || 0;
    subtotal += Math.round(unit * qty);
    platformFee += platformFeeForUnit(unit, line.platformFeeNaira) * qty;
  }
  return feesFromSubtotalAndPlatform(subtotal, platformFee, absorbFee);
}

/**
 * Legacy helper: fees from a gross face-value amount treated as one unit.
 * Prefer calculateUnitOrderFees when unit price + qty are known.
 */
export function calculateOrderFees(grossAmount: number, absorbFee = false) {
  return calculateUnitOrderFees(grossAmount, grossAmount > 0 ? 1 : 0, absorbFee);
}
