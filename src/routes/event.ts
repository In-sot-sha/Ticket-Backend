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
import {
  requestEventPromotion,
  sendAttendeeBlast,
  getAttendeeBlastPreview,
  triggerEventLifecycleEmail,
} from '../controllers/organizerMarketing';
import { verifyToken } from '../middleware/auth';
import { upload } from '../utils/upload';

const router = Router();

// Public routes
router.get('/', getEvents);

// Unified event lookup — works with slug OR numeric ID
router.get('/get/:identifier', getEvent);
router.get('/get-event/:identifier', getEvent);
router.get('/slug/:identifier', getEvent);

// Protected routes
router.get('/organizer/analytics', verifyToken, getOrganizerAnalytics);
router.get('/organizer', verifyToken, getOrganizerEvents);
router.get('/organizer/:id', verifyToken, getOrganizerEventById);
router.get('/:id/attendee-blast-preview', verifyToken, getAttendeeBlastPreview);
router.post('/:id/attendee-blast', verifyToken, sendAttendeeBlast);
router.post('/:id/trigger-lifecycle-email', verifyToken, triggerEventLifecycleEmail);
router.post('/:id/request-promotion', verifyToken, requestEventPromotion);
router.post('/', verifyToken, upload.single('image'), createEvent);
router.get('/:identifier', getEvent);
router.put('/update/:id', verifyToken, upload.single('image'), updateEvent);
router.put('/:id', verifyToken, upload.single('image'), updateEvent);
router.delete('/delete/:id', verifyToken, deleteEvent);
router.delete('/:id', verifyToken, deleteEvent);

export default router;
