import { Router } from 'express';
import { 
  addOrganizationMember,
  removeOrganizationMember,
  getOrganizationMembers,
  followOrganization,
  unfollowOrganization,
  getOrganizationFollowers,
  applyToBeVendor,
  getVendorApplications,
  getVendorApplicationById,
  updateVendorApplicationStatus
} from '../controllers/organizationMemberController';
import { verifyToken, requireRole } from '../middleware/auth';

const router = Router();

// Organization member routes
router.post('/members', verifyToken, addOrganizationMember);
router.delete('/members/:organizationId/:memberId', verifyToken, removeOrganizationMember);
router.get('/members/:organizationId', verifyToken, getOrganizationMembers);

// Organization follow routes
router.post('/follow/:organizationId', verifyToken, followOrganization);
router.delete('/unfollow/:organizationId', verifyToken, unfollowOrganization);
router.get('/followers/:organizationId', verifyToken, getOrganizationFollowers);

// Vendor application routes
router.post('/vendor-applications', verifyToken, applyToBeVendor);
router.get('/vendor-applications', verifyToken, getVendorApplications);
router.get('/vendor-applications/:id', verifyToken, getVendorApplicationById);
router.put('/vendor-applications/:id/status', verifyToken, requireRole('ORGANIZER', 'ADMIN'), updateVendorApplicationStatus);

export default router;