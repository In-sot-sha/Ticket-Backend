import express, { Router } from 'express';
import { verifyToken, requireAdminOrActiveStaff } from '../middleware/auth';
import { staffHome, requestOpsProject } from '../controllers/opsStaff';
import {
  getSupportTickets,
  getSupportTicketById,
  replyToSupportTicket,
  updateSupportTicket,
} from '../controllers/admin';

const router: Router = express.Router();

router.get('/home', verifyToken, staffHome);
router.post('/ops-request', verifyToken, requestOpsProject);

/** Staff support inbox — same capabilities as admin support */
router.get(
  '/support/tickets',
  verifyToken,
  requireAdminOrActiveStaff,
  getSupportTickets
);
router.get(
  '/support/tickets/:id',
  verifyToken,
  requireAdminOrActiveStaff,
  getSupportTicketById
);
router.post(
  '/support/tickets/:id/replies',
  verifyToken,
  requireAdminOrActiveStaff,
  replyToSupportTicket
);
router.put(
  '/support/tickets/:id',
  verifyToken,
  requireAdminOrActiveStaff,
  updateSupportTicket
);

export default router;
