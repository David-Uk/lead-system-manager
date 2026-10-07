import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import * as audit from '../services/audit.service.js';

/**
 * Verifies the `X-Hub-Signature-256` header on inbound WhatsApp webhooks
 * (workplan 8.2, failure evidence T9).
 *
 * Meta signs the raw request body with the app secret:
 *   sha256 = HMAC-SHA256(APP_SECRET, rawBody)
 * The comparison is timing-safe. Rejections are audited as WEBHOOK_REJECTED
 * before the 401 is returned.
 *
 * Requires `req.rawBody` (captured by the json body parser in app.js) so the
 * signature is checked against the exact bytes Meta signed.
 */
export const verifyWhatsAppSignature = asyncHandler(async (req, res, next) => {
  const header = req.get('x-hub-signature-256') || '';
  const [scheme, providedSignature] = header.split('=');

  const reject = async (reason) => {
    await audit.record({
      type: 'WEBHOOK_REJECTED',
      correlationId: req.id,
      detail: { reason },
    });
    return next(new HttpError(401, 'UNAUTHORIZED', 'Invalid webhook signature'));
  };

  if (scheme !== 'sha256' || !providedSignature) {
    return reject('missing_signature_header');
  }

  const rawBody = Buffer.isBuffer(req.rawBody)
    ? req.rawBody
    : Buffer.from(JSON.stringify(req.body ?? {}));

  const expected = createHmac('sha256', env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex');
  const provided = Buffer.from(providedSignature, 'hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  const valid = provided.length === expectedBuffer.length && timingSafeEqual(provided, expectedBuffer);
  if (!valid) {
    return reject('invalid_signature');
  }

  return next();
});
