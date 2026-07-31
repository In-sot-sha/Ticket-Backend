import { Router } from 'express';
import {
  sendOTP,
  verifyEmailOTP,
  sendWelcomeEmail,
  sendTicketConfirmation,
  testEmail,
  listEmailPreviews,
  previewEmail,
} from '../controllers/email';
import { verifyToken } from '../middleware/auth';

const router = Router();

// ── Public ───────────────────────────────────────────────────────────────────

router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyEmailOTP);
router.post('/test', testEmail);

// ── Preview (dev open; production requires admin via verifyToken) ─────────────

router.get('/preview', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return verifyToken(req, res, () => listEmailPreviews(req, res));
  }
  return listEmailPreviews(req, res);
});

router.get('/preview/:id', (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return verifyToken(req, res, () => previewEmail(req as any, res));
  }
  return previewEmail(req as any, res);
});

// ── Protected ────────────────────────────────────────────────────────────────

router.post('/send-welcome', verifyToken, sendWelcomeEmail);
router.post('/send-ticket-confirmation', verifyToken, sendTicketConfirmation);

export default router;
