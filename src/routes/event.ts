import { Router } from 'express';
import { createEvent, getEvents, getEventById, updateEvent, deleteEvent } from '../controllers/event';
import { verifyToken, requireRole } from '../middleware/auth';
import { upload } from '../utils/upload';

const router = Router();

// Public routes
router.get('/', getEvents);
router.get('/:id', getEventById);

// Protected routes
router.post('/', verifyToken, requireRole('ORGANIZER', 'ADMIN'), upload.single('image'), createEvent);
router.put('/:id', verifyToken, requireRole('ORGANIZER', 'ADMIN'), upload.single('image'), updateEvent);
router.delete('/:id', verifyToken, requireRole('ORGANIZER', 'ADMIN'), deleteEvent);

export default router;