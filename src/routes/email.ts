import { Router } from 'express';
import {
  sendOTP,
  verifyEmailOTP,
  sendWelcomeEmail,
  sendTicketConfirmation,
  testEmail,
} from '../controllers/email';
import { verifyToken } from '../middleware/auth';

const router = Router();

// ── Public endpoints (no auth required) ───────────────────────────────────────

/**
 * POST /api/emails/send-otp
 * Send OTP to email for registration/verification
 * Body: { email: string }
 * Response: { message: string, expiresIn: number }
 */
router.post('/send-otp', sendOTP);

/**
 * POST /api/emails/verify-otp
 * Verify OTP code sent to email
 * Body: { email: string, code: string }
 * Response: { valid: boolean, message: string }
 */
router.post('/verify-otp', verifyEmailOTP);

/**
 * POST /api/emails/test
 * Test email sending (development only)
 * Body: { email: string }
 * Response: { message: string }
 */
router.post('/test', testEmail);

// ── Protected endpoints (auth required) ────────────────────────────────────────

/**
 * POST /api/emails/send-welcome
 * Send welcome email after successful signup
 * Auth: Required
 * Response: { message: string }
 */
router.post('/send-welcome', verifyToken, sendWelcomeEmail);

/**
 * POST /api/emails/send-ticket-confirmation
 * Send ticket purchase confirmation email
 * Auth: Required
 * Body: { ticketId: number, eventId: number }
 * Response: { message: string }
 */
router.post('/send-ticket-confirmation', verifyToken, sendTicketConfirmation);

export default router;
