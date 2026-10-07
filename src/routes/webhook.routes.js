import { Router } from 'express';
import { receiveWebhook, verifyWebhook } from '../controllers/webhook.controller.js';
import { verifyWhatsAppSignature } from '../middleware/signature.js';
import { validateWebhookPayload } from '../validators/webhook.validator.js';

const router = Router();

// Meta verification handshake (no signature on GET).
router.get('/', verifyWebhook);

// Incoming messages: signature check, then payload validation, then
// immediate 200 + async processing.
router.post('/', verifyWhatsAppSignature, validateWebhookPayload, receiveWebhook);

export default router;
