import { Router } from 'express';
import { 
  becomeOrganizer,
  uploadOrgLogo,
  becomeVendor, 
  getOrganizerProfile,
  updateOrganizerProfile,
  getVendorApplications,
  getMyVendorApplications
} from '../controllers/userRole';
import { verifyToken } from '../middleware/auth';
import { upload } from '../utils/upload';

const router = Router();

// Role transition endpoints
router.post('/become-organizer', verifyToken, becomeOrganizer);
router.post('/upload-logo', verifyToken, upload.single('logo'), uploadOrgLogo);
router.post('/become-vendor', verifyToken, becomeVendor);

// Organizer profile endpoints
router.get('/organizer-profile', verifyToken, getOrganizerProfile);
router.put('/organizer-profile', verifyToken, updateOrganizerProfile);

// Vendor application endpoints
router.get('/vendor-applications', verifyToken, getVendorApplications); // For organizers to see vendor applications to their events
router.get('/my-vendor-applications', verifyToken, getMyVendorApplications); // For users to see their vendor applications

export default router;