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
import { verifyToken } from '../middleware/auth';

const router = Router();

// Public routes
router.get('/', getTickets);
router.post('/recover/request', requestTicketRecovery);
router.post('/recover/verify', verifyTicketRecovery);
router.post('/checkout/guest', checkoutGuest);
router.get('/:id', getTicketById);
router.post('/validate', validateTicket); // For gate scanning

// Protected routes
router.post('/purchase', verifyToken, purchaseTicket);
router.post('/', verifyToken, createTicket); // For organizers to create tickets

export default router;