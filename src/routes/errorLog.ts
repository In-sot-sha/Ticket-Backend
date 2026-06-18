import express from 'express';
import { reportError, getErrors, resolveError, getErrorStats } from '../controllers/errorLog';
import { verifyToken } from '../middleware/auth';

const router = express.Router();

/**
 * POST /api/errors/report
 * Public endpoint for frontend to report errors
 */
router.post('/report', reportError);

/**
 * GET /api/errors
 * Get all errors (admin only)
 */
router.get('/', verifyToken, getErrors);

/**
 * GET /api/errors/stats
 * Get error statistics
 */
router.get('/stats', verifyToken, getErrorStats);

/**
 * PATCH /api/errors/:id/resolve
 * Mark error as resolved
 */
router.patch('/:id/resolve', verifyToken, resolveError);

export default router;
