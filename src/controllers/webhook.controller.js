import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { keepAlive } from '../utils/keepAlive.js';
import { processInboundMessage } from '../services/pipeline.service.js';

/**
 * GET /webhook - Meta verification handshake (workplan 8.1).
 * Meta calls this once when the callback URL is registered. We echo back
 * `hub.challenge` when the verify token matches, 403 otherwise.
 */
export function verifyWebhook(req, res) {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token && token === env.WHATSAPP_VERIFY_TOKEN) {
    logger.info('webhook handshake verified');
    return res.type('text/plain').send(String(challenge ?? ''));
  }

  logger.warn({ mode }, 'webhook handshake rejected (token mismatch)');
  return res.status(403).json({
    error: { code: 'UNAUTHORIZED', message: 'Verify token mismatch', details: [] },
    correlationId: req.id,
  });
}

/**
 * POST /webhook - incoming WhatsApp message (workplan 8.2).
 *
 * Signature and payload are already validated by middleware. We return 200
 * immediately (Meta retries non-2xx responses, and retries are what the
 * dedupe layer exists for), then process each message asynchronously. A
 * processing crash can therefore never turn into a webhook retry storm.
 *
 * Processing is wrapped in keepAlive so serverless deployments (Vercel) do
 * not freeze the instance in the middle of the pipeline.
 */
export function receiveWebhook(req, res) {
  const correlationId = req.id;
  const messages = req.webhook?.messages ?? [];

  res.status(200).json({ status: 'received' });

  if (messages.length === 0) {
    // Status-only callbacks (delivery receipts) are valid but nothing to do.
    logger.debug({ correlationId }, 'webhook contained no inbound messages');
    return;
  }

  for (const message of messages) {
    keepAlive(
      processInboundMessage({ message, correlationId, source: 'webhook' }).catch((err) => {
        logger.error(
          { err, correlationId, messageId: message.providerMessageId },
          'webhook message processing failed',
        );
      }),
    );
  }
}
