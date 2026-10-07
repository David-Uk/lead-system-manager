import { logger } from '../utils/logger.js';
import { maskPhone } from '../utils/phone.js';
import * as audit from './audit.service.js';
import * as customerService from './customer.service.js';
import * as conversationService from './conversation.service.js';
import * as messageService from './message.service.js';
import * as slotFilling from './slotFilling.service.js';
import { classify } from './classifier/index.js';
import { handleIntent } from './intentHandlers.js';
import { notifyStaffOfTicket } from './notify.service.js';
import { sendText } from './whatsapp.adapter.js';
import * as templates from '../utils/templates.js';

/**
 * Message pipeline (workplan 5.1, steps 4-9).
 *
 * Both entry points - the webhook (async, 200-first) and the /simulate
 * harness (awaited) - funnel every inbound message through
 * `processInboundMessage`, so dedupe, persistence, classification,
 * routing, replies and the audit trail all live in this one place.
 *
 * Landing status:
 *   [4] dedupe + [5] customer/conversation/message persistence + [7]
 *       hybrid classification + [8]/[9] intent routing and reply sending:
 *       done (T-006..T-010)
 *   [6] slot-filling resume, lazy expiry and the order flow:
 *       done (T-011/T-012)
 *   [X] escalate to ticket + staff notification: done (T-013/T-014)
 *   [10] metrics counters: done (T-015, derived from collections at read time)
 *
 * @typedef {object} PipelineResult
 * @property {boolean} duplicate     - true when the message id was already processed
 * @property {string|null} intent    - classified intent (null for non-text messages)
 * @property {number|null} confidence
 * @property {'rules'|'llm'|'fallback'|null} classifierSource
 * @property {string[]} replies      - reply texts actually sent (send failures excluded)
 * @property {{id: string, state: string, status: string}|null} conversation
 * @property {string|null} ticketId
 * @property {string|null} orderId
 */

const toConversationSummary = (conversation) =>
    conversation
        ? { id: String(conversation._id), state: conversation.state, status: conversation.status }
        : null;

const emptyResult = (extra = {}) => ({
    duplicate: false,
    intent: null,
    confidence: null,
    classifierSource: null,
    replies: [],
    conversation: null,
    ticketId: null,
    orderId: null,
    ...extra,
});

/**
 * Processes a single normalised inbound message.
 *
 * @param {object} args
 * @param {object} args.message - normalised message (see webhook.validator.js)
 * @param {string} args.correlationId
 * @param {'webhook'|'simulate'} args.source
 * @param {{forceLlmFailure?: boolean}} [args.options]
 * @returns {Promise<PipelineResult>}
 */
export async function processInboundMessage({ message, correlationId, source, options = {} }) {
    const { forceLlmFailure = false } = options;
    const log = logger.child({
        correlationId,
        source,
        messageId: message.providerMessageId,
        forceLlmFailure,
    });

    log.info({ type: message.type }, 'inbound message accepted for processing');

    // [4] Dedupe first so repeat deliveries skip every downstream step.
    const existing = await messageService.findByProviderMessageId(message.providerMessageId);
    if (existing) {
        const duplicateOf = await conversationService.findConversationById(existing.conversationId);
        await audit.recordDuplicateIgnored({
            correlationId,
            providerMessageId: message.providerMessageId,
            conversationId: existing.conversationId,
        });
        log.info('duplicate message ignored');
        return emptyResult({ duplicate: true, conversation: toConversationSummary(duplicateOf) });
    }

    // Senders we cannot normalise to E.164 have no customer record to hang
    // data on; answer politely without persistence (v1 supports NG numbers).
    if (!message.phone) {
        log.warn(
            { phoneRaw: maskPhone(message.phoneRaw) },
            'sender phone is not a usable Nigerian number; replying without persistence',
        );
        await audit.recordMessageReceived({
            correlationId,
            providerMessageId: message.providerMessageId,
            conversationId: null,
            channel: source,
            maskedPhone: maskPhone(message.phoneRaw),
            type: message.type,
        });

        const unsupported = templates.unsupportedNumber();
        const send = await sendText(message.phoneRaw, unsupported);
        if (!send.ok) {
            log.error({ error: send.error }, 'unsupported-number reply send failed');
            return emptyResult();
        }
        await audit.recordReplySent({
            correlationId,
            providerMessageId: send.providerMessageId,
            conversationId: null,
            intent: null,
            maskedPhone: maskPhone(message.phoneRaw),
            chars: unsupported.length,
        });
        return emptyResult({ replies: [unsupported] });
    }

    // [5] Upsert customer, resume/create the active conversation, persist
    // the inbound message (unique index backstops the dedupe above).
    const customer = await customerService.upsertCustomer({
        phone: message.phone,
        name: message.name,
    });
    let conversation = await conversationService.getOrCreateActiveConversation(customer._id);

    // [6a] Lazy slot-filling expiry (workplan 5.2): an order left mid-way
    // for 30+ minutes is dead. Expire it and continue on a fresh
    // conversation so this message starts cleanly instead of answering a
    // stale question.
    if (slotFilling.isStale(conversation)) {
        await conversationService.updateConversation(conversation._id, {
            state: 'EXPIRED',
            status: 'expired',
            currentIntent: null,
        });
        log.info(
            { expiredConversationId: String(conversation._id) },
            'stale slot-filling conversation expired',
        );
        conversation = await conversationService.getOrCreateActiveConversation(customer._id);
    }

    const { message: inboundMessage, duplicate } = await messageService.saveInboundMessage({
        conversationId: conversation._id,
        providerMessageId: message.providerMessageId,
        text: message.text ?? '',
    });

    if (duplicate) {
        // Lost a race with a concurrent delivery of the same provider id.
        await audit.recordDuplicateIgnored({
            correlationId,
            providerMessageId: message.providerMessageId,
            conversationId: conversation._id,
        });
        log.info('duplicate message ignored (insert race)');
        return emptyResult({ duplicate: true, conversation: toConversationSummary(conversation) });
    }

    await audit.recordMessageReceived({
        correlationId,
        providerMessageId: message.providerMessageId,
        conversationId: String(conversation._id),
        channel: source,
        maskedPhone: maskPhone(message.phone),
        type: message.type,
    });
    log.info(
        { customerId: String(customer._id), conversationId: String(conversation._id) },
        'customer upserted, conversation active, inbound message stored',
    );

    // [6] Slot-filling resume: mid-order means every message is an answer
    // to the machine's last question, so classification is skipped
    // (workplan 5.1 step 6). Stale conversations were rolled over above.
    const resumingSlots =
        message.type === 'text' && slotFilling.isCollectingState(conversation.state);

    // [7] Classification; [8] routing. Non-text messages get a prompt
    // instead of a classification (workplan 8.2).
    const conversationPatch = { lastMessageAt: new Date() };
    let classification = { intent: null, confidence: null, source: null, failure: null, entities: {} };
    let replies = [];
    let ticketId = null;
    let orderId = null;

    if (message.type !== 'text') {
        log.info({ type: message.type }, 'non-text message; asking for text');
        conversationPatch.currentIntent = null;
        replies = [templates.textOnlyPrompt()];
    } else {
        if (resumingSlots) {
            // Not classified at all - only the order intent continues; the
            // message is annotated without a classifier source.
            classification = {
                intent: 'place_order',
                confidence: null,
                source: null,
                failure: null,
                entities: {},
            };
            await messageService.annotateMessage(inboundMessage._id, {
                intent: classification.intent,
                confidence: null,
                classifierSource: null,
            });
            log.info({ state: conversation.state }, 'slot-filling resume; classification skipped');
        } else {
            classification = await classify(message.text, { forceLlmFailure, log });

            if (classification.failure) {
                await audit.recordClassifierFallback({
                    correlationId,
                    providerMessageId: message.providerMessageId,
                    reason: classification.failure,
                });
                log.warn({ reason: classification.failure }, 'classifier fell back to rules/unclear');
            }

            await messageService.annotateMessage(inboundMessage._id, {
                intent: classification.intent,
                confidence: classification.confidence,
                classifierSource: classification.source,
            });
            await audit.recordClassified({
                correlationId,
                providerMessageId: message.providerMessageId,
                intent: classification.intent,
                confidence: classification.confidence,
                source: classification.source,
                entities: classification.entities,
            });
            log.info(
                {
                    intent: classification.intent,
                    confidence: classification.confidence,
                    source: classification.source,
                },
                'message classified',
            );
        }

        conversationPatch.currentIntent = classification.intent;
        // Clarify-once bookkeeping: reset on a clear intent, let the unknown
        // handler keep the running count.
        conversationPatch.clarifyAttempts =
            classification.intent === 'unknown' ? (conversation.clarifyAttempts ?? 0) : 0;

        const outcome = await handleIntent({
            intent: classification.intent,
            text: message.text,
            entities: classification.entities,
            classificationFailure: classification.failure,
            customer,
            conversation,
            correlationId,
        });

        replies = outcome.replies ?? [];
        ticketId = outcome.ticketId ?? null;
        orderId = outcome.orderId ?? null;
        Object.assign(conversationPatch, outcome.conversationPatch ?? {});

        // [8a] Order-flow lifecycle audits (T-011/T-012): an unusable slot
        // answer (failure 3) and a created order.
        if (outcome.validationFailure) {
            await audit.recordValidationFailed({
                correlationId,
                providerMessageId: message.providerMessageId,
                conversationId: String(conversation._id),
                slot: outcome.validationFailure.state,
                reason: outcome.validationFailure.reason,
                attempt: outcome.validationFailure.attempt,
            });
            log.info(outcome.validationFailure, 'slot answer rejected');
        }
        if (outcome.order) {
            orderId = outcome.order.orderId;
            await audit.recordOrderCreated({
                correlationId,
                providerMessageId: message.providerMessageId,
                conversationId: String(conversation._id),
                ...outcome.order,
            });
            log.info({ orderId }, 'order created from slot-filling flow');
        }

        // [8b] Escalation (T-013/T-014): the handler created a ticket, so
        // audit it and alert staff through the channel adapter. Notification
        // never throws - the ticket holds the outcome in notificationStatus
        // (failure 4).
        if (outcome.ticket) {
            ticketId = outcome.ticket.ticketId;
            await audit.recordTicketCreated({
                correlationId,
                ticketId: outcome.ticket.ticketId,
                conversationId: String(conversation._id),
                reason: outcome.ticket.reason,
                priority: outcome.ticket.priority,
            });
            const notification = await notifyStaffOfTicket({
                ticket: outcome.ticket,
                correlationId,
                customerPhone: customer.phone,
                log,
            });
            log.info({ ticketId, notification }, 'ticket escalated to staff');
        }
    }

    const updatedConversation = await conversationService.updateConversation(
        conversation._id,
        conversationPatch,
    );

    // [9] Send replies through the channel adapter, persist outbound
    // messages and audit each successful send.
    const sentReplies = [];
    for (const text of replies) {
        const send = await sendText(customer.phone, text);

        if (!send.ok) {
            log.error({ error: send.error }, 'reply send failed');
            continue;
        }

        await messageService.saveOutboundMessage({
            conversationId: conversation._id,
            providerMessageId: send.providerMessageId,
            text,
            intent: classification.intent,
        });
        await audit.recordReplySent({
            correlationId,
            providerMessageId: send.providerMessageId,
            conversationId: String(conversation._id),
            intent: classification.intent,
            maskedPhone: maskPhone(customer.phone),
            chars: text.length,
        });
        sentReplies.push(text);
    }

    if (sentReplies.length > 0) log.info({ count: sentReplies.length }, 'replies sent');

    // [10] Metrics are derived from the collections at read time (T-015,
    // metrics.service.js) - no counters to maintain here.

    return {
        duplicate: false,
        intent: classification.intent,
        confidence: classification.confidence,
        classifierSource: classification.source,
        replies: sentReplies,
        conversation: toConversationSummary(updatedConversation),
        ticketId,
        orderId,
    };
}
