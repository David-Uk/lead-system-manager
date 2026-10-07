import { AuditEvent } from '../models/auditEvent.model.js';
import { Conversation } from '../models/conversation.model.js';
import { Message } from '../models/message.model.js';
import { Order } from '../models/order.model.js';
import { Ticket } from '../models/ticket.model.js';
import { LLM_INTENTS } from './classifier/llm.js';
import { TERMINAL_STATES } from './conversation.service.js';
import { overdueCutoff } from './ticket.service.js';

/**
 * Dashboard metrics (workplan 8.15, T-015).
 *
 * Period-scoped figures (messages, conversations, intents, classifier mix,
 * orders, escalations, response times, failure counters) come from the
 * `from`-`to` window, defaulting to the last 24 hours. The `tickets` and
 * `unresolvedConversations` blocks are live snapshots: they describe the
 * current backlog, not the window.
 *
 * Definitions, so the dashboard numbers stay explainable:
 * - totalMessages: messages stored (both directions) in the window
 * - totalConversations: conversations with at least one message in the window
 * - intentBreakdown: inbound messages classified in the window, per intent
 * - classifier: rules/llm message counts plus degraded CLASSIFIER_FALLBACK events
 * - escalationRate: tickets created / conversations with activity (0 when none)
 * - avgAutoResponseMs: MESSAGE_RECEIVED -> REPLY_SENT delta per correlation id
 * - avgFirstHumanResponseMin: ticket createdAt -> firstResponseAt, in minutes
 * - failures: audit counters (duplicates, classifier fallbacks, notification
 *   failures, validation retries)
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const FAILURE_EVENT_MAP = {
    DUPLICATE_IGNORED: 'duplicatesIgnored',
    CLASSIFIER_FALLBACK: 'llmFailures',
    NOTIFICATION_FAILED: 'notificationFailures',
    VALIDATION_FAILED: 'validationRetries',
};

/** Default reporting window: the last 24 hours. */
export function resolvePeriod({ from = null, to = null } = {}) {
    const end = to ?? new Date();
    const start = from ?? new Date(end.getTime() - DAY_MS);
    return { from: start, to: end };
}

const sumByKey = (rows) => Object.fromEntries(rows.map((row) => [row._id, row.count]));

/** Average inbound-to-reply latency, pairing audit events by correlation id. */
async function avgAutoResponseMs(window) {
    const [received, replies] = await Promise.all([
        AuditEvent.find({ type: 'MESSAGE_RECEIVED', createdAt: window })
            .select('correlationId createdAt')
            .lean(),
        AuditEvent.find({ type: 'REPLY_SENT', createdAt: window })
            .select('correlationId createdAt')
            .lean(),
    ]);

    const receivedAt = new Map(received.map((event) => [event.correlationId, event.createdAt]));

    let totalMs = 0;
    let pairs = 0;
    for (const reply of replies) {
        const startedAt = receivedAt.get(reply.correlationId);
        if (!startedAt) continue;
        totalMs += new Date(reply.createdAt).getTime() - new Date(startedAt).getTime();
        pairs += 1;
    }

    return pairs === 0 ? 0 : Math.round(totalMs / pairs);
}

/** Computes the dashboard payload for GET /api/metrics (workplan 8.15). */
export async function getMetrics({ from = null, to = null } = {}) {
    const period = resolvePeriod({ from, to });
    const window = { $gte: period.from, $lte: period.to };

    const [
        totalMessages,
        conversationIds,
        intentRows,
        classifierRows,
        ordersCreated,
        ticketsCreated,
        ticketStatusRows,
        overdue,
        unresolvedConversations,
        autoResponseMs,
        firstResponseRows,
        failureRows,
    ] = await Promise.all([
        Message.countDocuments({ createdAt: window }),
        Message.distinct('conversationId', { createdAt: window }),
        Message.aggregate([
            { $match: { direction: 'inbound', intent: { $ne: null }, createdAt: window } },
            { $group: { _id: '$intent', count: { $sum: 1 } } },
        ]),
        Message.aggregate([
            { $match: { classifierSource: { $in: ['rules', 'llm'] }, createdAt: window } },
            { $group: { _id: '$classifierSource', count: { $sum: 1 } } },
        ]),
        Order.countDocuments({ createdAt: window }),
        Ticket.countDocuments({ createdAt: window }),
        Ticket.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        Ticket.countDocuments({ status: 'open', createdAt: { $lt: overdueCutoff() } }),
        Conversation.countDocuments({ status: 'active', state: { $nin: TERMINAL_STATES } }),
        avgAutoResponseMs(window),
        Ticket.aggregate([
            { $match: { firstResponseAt: window } },
            {
                $group: {
                    _id: null,
                    avgMs: { $avg: { $subtract: ['$firstResponseAt', '$createdAt'] } },
                },
            },
        ]),
        AuditEvent.aggregate([
            { $match: { type: { $in: Object.keys(FAILURE_EVENT_MAP) }, createdAt: window } },
            { $group: { _id: '$type', count: { $sum: 1 } } },
        ]),
    ]);

    const totalConversations = conversationIds.length;

    const intentBreakdown = Object.fromEntries(LLM_INTENTS.map((intent) => [intent, 0]));
    for (const [intent, count] of Object.entries(sumByKey(intentRows))) {
        if (intent in intentBreakdown) intentBreakdown[intent] = count;
    }

    const classifierCounts = sumByKey(classifierRows);

    const failures = Object.fromEntries(Object.values(FAILURE_EVENT_MAP).map((key) => [key, 0]));
    for (const [type, count] of Object.entries(sumByKey(failureRows))) {
        failures[FAILURE_EVENT_MAP[type]] = count;
    }

    const ticketStatusCounts = { open: 0, assigned: 0, in_progress: 0, resolved: 0, closed: 0 };
    for (const [status, count] of Object.entries(sumByKey(ticketStatusRows))) {
        if (status in ticketStatusCounts) ticketStatusCounts[status] = count;
    }

    const firstResponseAvgMs = firstResponseRows[0]?.avgMs ?? null;

    return {
        period,
        totalMessages,
        totalConversations,
        intentBreakdown,
        classifier: {
            rules: classifierCounts.rules ?? 0,
            llm: classifierCounts.llm ?? 0,
            fallback: failures.llmFailures,
        },
        ordersCreated,
        escalationRate:
            totalConversations === 0
                ? 0
                : Math.round((ticketsCreated / totalConversations) * 100) / 100,
        tickets: { ...ticketStatusCounts, overdue },
        unresolvedConversations,
        avgAutoResponseMs: autoResponseMs,
        avgFirstHumanResponseMin:
            firstResponseAvgMs === null
                ? 0
                : Math.round((firstResponseAvgMs / 60_000) * 10) / 10,
        failures,
    };
}
