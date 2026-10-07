import { asyncHandler } from '../utils/asyncHandler.js';
import { processInboundMessage } from '../services/pipeline.service.js';

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
