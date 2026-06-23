import { Router } from 'express';
import { 
  createTicket, 
  getTickets, 
  getTicketById, 
  validateTicket, 
  purchaseTicket,
    requestTicketRecovery,
  verifyTicketRecovery,
  checkoutGuest
} from '../controllers/ticket';
import { verifyToken, optionalVerifyToken } from '../middleware/auth';
import { otpRequestRateLimit } from '../middleware/rateLimit';

const router = Router();

// Public routes (no authentication required)
router.post('/checkout/guest', checkoutGuest);
router.post('/validate', validateTicket); // For gate scanning

// Semi-private: Can view your own tickets without auth, or if authenticated with userId param
router.get('/', optionalVerifyToken, getTickets); // Now requires auth OR userId matches current user
router.get('/event/:eventId', getTickets); // Get all tickets for an event (for attendance)
router.get('/:id', getTicketById);

// Protected routes (authentication required)
router.post('/purchase', verifyToken, purchaseTicket);
router.post('/', verifyToken, createTicket); // For organizers to create tickets
router.post('/recover/request', otpRequestRateLimit(), requestTicketRecovery);
router.post('/recover/verify', verifyTicketRecovery);

export default router;