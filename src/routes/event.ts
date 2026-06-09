import { Router } from 'express';
import {
  createEvent,
  getEvents,
  getEventById,
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
router.get('/get-event/:id', getEventById);

// Protected routes
router.get('/organizer/analytics', verifyToken, getOrganizerAnalytics);
router.get('/organizer', verifyToken, getOrganizerEvents);
router.get('/organizer/:id', verifyToken, getOrganizerEventById);
router.post('/', verifyToken,  upload.single('image'), createEvent);
router.get('/:id', getEventById);
// router.post('/vendor', verifyToken,  upload.single('image'), createEvent);
router.put('/update/:id', verifyToken, upload.single('image'), updateEvent);
router.put('/:id', verifyToken, upload.single('image'), updateEvent);
router.delete('/delete/:id', verifyToken, deleteEvent);
router.delete('/:id', verifyToken, deleteEvent);

export default router;