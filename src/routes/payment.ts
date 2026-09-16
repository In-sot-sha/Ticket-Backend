import { Router } from 'express';
import { createOpayCashier, opayWebhook, verifyOpayPayment } from '../controllers/payment';
import {
  confirmPaystackCheckout,
  initializePaystackCheckout,
  paystackWebhook,
} from '../controllers/paystackPayment';
import { verifyToken } from '../middleware/auth';

const router = Router();

// Paystack — vendor kind requires auth
router.post(
  '/paystack/initialize',
  (req, res, next) => {
    if (String(req.body?.kind || '').toUpperCase() === 'VENDOR') {
      return verifyToken(req, res, next);
    }
    return next();
  },
  initializePaystackCheckout,
);
router.post('/paystack/confirm', confirmPaystackCheckout);
router.post('/paystack/webhook', paystackWebhook);

// OPay
router.post('/opay/create', createOpayCashier);
router.post('/opay/webhook', opayWebhook);
router.post('/opay/verify', verifyOpayPayment);

export default router;
