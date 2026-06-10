import { Router } from 'express';
import { verifyToken } from '../middleware/auth';
import {
  createGatePin,
  listGatePins,
  deleteGatePin,
  verifyGatePin,
} from '../controllers/gatePin';

const router = Router();

// Public — gate staff verify their PIN before scanning
router.post('/verify', verifyGatePin);

// Protected — organiser manages PINs
router.get('/',     verifyToken, listGatePins);
router.post('/',    verifyToken, createGatePin);
router.delete('/:id', verifyToken, deleteGatePin);

export default router;
