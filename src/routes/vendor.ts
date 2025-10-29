import { Router } from 'express';
import { 
  registerVendor, 
  getVendors, 
  getVendorById, 
  updateVendorStatus 
} from '../controllers/vendor';
import { verifyToken, requireRole } from '../middleware/auth';

const router = Router();

// Public routes - vendors can register themselves
router.post('/register', verifyToken, registerVendor);
router.get('/', getVendors);

// Protected routes
router.get('/:id', verifyToken, getVendorById);
router.put('/:id', verifyToken, requireRole('ORGANIZER', 'ADMIN'), updateVendorStatus);
router.put('/:id/approve', verifyToken, requireRole('ORGANIZER', 'ADMIN'), updateVendorStatus);

export default router;