import { Router } from 'express';
import { receiveWhatsAppWebhook, verifyWhatsAppWebhook } from '../controllers/whatsapp';

const router = Router();

router.get('/webhook', verifyWhatsAppWebhook);
router.post('/webhook', receiveWhatsAppWebhook);

export default router;
