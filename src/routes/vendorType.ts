import { Router } from 'express';
import { 
  getVendorTypesForEvent, 
  createVendorType, 
  updateVendorType, 
  deleteVendorType 
} from '../controllers/vendorType';
import { verifyToken, requireRole } from '../middleware/auth';

const router = Router();

// Get all vendor types for an event
router.get('/event/:eventId', verifyToken, requireRole('ORGANIZER', 'ADMIN'), getVendorTypesForEvent);

// Create a new vendor type for an event
router.post('/event/:eventId', verifyToken, requireRole('ORGANIZER', 'ADMIN'), createVendorType);

// Update a vendor type
router.put('/:id', verifyToken, requireRole('ORGANIZER', 'ADMIN'), updateVendorType);

// Delete a vendor type
router.delete('/:id', verifyToken, requireRole('ORGANIZER', 'ADMIN'), deleteVendorType);

export default router;