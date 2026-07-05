import { Router } from 'express';
import { getBalanceLedger, requestPayout } from '../controllers/finance';
import { verifyToken } from '../middleware/auth';

const router = Router();

// Protected organizer finance ledger routes
router.get('/balance', verifyToken, getBalanceLedger);
router.post('/payout', verifyToken, requestPayout);

export default router;
