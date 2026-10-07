import { asyncHandler } from '../utils/asyncHandler.js';
import { processInboundMessage } from '../services/pipeline.service.js';
import { createSandboxKey as mintSandboxKey } from '../services/sandboxKey.service.js';

/**
 * POST /simulate/message (workplan 8.3).
 *
 * Test harness for the full pipeline without WhatsApp. Unlike the webhook
 * (which must answer 200 fast and process in the background), the simulate
 * endpoint awaits processing and returns the outcome, which makes it the
 * primary manual-testing and demo entry point.
 */
export const sendSimulatedMessage = asyncHandler(async (req, res) => {
  const { message, forceLlmFailure } = req.simulate;
  const correlationId = req.id;

  const result = await processInboundMessage({
    message,
    correlationId,
    source: 'simulate',
    options: { forceLlmFailure },
  });

  res.status(200).json({
    correlationId,
    duplicate: result.duplicate,
    intent: result.intent,
    confidence: result.confidence,
    classifierSource: result.classifierSource,
    replies: result.replies,
    conversation: result.conversation,
    ticketId: result.ticketId,
    orderId: result.orderId,
  });
});

/**
 * POST /simulate/keys (T-021).
 *
 * Mints a sandbox staff key for the demo: requests using it run the same
 * pipeline and staff APIs, but every document they touch is scoped to the
 * key's sandboxId - live data is never read or written. The plaintext key
 * is returned exactly once (only its hash is stored), expires after
 * SANDBOX_KEY_TTL_HOURS, and creation is rate-limited per IP.
 */
export const createSandboxKey = asyncHandler(async (req, res) => {
  const key = await mintSandboxKey({ ip: req.ip });

  res.status(201).json({
    apiKey: key.apiKey,
    keyPrefix: key.keyPrefix,
    sandboxId: key.sandboxId,
    expiresAt: key.expiresAt,
    note: 'Use this key as x-api-key. It authenticates the full API against an isolated dataset and never reads or writes live data.',
  });
});
