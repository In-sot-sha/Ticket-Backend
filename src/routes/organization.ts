import { Router } from 'express';
import { 
  createOrganization,
  getUserOrganizations,
  getOrganizationById,
  updateOrganization,
  deleteOrganization,
  addOrganizationMember,
  removeOrganizationMember,
  followOrganization,
  unfollowOrganization,
  getOrganizationFollowers
} from '../controllers/organization';
import { verifyToken } from '../middleware/auth';

const router = Router();

// Protected routes for organization management
router.post('/', verifyToken, createOrganization);
router.get('/', verifyToken, getUserOrganizations);
router.get('/:id', verifyToken, getOrganizationById);
router.put('/:id', verifyToken, updateOrganization);
router.delete('/:id', verifyToken, deleteOrganization);

// Member management routes
router.post('/:id/members', verifyToken, addOrganizationMember);
router.delete('/:id/members/:memberId', verifyToken, removeOrganizationMember);

// Follow/unfollow routes
router.post('/:id/follow', verifyToken, followOrganization);
router.delete('/:id/unfollow', verifyToken, unfollowOrganization);
router.get('/:id/followers', verifyToken, getOrganizationFollowers);

export default router;