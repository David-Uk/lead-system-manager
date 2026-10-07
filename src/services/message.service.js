import { randomUUID } from 'node:crypto';
import { Message } from '../models/message.model.js';

/**
 * Message persistence and deduplication (workplan 7 + failure 2).
 *
 * Dedupe strategy: a fast-path lookup by `providerMessageId` so repeat
 * deliveries skip all further work, backstopped by the unique index - the
 * insert is the source of truth, so even a race between two concurrent
 * deliveries of the same id stores exactly one message.
 */

/** @returns {Promise<object|null>} the stored message with this provider id, if any */
export async function findByProviderMessageId(providerMessageId) {
    return Message.findOne({ providerMessageId });
}

/**
 * Stores an inbound message. Duplicate-key errors become
 * `{ duplicate: true }` instead of being thrown (workplan failure 2).
 *
 * @returns {Promise<{message: object|null, duplicate: boolean}>}
 */
export async function saveInboundMessage({ conversationId, providerMessageId, text = '' }) {
    try {
        const message = await Message.create({
            conversationId,
            direction: 'inbound',
            providerMessageId,
            text,
        });
        return { message, duplicate: false };
    } catch (err) {
        if (err?.code === 11000) return { message: null, duplicate: true };
        throw err;
    }
}

/** Stores the classification outcome on an already persisted inbound message. */
export async function annotateMessage(messageId, { intent, confidence, classifierSource }) {
    return Message.findByIdAndUpdate(
        messageId,
        { $set: { intent, confidence, classifierSource } },
        { new: true },
    );
}

/**
 * Stores an outbound reply. `providerMessageId` may be null when the
 * channel did not surface one (cloud sends normally return a wamid); a
 * local id keeps the unique index satisfied either way.
 */
export async function saveOutboundMessage({
    conversationId,
    providerMessageId = null,
    text = '',
    intent = null,
}) {
    return Message.create({
        conversationId,
        direction: 'outbound',
        providerMessageId: providerMessageId ?? `local-out-${randomUUID()}`,
        text,
        intent,
    });
}

/**
 * Newest `limit` messages of a conversation, returned oldest-first so the
 * ticket detail view (workplan 8.10) reads top-to-bottom like a chat.
 */
export async function listRecentMessages(conversationId, limit = 20) {
    const newestFirst = await Message.find({ conversationId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
    return newestFirst.reverse();
}
