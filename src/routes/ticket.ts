import { Router } from 'express';
import { 
  createTicket, 
  getTickets, 
  getTicketById, 
  validateTicket, 
  purchaseTicket,
  checkoutGuest
} from '../controllers/ticket';
import { verifyToken, optionalVerifyToken } from '../middleware/auth';

const router = Router();

// Public routes (no authentication required)
router.post('/checkout/guest', checkoutGuest);
router.post('/validate', validateTicket); // For gate scanning

// Semi-private: Can view your own tickets without auth, or if authenticated with userId param
router.get('/', optionalVerifyToken, getTickets); // Now requires auth OR userId matches current user
router.get('/:id', getTicketById);

// Protected routes (authentication required)
router.post('/purchase', verifyToken, purchaseTicket);
router.post('/', verifyToken, createTicket); // For organizers to create tickets

export default router;