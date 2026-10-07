import { Conversation } from '../models/conversation.model.js';

/**
 * Conversation lifecycle (workplan 7, pipeline step 5).
 *
 * One rolling conversation per customer: an inbound message resumes the
 * most recent active conversation, otherwise a fresh one starts. Terminal
 * states (order finished, cancelled, escalated, idle expiry) roll over to
 * a new conversation so history stays grouped per matter.
 *
 * Idle expiry of in-progress slot-filling lives with the state machine
 * (T-011), which will flip stale COLLECT_* conversations to EXPIRED before
 * this lookup runs.
 */

/** Conversations in these states never resume; a new inbound message rolls over. */
export const TERMINAL_STATES = ['COMPLETED', 'CANCELLED', 'ESCALATED', 'EXPIRED'];

/**
 * @param {import('mongoose').Types.ObjectId|string} customerId
 * @returns {Promise<object>} the resumable active conversation (created when none exists)
 */
export async function getOrCreateActiveConversation(customerId) {
    const existing = await Conversation.findOne({
        customerId,
        status: 'active',
        state: { $nin: TERMINAL_STATES },
    }).sort({ createdAt: -1 });

    if (existing) return existing;
    return Conversation.create({ customerId });
}

/** @returns {Promise<object|null>} the conversation with this id, if any */
export async function findConversationById(id) {
    if (!id) return null;
    return Conversation.findById(id);
}

/** Applies a `$set` patch (currentIntent, state, slots, counters) and returns the fresh document. */
export async function updateConversation(conversationId, patch) {
    return Conversation.findByIdAndUpdate(conversationId, { $set: patch }, { new: true });
}
