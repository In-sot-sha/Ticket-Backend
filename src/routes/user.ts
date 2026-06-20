import { Router } from 'express';
import { register, login, getProfile, updateProfile, uploadAvatar, googleLogin, refreshToken } from '../controllers/user';
import { verifyToken } from '../middleware/auth';
import { upload } from '../utils/upload';

const router = Router();

// Public routes
router.post('/register', register);
router.post('/login', login);
router.post('/google-login', googleLogin);
router.post('/refresh-token', refreshToken); // Does NOT require verifyToken - accepts expired tokens

// Protected routes
router.get('/profile', verifyToken, getProfile);
router.put('/profile', verifyToken, updateProfile);
router.post('/profile/avatar', verifyToken, upload.single('avatar'), uploadAvatar);

export default router;