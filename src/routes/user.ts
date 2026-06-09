import { Router } from 'express';
import { register, login, getProfile, updateProfile, googleLogin } from '../controllers/user';
import { verifyToken } from '../middleware/auth';

const router = Router();

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/google-login', googleLogin);

// Protected routes
router.get('/profile', verifyToken, getProfile);
router.put('/profile', verifyToken, updateProfile);

export default router;