import { z } from 'zod';
import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import { normalisePhone } from '../utils/phone.js';
import * as audit from '../services/audit.service.js';

/**
 * Trimmed Meta Cloud API webhook payload (workplan 8.2). Unknown fields are
 * preserved (`.passthrough()`) because Meta adds fields over time; only the
 * parts the pipeline consumes are required.
 */
const contactSchema = z
  .object({
    profile: z.object({ name: z.string().optional() }).optional(),
    wa_id: z.string(),
  })
  .passthrough();

const messageSchema = z
  .object({
    from: z.string().min(1),
    id: z.string().min(1),
    timestamp: z.string().optional(),
    type: z.string().min(1),
    // Payload for text messages; absent for image/audio/etc.
    text: z.object({ body: z.string() }).optional(),
  })
  .passthrough();

const valueSchema = z
  .object({
    messaging_product: z.string().optional(),
    contacts: z.array(contactSchema).optional(),
    messages: z.array(messageSchema).optional(),
    statuses: z.array(z.unknown()).optional(),
  })
  .passthrough();

const changeSchema = z
  .object({
    field: z.string().optional(),
    value: valueSchema,
  })
  .passthrough();

const entrySchema = z
  .object({
    id: z.string().optional(),
    changes: z.array(changeSchema).min(1),
  })
  .passthrough();

export const webhookPayloadSchema = z
  .object({
    object: z.literal('whatsapp_business_account'),
    entry: z.array(entrySchema).min(1),
  })
  .passthrough();

/**
 * Flattens the Meta payload into the inbound-message shape used across the
 * pipeline. Non-text messages have `text: null` and keep their `type` so the
 * pipeline can answer politely (workplan 8.2).
 *
 * @returns {Array<{providerMessageId: string, phone: string|null, phoneRaw: string,
 *   name: string|null, type: string, text: string|null, timestamp: string|null}>}
 */
export function extractInboundMessages(payload) {
  const messages = [];

  for (const entry of payload.entry) {
    for (const change of entry.changes) {
      if (change.field && change.field !== 'messages') continue;

      const value = change.value;
      if (!value.messages?.length) continue; // status-only callback

      const name = value.contacts?.[0]?.profile?.name ?? null;

      for (const message of value.messages) {
        messages.push({
          providerMessageId: message.id,
          phoneRaw: message.from,
          phone: normalisePhone(message.from),
          name,
          type: message.type,
          text: message.type === 'text' ? (message.text?.body ?? '') : null,
          timestamp: message.timestamp ?? null,
        });
      }
    }
  }

  return messages;
}

/**
 * Validates the webhook payload and stores the extracted messages on
 * `req.webhook`. Invalid payloads are audited as PAYLOAD_INVALID (the 200
 * convention applies only to messages we accepted; junk gets a 400 so Meta
 * and operators can see the problem).
 */
export const validateWebhookPayload = asyncHandler(async (req, res, next) => {
  const parsed = webhookPayloadSchema.safeParse(req.body);

  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));

    await audit.record({
      type: 'PAYLOAD_INVALID',
      correlationId: req.id,
      detail: { issues: details },
    });

    return next(new HttpError(400, 'VALIDATION_ERROR', 'Invalid webhook payload', details));
  }

  req.webhook = { messages: extractInboundMessages(parsed.data) };
  return next();
});
