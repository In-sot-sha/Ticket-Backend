import { Router } from 'express';
import { 
  createTicket, 
  getTickets, 
  getTicketById, 
  validateTicket, 
  purchaseTicket 
} from '../controllers/ticket';
import { verifyToken } from '../middleware/auth';

const router = Router();

// Public routes
router.get('/', getTickets);
router.get('/:id', getTicketById);
router.post('/validate', validateTicket); // For gate scanning

// Protected routes
router.post('/purchase', verifyToken, purchaseTicket);
router.post('/', verifyToken, createTicket); // For organizers to create tickets

export default router;