import express, { Router } from 'express';
import { verifyToken, requireRole } from '../middleware/auth';
import {
  getDashboardStats,
  getHostApplications,
  verifyHostApplication,
  rejectHostApplication,
  getUsers,
  updateUserRole,
  getTransactions,
  getRevenue,
  getSupportTickets,
  getSupportTicketById,
  replyToSupportTicket,
  updateSupportTicket,
} from '../controllers/admin';

const router: Router = express.Router();

router.use(verifyToken, requireRole('ADMIN'));

router.get('/stats', getDashboardStats);
router.get('/host-applications', getHostApplications);
router.put('/host-applications/:id/verify', verifyHostApplication);
router.put('/host-applications/:id/reject', rejectHostApplication);
router.get('/users', getUsers);
router.put('/users/:id/role', updateUserRole);
router.get('/transactions', getTransactions);
router.get('/revenue', getRevenue);
router.get('/support/tickets', getSupportTickets);
router.get('/support/tickets/:id', getSupportTicketById);
router.post('/support/tickets/:id/replies', replyToSupportTicket);
router.put('/support/tickets/:id', updateSupportTicket);

export default router;
