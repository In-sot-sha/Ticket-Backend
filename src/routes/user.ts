import { Router } from 'express';
import { register, login, getProfile, updateProfile } from '../controllers/user';
import { verifyToken } from '../middleware/auth';

const router = Router();

// Public routes
router.post('/register', register);
router.post('/login', login);

// Protected routes
router.get('/profile', verifyToken, getProfile);
router.put('/profile', verifyToken, updateProfile);

export default router;