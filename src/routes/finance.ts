import { Router } from 'express';
import { getBalanceLedger, getOrganizerPayouts, requestPayout } from '../controllers/finance';
import { verifyToken } from '../middleware/auth';

const router = Router();

// Protected organizer finance ledger routes
router.get('/balance', verifyToken, getBalanceLedger);
router.get('/settlements', verifyToken, getOrganizerPayouts);
router.post('/payout', verifyToken, requestPayout);

export default router;
