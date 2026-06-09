import { Router } from 'express';
import { createOpayCashier, opayWebhook, verifyOpayPayment } from '../controllers/payment';

const router = Router();

// OPay cashier checkout — initiates a session and returns a cashierUrl
router.post('/opay/create', createOpayCashier);

// OPay webhook — receives async payment notifications from OPay servers
router.post('/opay/webhook', opayWebhook);

// OPay status query — verifies a payment after return from cashier
router.post('/opay/verify', verifyOpayPayment);

export default router;
