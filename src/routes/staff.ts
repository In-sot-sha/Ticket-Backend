import express, { Router } from 'express';
import {
  verifyToken,
  requireAdminOrActiveStaff,
  requireAdminOrFinanceStaff,
} from '../middleware/auth';
import { staffHome, requestOpsProject } from '../controllers/opsStaff';
import {
  getSupportTickets,
  getSupportTicketById,
  replyToSupportTicket,
  resendSupportReplyEmail,
  updateSupportTicket,
} from '../controllers/admin';
import {
  listCompanyBooks,
  listBookEvents,
  summarizeCompanyBooks,
  createCompanyBook,
  updateCompanyBook,
  deleteCompanyBook,
} from '../controllers/companyBooks';

const router: Router = express.Router();

router.get('/home', verifyToken, staffHome);
router.post('/ops-request', verifyToken, requestOpsProject);

/** Company books — admin or staff with FINANCE */
router.get('/books/summary', verifyToken, requireAdminOrFinanceStaff, summarizeCompanyBooks);
router.get('/books/events', verifyToken, requireAdminOrFinanceStaff, listBookEvents);
router.get('/books', verifyToken, requireAdminOrFinanceStaff, listCompanyBooks);
router.post('/books', verifyToken, requireAdminOrFinanceStaff, createCompanyBook);
router.put('/books/:id', verifyToken, requireAdminOrFinanceStaff, updateCompanyBook);
router.delete('/books/:id', verifyToken, requireAdminOrFinanceStaff, deleteCompanyBook);

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
router.post(
  '/support/tickets/:id/replies/:messageId/resend',
  verifyToken,
  requireAdminOrActiveStaff,
  resendSupportReplyEmail
);
router.put(
  '/support/tickets/:id',
  verifyToken,
  requireAdminOrActiveStaff,
  updateSupportTicket
);

export default router;
