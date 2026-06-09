import { Router } from 'express';
import { createEvent, getEvents, getEventById, updateEvent, deleteEvent, getOrganizerEvents } from '../controllers/event';
import { verifyToken, requireRole } from '../middleware/auth';
import { upload } from '../utils/upload';

const router = Router();

// Public routes
router.get('/', getEvents);
router.get('/get-event/:id', getEventById);

// Protected routes
router.get('/organizer', verifyToken,  getOrganizerEvents); // Get events for the authenticated organizer
router.post('/', verifyToken,  upload.single('image'), createEvent);
router.get('/:id', getEventById);
// router.post('/vendor', verifyToken,  upload.single('image'), createEvent);
router.put('/update/:id', verifyToken, requireRole('ORGANIZER', 'ADMIN'), upload.single('image'), updateEvent);
router.delete('/delete/:id', verifyToken, requireRole('ORGANIZER', 'ADMIN'), deleteEvent);

export default router;