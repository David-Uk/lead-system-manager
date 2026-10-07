import { AuditEvent } from '../models/auditEvent.model.js';
import { logger } from '../utils/logger.js';

/**
 * Appends one event to the audit trail (workplan 7).
 *
 * `record` is the generic core (webhook rejections, invalid payloads).
 * T-008 adds the typed per-step helpers below, which the pipeline uses so
 * every lifecycle event has a consistent shape. Audit writes are
 * best-effort by design: a failing audit trail must never take down the
 * live message path, so failures are logged and swallowed.
 *
 * @param {object} event
 * @param {string} event.type - one of AUDIT_EVENT_TYPES
 * @param {string} event.correlationId
 * @param {string} [event.entityType]
 * @param {string|null} [event.entityId]
 * @param {string} [event.actor]
 * @param {object} [event.detail]
 * @returns {Promise<object|null>} the created event or null when the write failed
 */
export async function record({
  type,
  correlationId,
  entityType = 'system',
  entityId = null,
  actor = 'system',
  detail = {},
}) {
  try {
    return await AuditEvent.create({ type, correlationId, entityType, entityId, actor, detail });
  } catch (err) {
    logger.error({ err, type, correlationId }, 'failed to write audit event');
    return null;
  }
}

const asId = (id) => (id ? String(id) : null);

/** Inbound message persisted after passing dedupe (pipeline step 5). */
export function recordMessageReceived({
  correlationId,
  providerMessageId,
  conversationId,
  channel,
  maskedPhone,
  type,
}) {
  return record({
    type: 'MESSAGE_RECEIVED',
    correlationId,
    entityType: 'message',
    entityId: providerMessageId,
    actor: 'customer',
    detail: { conversationId: asId(conversationId), channel, phone: maskedPhone, messageType: type },
  });
}

/** Repeat delivery of an already-processed provider message id (failure 2). */
export function recordDuplicateIgnored({ correlationId, providerMessageId, conversationId }) {
  return record({
    type: 'DUPLICATE_IGNORED',
    correlationId,
    entityType: 'message',
    entityId: providerMessageId,
    detail: { conversationId: asId(conversationId) },
  });
}

/** Classification outcome for a persisted inbound message (pipeline step 7). */
export function recordClassified({
  correlationId,
  providerMessageId,
  intent,
  confidence,
  source,
  entities,
}) {
  return record({
    type: 'CLASSIFIED',
    correlationId,
    entityType: 'message',
    entityId: providerMessageId,
    detail: { intent, confidence, source, entities },
  });
}

/** The LLM leg failed or was unconvinced and the classifier degraded (failure 1). */
export function recordClassifierFallback({ correlationId, providerMessageId, reason }) {
  return record({
    type: 'CLASSIFIER_FALLBACK',
    correlationId,
    entityType: 'message',
    entityId: providerMessageId,
    detail: { reason },
  });
}

/** An outbound reply was handed to the channel successfully (pipeline step 9). */
export function recordReplySent({
  correlationId,
  providerMessageId,
  conversationId,
  intent,
  maskedPhone,
  chars,
}) {
  return record({
    type: 'REPLY_SENT',
    correlationId,
    entityType: 'message',
    entityId: providerMessageId,
    detail: { conversationId: asId(conversationId), intent, to: maskedPhone, chars },
  });
}

/** The slot-filling machine captured an order (T-011 CONFIRM). */
export function recordOrderCreated({
  correlationId,
  providerMessageId,
  conversationId,
  orderId,
  totalNGN,
  itemCount,
}) {
  return record({
    type: 'ORDER_CREATED',
    correlationId,
    entityType: 'order',
    entityId: orderId,
    actor: 'customer',
    detail: {
      conversationId: asId(conversationId),
      sourceMessageId: providerMessageId ?? null,
      totalNGN,
      itemCount,
    },
  });
}

/** A staff status change through PATCH /api/orders/:orderId (T-012). */
export function recordOrderUpdated({ correlationId, orderId, from, to, note = null }) {
  return record({
    type: 'ORDER_UPDATED',
    correlationId,
    entityType: 'order',
    entityId: orderId,
    detail: { from, to, note, via: 'staff_api' },
  });
}

/** An unusable slot answer (failure 3) - re-prompted or escalated. */
export function recordValidationFailed({
  correlationId,
  providerMessageId,
  conversationId,
  slot,
  reason,
  attempt,
}) {
  return record({
    type: 'VALIDATION_FAILED',
    correlationId,
    entityType: 'message',
    entityId: providerMessageId,
    actor: 'customer',
    detail: { conversationId: asId(conversationId), slot, reason, attempt },
  });
}

/** A human escalation ticket was created (T-013, workplan ESCALATE step). */
export function recordTicketCreated({ correlationId, ticketId, conversationId, reason, priority }) {
  return record({
    type: 'TICKET_CREATED',
    correlationId,
    entityType: 'ticket',
    entityId: ticketId,
    detail: { conversationId: asId(conversationId), reason, priority },
  });
}

/** A staff update through PATCH /api/tickets/:ticketId (T-013). */
export function recordTicketUpdated({
  correlationId,
  ticketId,
  from,
  to,
  assignee = null,
  resolutionNote = null,
}) {
  return record({
    type: 'TICKET_UPDATED',
    correlationId,
    entityType: 'ticket',
    entityId: ticketId,
    detail: { from, to, assignee, resolutionNote, via: 'staff_api' },
  });
}

/** The staff alert for a ticket reached the channel (T-014). */
export function recordNotificationSent({ correlationId, ticketId, channel, to, attempts }) {
  return record({
    type: 'NOTIFICATION_SENT',
    correlationId,
    entityType: 'ticket',
    entityId: ticketId,
    detail: { channel, to, attempts },
  });
}

/** Every notification attempt failed (failure 4) - the dashboard flags the ticket. */
export function recordNotificationFailed({ correlationId, ticketId, channel, to, attempts, error }) {
  return record({
    type: 'NOTIFICATION_FAILED',
    correlationId,
    entityType: 'ticket',
    entityId: ticketId,
    detail: { channel, to, attempts, error },
  });
}

/**
 * Reads the audit trail for GET /api/audit (workplan 8.14). The collection
 * is append-only; this is a pure query. Pagination is cursor-based (newest
 * first, `_id` breaks createdAt ties) because the trail is written
 * continuously - offset pages would skip or repeat events between requests.
 *
 * @returns {Promise<{data: Array<object>, nextCursor: string|null}>}
 */
export async function listEvents({
  type = null,
  entityType = null,
  entityId = null,
  correlationId = null,
  from = null,
  to = null,
  limit = 20,
  cursor = null,
} = {}) {
  const query = {};
  if (type) query.type = type;
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  if (correlationId) query.correlationId = correlationId;
  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = from;
    if (to) query.createdAt.$lte = to;
  }
  if (cursor) {
    const { createdAt, id } = decodeCursor(cursor);
    query.$or = [
      { createdAt: { $lt: createdAt } },
      { createdAt, _id: { $lt: id } },
    ];
  }

  // Fetch one extra row to know whether a next page exists.
  const rows = await AuditEvent.find(query)
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return {
    data: page.map((row) => ({
      type: row.type,
      correlationId: row.correlationId,
      entityType: row.entityType,
      entityId: row.entityId,
      actor: row.actor,
      // Mongoose strips empty objects on save (`minimize`), so an event
      // created without a detail payload has no `detail` key in Mongo.
      detail: row.detail ?? {},
      createdAt: row.createdAt,
    })),
    nextCursor: hasMore ? encodeCursor(page.at(-1)) : null,
  };
}

/** Opaque keyset cursor: `createdAt|_id` in base64url (no secrets inside). */
export function encodeCursor(event) {
  return Buffer.from(`${new Date(event.createdAt).toISOString()}|${event._id}`).toString(
    'base64url',
  );
}

/** @returns {{createdAt: Date, id: string}} the event coordinates behind a cursor */
export function decodeCursor(cursor) {
  const [iso, id] = Buffer.from(String(cursor), 'base64url').toString('utf8').split('|');
  const createdAt = new Date(iso);
  if (!iso || !id || Number.isNaN(createdAt.getTime()) || !/^[0-9a-fA-F]{24}$/.test(id)) {
    throw new Error('invalid cursor');
  }
  return { createdAt, id };
}
