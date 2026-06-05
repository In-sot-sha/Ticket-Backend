import { Router } from 'express';
import { 
  registerVendor, 
  getVendorApplications, 
  getVendorApplicationById, 
  updateVendorApplicationStatus,
  createVendorProfile,
  getUserVendorProfiles,
  updateVendorProfile,
  deleteVendorProfile
} from '../controllers/vendor';
import { verifyToken, requireRole } from '../middleware/auth';

const router = Router();

// Public routes
router.get('/', getVendorApplications);

// Protected routes for vendor profiles
router.post('/profiles', verifyToken, createVendorProfile);
router.get('/profiles', verifyToken, getUserVendorProfiles);
router.get('/profiles/:id', verifyToken, getVendorApplicationById);
router.put('/profiles/:id', verifyToken, updateVendorProfile);
router.delete('/profiles/:id', verifyToken, deleteVendorProfile);

// Protected routes for vendor applications
router.post('/applications', verifyToken, registerVendor);
router.get('/applications', verifyToken, getVendorApplications);
router.get('/applications/:id', verifyToken, getVendorApplicationById);
router.put('/applications/:id/status', verifyToken, requireRole('ORGANIZER', 'ADMIN'), updateVendorApplicationStatus);

export default router;