import { Router } from 'express';
import {
  createEvent,
  getEvents,
  getEvent,
  updateEvent,
  deleteEvent,
  getOrganizerEvents,
  getOrganizerEventById,
  getOrganizerAnalytics,
} from '../controllers/event';
import { verifyToken } from '../middleware/auth';
import { upload } from '../utils/upload';

const router = Router();

// Public routes
router.get('/', getEvents);

// Unified event lookup — works with slug OR numeric ID
// e.g. /events/get/afro-fusion-festival-abuja  or  /events/get/42
router.get('/get/:identifier', getEvent);

// Legacy aliases so existing clients & bookmarks keep working
router.get('/get-event/:identifier', getEvent);  // old ID-based route
router.get('/slug/:identifier', getEvent);         // old slug-based route

// Protected routes
router.get('/organizer/analytics', verifyToken, getOrganizerAnalytics);
router.get('/organizer', verifyToken, getOrganizerEvents);
router.get('/organizer/:id', verifyToken, getOrganizerEventById);
router.post('/', verifyToken,  upload.single('image'), createEvent);
router.get('/:identifier', getEvent);
// router.post('/vendor', verifyToken,  upload.single('image'), createEvent);
router.put('/update/:id', verifyToken, upload.single('image'), updateEvent);
router.put('/:id', verifyToken, upload.single('image'), updateEvent);
router.delete('/delete/:id', verifyToken, deleteEvent);
router.delete('/:id', verifyToken, deleteEvent);

export default router;