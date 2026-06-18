/** Platform commission taken from each paid ticket order (5%). */
export const PLATFORM_FEE_RATE = 0.05;

/** Payment processing: 1.5% + ₦100 per order. */
export const PROCESSING_FEE_RATE = 0.015;
export const PROCESSING_FEE_FLAT = 100;

export function calculateOrderFees(grossAmount: number) {
  if (grossAmount <= 0) {
    return { platformFee: 0, processingFee: 0, netAmount: 0 };
  }
  const platformFee = grossAmount * PLATFORM_FEE_RATE;
  const processingFee = grossAmount * PROCESSING_FEE_RATE + PROCESSING_FEE_FLAT;
  const netAmount = grossAmount - platformFee - processingFee;
  return { platformFee, processingFee, netAmount };
}
