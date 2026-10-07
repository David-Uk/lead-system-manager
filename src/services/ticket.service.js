import { Ticket, TICKET_TRANSITIONS } from '../models/ticket.model.js';
import { env } from '../config/env.js';

/**
 * Ticket domain service (workplan 7 `tickets`, T-013).
 *
 * Tickets are created whenever the pipeline cannot answer safely (complaint,
 * refund, repeated invalid data, AI outage, unclear message...) and picked up
 * by staff through /api/tickets. HTTP concerns (status codes, error shaping)
 * stay in the controller - this module only touches documents.
 *
 * `overdue` is derived at read time (status `open` longer than
 * TICKET_SLA_MINUTES), never stored - workplan 5.3.
 */

/** Summary text is staff-facing copy: clamp it at creation time. */
const SUMMARY_MAX_CHARS = 300;

/** Default priority per escalation reason (the workplan only fixes the enum). */
export const REASON_PRIORITIES = {
    complaint: 'high',
    refund: 'high',
    customer_requested: 'high',
    low_confidence: 'normal',
    ai_unavailable: 'normal',
    invalid_data: 'normal',
    unknown_intent: 'normal',
};

/**
 * Creates a ticket with a human-readable reference, TKT-0001 style (global
 * sequence). The daily order style does not fit tickets, which are low
 * volume and referenced verbatim by staff. The unique index on `ticketId`
 * is the backstop when two escalations race the counter, in which case the
 * sequence is re-read and retried.
 *
 * @returns {Promise<object>} the created ticket (status open, notification pending)
 */
export async function createTicket({
    conversationId = null,
    customerId = null,
    reason,
    priority = null,
    summary,
}) {
    const cleanSummary = String(summary ?? '').trim().slice(0, SUMMARY_MAX_CHARS);

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const sequence = (await Ticket.countDocuments({})) + 1;

        try {
            return await Ticket.create({
                ticketId: `TKT-${String(sequence).padStart(4, '0')}`,
                conversationId,
                customerId,
                reason,
                priority: priority ?? REASON_PRIORITIES[reason] ?? 'normal',
                summary: cleanSummary,
            });
        } catch (err) {
            if (err?.code !== 11000) throw err;
            // Same sequence as a concurrent insert - re-read the count and retry.
        }
    }

    throw new Error('could not allocate a ticket id');
}

/** @returns {Promise<object|null>} the ticket with this reference, if any */
export async function findTicketByTicketId(ticketId) {
    if (!ticketId) return null;
    return Ticket.findOne({ ticketId: String(ticketId).trim().toUpperCase() });
}

/** True when `to` is a legal next status for `from` (workplan 5.3). */
export function canTransition(from, to) {
    return Boolean(TICKET_TRANSITIONS[from]?.includes(to));
}

/** Workplan 5.3: tickets `open` for longer than the SLA are overdue. */
export function overdueCutoff(now = new Date()) {
    return new Date(now.getTime() - env.TICKET_SLA_MINUTES * 60_000);
}

/** Derived SLA flag - `open` and older than TICKET_SLA_MINUTES. */
export function isOverdue(ticket, now = new Date()) {
    if (ticket.status !== 'open') return false;
    return new Date(ticket.createdAt).getTime() < overdueCutoff(now).getTime();
}

/**
 * Staff listing behind GET /api/tickets (workplan 8.9). `overdue` is a
 * boolean filter: true = only open tickets past the SLA, false = everything
 * else.
 *
 * @returns {Promise<{data: Array<object>, page: number, limit: number, total: number}>}
 */
export async function listTickets({
    status = null,
    priority = null,
    assignee = null,
    overdue = null,
    page = 1,
    limit = 20,
} = {}) {
    const conditions = [];
    if (status) conditions.push({ status });
    if (priority) conditions.push({ priority });
    if (assignee) conditions.push({ assignee });
    if (overdue === true) {
        conditions.push({ status: 'open', createdAt: { $lt: overdueCutoff() } });
    }
    if (overdue === false) {
        conditions.push({
            $or: [{ status: { $ne: 'open' } }, { createdAt: { $gte: overdueCutoff() } }],
        });
    }
    const query = conditions.length > 0 ? { $and: conditions } : {};

    const total = await Ticket.countDocuments(query);
    const data = await Ticket.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

    return { data, page, limit, total };
}

/**
 * Applies a staff update (workplan 8.11) and saves only when something
 * actually changed - an idempotent PATCH is a no-op the caller can skip
 * auditing. The caller (controller) enforces the transition table first.
 *
 * Sets `firstResponseAt` on the first assignment (assignee set or moved to
 * `assigned`) and `resolvedAt` on resolve.
 *
 * @returns {Promise<{changed: boolean, previousAssignee: string|null}>}
 */
export async function applyTicketUpdate(ticket, { status = null, assignee = null, resolutionNote = null }) {
    const previousAssignee = ticket.assignee;
    const now = new Date();
    let changed = false;

    if (status && status !== ticket.status) {
        ticket.status = status;
        if (status === 'assigned' && !ticket.firstResponseAt) ticket.firstResponseAt = now;
        if (status === 'resolved' && !ticket.resolvedAt) ticket.resolvedAt = now;
        changed = true;
    }

    if (assignee && assignee !== ticket.assignee) {
        ticket.assignee = assignee;
        if (!ticket.firstResponseAt) ticket.firstResponseAt = now;
        changed = true;
    }

    if (resolutionNote && resolutionNote !== ticket.resolutionNote) {
        ticket.resolutionNote = resolutionNote;
        changed = true;
    }

    if (changed) await ticket.save();
    return { changed, previousAssignee };
}

/** Records the outcome of the staff notification (T-014) on the ticket. */
export async function setNotificationStatus(ticket, notificationStatus) {
    ticket.notificationStatus = notificationStatus;
    return ticket.save();
}
