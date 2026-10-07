import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { isValidNigerianPhone, normalisePhone } from '../utils/phone.js';

/**
 * POST /simulate/message request body (workplan 8.3).
 * `messageId` is optional; supply it to exercise the duplicate path (T6).
 */
export const simulateRequestSchema = z
  .object({
    from: z
      .string()
      .min(1)
      .refine(isValidNigerianPhone, 'must be a valid Nigerian phone number, e.g. +2348012345678'),
    name: z.string().min(1).max(100).optional(),
    text: z.string().min(1).max(1000),
    messageId: z.string().min(1).max(100).optional(),
    forceLlmFailure: z.boolean().optional().default(false),
  })
  .strict();

/**
 * Validates the simulate request and normalises it onto `req.simulate` in
 * the same shape the webhook validator produces, so both entry points feed
 * the identical pipeline.
 */
export function validateSimulateRequest(req, res, next) {
  const parsed = simulateRequestSchema.safeParse(req.body);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    return next(new HttpError(400, 'VALIDATION_ERROR', 'Invalid simulate request', details));
  }

  const { from, name, text, messageId, forceLlmFailure } = parsed.data;
  req.simulate = {
    message: {
      providerMessageId: messageId ?? `sim-${randomUUID()}`,
      phoneRaw: from,
      phone: normalisePhone(from),
      name: name ?? null,
      type: 'text',
      text,
      timestamp: null,
    },
    forceLlmFailure,
  };

  return next();
}
