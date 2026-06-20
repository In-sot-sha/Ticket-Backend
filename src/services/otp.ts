import crypto from 'crypto';
import { prisma } from '../prisma';

/**
 * OTP Service - Generate, store, and verify OTPs
 * Uses database backend for reliability across restarts
 */

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
 * Create and store an OTP in database for a contact (email/phone)
 */
export const createOTP = async (contact: string): Promise<{ code: string; expiresIn: number }> => {
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + OTP_CONFIG.EXPIRY_MINUTES * 60 * 1000);

  try {
    // Delete any existing OTP for this contact
    await prisma.otp.deleteMany({
      where: { contact }
    });

    // Create new OTP
    await prisma.otp.create({
      data: {
        contact,
        code,
        expiresAt,
        attempts: 0,
        verified: false
      }
    });

    console.log(`[OTP] Generated OTP for ${contact}: ${code} (expires in ${OTP_CONFIG.EXPIRY_MINUTES} min)`);

    return {
      code,
      expiresIn: OTP_CONFIG.EXPIRY_MINUTES,
    };
  } catch (error) {
    console.error('[OTP] Error creating OTP:', error);
    throw new Error('Failed to create OTP');
  }
};

/**
 * Verify an OTP code for a contact
 */
export const verifyOTP = async (contact: string, code: string): Promise<{ valid: boolean; message: string }> => {
  try {
    const record = await prisma.otp.findUnique({
      where: { contact }
    });

    if (!record) {
      return {
        valid: false,
        message: 'No OTP found. Please request a new one.',
      };
    }

    if (new Date() > record.expiresAt) {
      // Delete expired OTP
      await prisma.otp.delete({ where: { contact } });
      return {
        valid: false,
        message: 'OTP has expired. Please request a new one.',
      };
    }

    if (record.attempts >= OTP_CONFIG.MAX_ATTEMPTS) {
      // Delete after max attempts
      await prisma.otp.delete({ where: { contact } });
      return {
        valid: false,
        message: 'Too many failed attempts. Please request a new OTP.',
      };
    }

    if (record.code !== code) {
      // Increment attempts
      await prisma.otp.update({
        where: { contact },
        data: { attempts: { increment: 1 } }
      });
      return {
        valid: false,
        message: `Invalid OTP. ${OTP_CONFIG.MAX_ATTEMPTS - record.attempts - 1} attempts remaining.`,
      };
    }

    // OTP is valid - mark as verified
    await prisma.otp.update({
      where: { contact },
      data: { verified: true }
    });

    console.log(`[OTP] ✅ OTP verified for ${contact}`);

    return {
      valid: true,
      message: 'OTP verified successfully.',
    };
  } catch (error) {
    console.error('[OTP] Error verifying OTP:', error);
    return {
      valid: false,
      message: 'Error verifying OTP. Please try again.',
    };
  }
};

/**
 * Check if a contact has a verified OTP
 */
export const isOTPVerified = async (contact: string): Promise<boolean> => {
  try {
    const record = await prisma.otp.findUnique({
      where: { contact }
    });
    return record?.verified ?? false;
  } catch (error) {
    console.error('[OTP] Error checking OTP verification:', error);
    return false;
  }
};

/**
 * Consume (delete) an OTP after successful use
 */
export const consumeOTP = async (contact: string): Promise<void> => {
  try {
    await prisma.otp.deleteMany({
      where: { contact }
    });
    console.log(`[OTP] OTP consumed for ${contact}`);
  } catch (error) {
    console.error('[OTP] Error consuming OTP:', error);
  }
};

/**
 * Get OTP record details (for debugging)
 */
export const getOTPRecord = async (contact: string) => {
  try {
    return await prisma.otp.findUnique({
      where: { contact }
    });
  } catch (error) {
    console.error('[OTP] Error getting OTP record:', error);
    return null;
  }
};

/**
 * Cleanup expired OTPs from database
 */
export const cleanupExpiredOTPs = async (): Promise<number> => {
  try {
    const result = await prisma.otp.deleteMany({
      where: {
        expiresAt: {
          lt: new Date()
        }
      }
    });

    if (result.count > 0) {
      console.log(`[OTP] Cleaned up ${result.count} expired OTPs`);
    }

    return result.count;
  } catch (error) {
    console.error('[OTP] Error cleaning up expired OTPs:', error);
    return 0;
  }
};

/**
 * Start periodic cleanup (run every 5 minutes)
 */
export const startOTPCleanupSchedule = () => {
  setInterval(async () => {
    await cleanupExpiredOTPs();
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
