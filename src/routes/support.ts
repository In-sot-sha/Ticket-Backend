import express, { Router } from 'express';
import { verifyToken, optionalVerifyToken } from '../middleware/auth';
import {
  createSupportTicket,
  getMySupportTickets,
  getMySupportTicketById,
  replyToMySupportTicket,
} from '../controllers/support';

const router: Router = express.Router();

router.post('/contact', optionalVerifyToken, createSupportTicket);
router.post('/tickets', verifyToken, createSupportTicket);
router.get('/tickets', verifyToken, getMySupportTickets);
router.get('/tickets/:id', verifyToken, getMySupportTicketById);
router.post('/tickets/:id/replies', verifyToken, replyToMySupportTicket);

export default router;
