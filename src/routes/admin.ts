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
  getAdminEvents,
  promoteEvent,
  updateOrganizationFee,
  getPayoutRequests,
  approvePayout,
  rejectPayout,
} from '../controllers/admin';
import {
  listStaff,
  createStaff,
  resendStaffInvite,
  upsertStaff,
  addOrgCoverage,
  removeOrgCoverage,
  listOpsProjects,
  createOpsProject,
  updateOpsProject,
  assignStaffToProject,
  removeStaffFromProject,
  transferEvent,
} from '../controllers/opsStaff';

const router: Router = express.Router();

router.use(verifyToken, requireRole('ADMIN'));

router.get('/stats', getDashboardStats);
router.get('/host-applications', getHostApplications);
router.put('/host-applications/:id/verify', verifyHostApplication);
router.put('/host-applications/:id/reject', rejectHostApplication);
router.put('/host-applications/:id/fee', updateOrganizationFee);
router.get('/users', getUsers);
router.put('/users/:id/role', updateUserRole);
router.get('/transactions', getTransactions);
router.get('/revenue', getRevenue);
router.get('/payouts', getPayoutRequests);
router.post('/payouts/:id/approve', approvePayout);
router.post('/payouts/:id/reject', rejectPayout);
router.get('/support/tickets', getSupportTickets);
router.get('/support/tickets/:id', getSupportTicketById);
router.post('/support/tickets/:id/replies', replyToSupportTicket);
router.put('/support/tickets/:id', updateSupportTicket);
router.get('/events', getAdminEvents);
router.put('/events/:id/promote', promoteEvent);
router.post('/events/:id/transfer', transferEvent);

router.get('/staff', listStaff);
router.post('/staff', createStaff);
router.post('/staff/:userId/invite', resendStaffInvite);
router.put('/staff/:userId', upsertStaff);
router.post('/staff/:userId/org-coverage', addOrgCoverage);
router.delete('/staff/:userId/org-coverage/:organizationId', removeOrgCoverage);

router.get('/ops-projects', listOpsProjects);
router.post('/ops-projects', createOpsProject);
router.put('/ops-projects/:id', updateOpsProject);
router.post('/ops-projects/:id/staff', assignStaffToProject);
router.delete('/ops-projects/:id/staff/:userId', removeStaffFromProject);

export default router;
