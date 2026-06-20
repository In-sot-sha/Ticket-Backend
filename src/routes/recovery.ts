import { Router } from 'express';
import {
  requestTicketRecovery,
  verifyTicketRecovery
} from '../controllers/ticket';
import { otpRequestRateLimit } from '../middleware/rateLimit';

const router = Router();

// Ticket recovery with OTP rate limiting
router.post('/request', otpRequestRateLimit(), requestTicketRecovery);
router.post('/verify', verifyTicketRecovery);

export default router;
