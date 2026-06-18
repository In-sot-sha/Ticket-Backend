import { Router } from 'express';
import { register, login, getProfile, updateProfile, uploadAvatar, googleLogin } from '../controllers/user';
import { verifyToken } from '../middleware/auth';
import { upload } from '../utils/upload';

const router = Router();

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/google-login', googleLogin);

// Protected routes
router.get('/profile', verifyToken, getProfile);
router.put('/profile', verifyToken, updateProfile);
router.post('/profile/avatar', verifyToken, upload.single('avatar'), uploadAvatar);

export default router;