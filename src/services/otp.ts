import crypto from 'crypto';

/**
 * OTP Service - Generate, store, and verify OTPs
 * Uses in-memory storage (replace with Redis for production)
 */

interface OTPRecord {
  code: string;
  email: string;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  verified: boolean;
}

// In-memory OTP storage (use Redis in production for scalability)
const otpStore = new Map<string, OTPRecord>();

const OTP_CONFIG = {
  LENGTH: 6,           // 6-digit OTP
  EXPIRY_MINUTES: 10,  // OTP valid for 10 minutes
  MAX_ATTEMPTS: 5,     // Max verification attempts
};

/**
 * Generate a random 6-digit OTP
 */
export const generateOTP = (): string => {
  const digits = '0123456789';
  let otp = '';
  const array = new Uint8Array(OTP_CONFIG.LENGTH);
  crypto.getRandomValues(array);
  
  for (let i = 0; i < OTP_CONFIG.LENGTH; i++) {
    otp += digits[array[i] % digits.length];
  }
  
  return otp;
};

/**
 * Create and store an OTP for an email
 */
export const createOTP = (email: string): { code: string; expiresIn: number } => {
  const code = generateOTP();
  const now = Date.now();
  const expiresAt = now + OTP_CONFIG.EXPIRY_MINUTES * 60 * 1000;

  otpStore.set(email, {
    code,
    email,
    createdAt: now,
    expiresAt,
    attempts: 0,
    verified: false,
  });

  console.log(`[OTP] Generated OTP for ${email}: ${code} (expires in ${OTP_CONFIG.EXPIRY_MINUTES} min)`);

  return {
    code,
    expiresIn: OTP_CONFIG.EXPIRY_MINUTES,
  };
};

/**
 * Verify an OTP code for an email
 */
export const verifyOTP = (email: string, code: string): { valid: boolean; message: string } => {
  const record = otpStore.get(email);

  if (!record) {
    return {
      valid: false,
      message: 'No OTP found. Please request a new one.',
    };
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(email);
    return {
      valid: false,
      message: 'OTP has expired. Please request a new one.',
    };
  }

  if (record.attempts >= OTP_CONFIG.MAX_ATTEMPTS) {
    otpStore.delete(email);
    return {
      valid: false,
      message: 'Too many failed attempts. Please request a new OTP.',
    };
  }

  if (record.code !== code) {
    record.attempts++;
    return {
      valid: false,
      message: `Invalid OTP. ${OTP_CONFIG.MAX_ATTEMPTS - record.attempts} attempts remaining.`,
    };
  }

  // OTP is valid
  record.verified = true;
  console.log(`[OTP] ✅ OTP verified for ${email}`);

  return {
    valid: true,
    message: 'OTP verified successfully.',
  };
};

/**
 * Check if an email has a verified OTP (useful before creating account)
 */
export const isOTPVerified = (email: string): boolean => {
  const record = otpStore.get(email);
  return record?.verified ?? false;
};

/**
 * Mark an OTP as used (remove from store after successful signup)
 */
export const consumeOTP = (email: string): void => {
  otpStore.delete(email);
  console.log(`[OTP] OTP consumed for ${email}`);
};

/**
 * Get OTP record details (for debugging)
 */
export const getOTPRecord = (email: string): OTPRecord | null => {
  return otpStore.get(email) ?? null;
};

/**
 * Cleanup expired OTPs (run periodically)
 */
export const cleanupExpiredOTPs = (): number => {
  let cleaned = 0;
  const now = Date.now();

  for (const [email, record] of otpStore.entries()) {
    if (now > record.expiresAt) {
      otpStore.delete(email);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.log(`[OTP] Cleaned up ${cleaned} expired OTPs`);
  }

  return cleaned;
};

/**
 * Start periodic cleanup (run every 5 minutes)
 */
export const startOTPCleanupSchedule = () => {
  setInterval(() => {
    cleanupExpiredOTPs();
  }, 5 * 60 * 1000);

  console.log('[OTP] Cleanup scheduler started (runs every 5 minutes)');
};

export default {
  generateOTP,
  createOTP,
  verifyOTP,
  isOTPVerified,
  consumeOTP,
  getOTPRecord,
  cleanupExpiredOTPs,
  startOTPCleanupSchedule,
};
