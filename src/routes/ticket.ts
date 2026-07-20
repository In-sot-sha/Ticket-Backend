import { Router } from 'express';
import { 
  createTicket, 
  getEventAttendanceTickets,
  getAdminTickets,
  getMyTickets,
  getTicketById, 
  validateTicket, 
  purchaseTicket,
  requestTicketRecovery,
  verifyTicketRecovery,
  checkoutGuest,
  checkTicketEligibility,
  manualTicket,
} from '../controllers/ticket';
import { verifyToken, optionalVerifyToken, requireRole } from '../middleware/auth';
import { otpRequestRateLimit } from '../middleware/rateLimit';

const router = Router();

// Public routes (no authentication required)
router.post('/checkout/guest', checkoutGuest);
router.post('/eligibility', optionalVerifyToken, checkTicketEligibility);
router.post('/validate', validateTicket); // For gate scanning

// Ticket queries with distinct routes
router.get('/my-tickets', verifyToken, getMyTickets); // Logged-in user's own tickets
router.get('/admin/all', verifyToken, requireRole('ADMIN'), getAdminTickets); // Platform owners/admins view all tickets
router.get('/event/:eventId', verifyToken, getEventAttendanceTickets); // Organizer event attendance tickets
router.get('/:id', verifyToken, getTicketById);

// Protected routes (authentication required)
router.post('/purchase', verifyToken, purchaseTicket);
router.post('/manual', verifyToken, manualTicket); // Organizer gate-sale registration
router.post('/', verifyToken, createTicket); // For organizers to create tickets
router.post('/recover/request', otpRequestRateLimit(), requestTicketRecovery);
router.post('/recover/verify', verifyTicketRecovery);

export default router;