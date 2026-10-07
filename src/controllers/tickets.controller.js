import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import * as audit from '../services/audit.service.js';
import { findConversationById } from '../services/conversation.service.js';
import { findCustomerById } from '../services/customer.service.js';
import { listRecentMessages } from '../services/message.service.js';
import {
    applyTicketUpdate,
    canTransition,
    findTicketByTicketId,
    isOverdue,
    listTickets,
} from '../services/ticket.service.js';

/**
 * Staff ticket API (workplan 8.9-8.11). Authentication and validation run
 * as middleware; this controller enforces the transition table, derives the
 * SLA flag and shapes the JSON.
 */

/** Stable ticket JSON - `overdue` is derived at read time (workplan 5.3). */
function toTicketResponse(ticket) {
    return {
        ticketId: ticket.ticketId,
        reason: ticket.reason,
        priority: ticket.priority,
        status: ticket.status,
        assignee: ticket.assignee,
        summary: ticket.summary,
        notificationStatus: ticket.notificationStatus,
        overdue: isOverdue(ticket),
        resolutionNote: ticket.resolutionNote,
        firstResponseAt: ticket.firstResponseAt,
        resolvedAt: ticket.resolvedAt,
        conversationId: ticket.conversationId ? String(ticket.conversationId) : null,
        customerId: ticket.customerId ? String(ticket.customerId) : null,
        createdAt: ticket.createdAt,
    };
}

/** Message summary shape shared with the conversation views (workplan 8.13). */
function toMessageResponse(message) {
    return {
        direction: message.direction,
        text: message.text,
        intent: message.intent ?? null,
        confidence: message.confidence ?? null,
        classifierSource: message.classifierSource ?? null,
        createdAt: message.createdAt,
    };
}

/** GET /api/tickets - newest first, filtered and paginated (workplan 8.9). */
export const getTickets = asyncHandler(async (req, res) => {
    const { data, page, limit, total } = await listTickets(req.ticketsQuery);

    res.status(200).json({
        data: data.map(toTicketResponse),
        page,
        limit,
        total,
    });
});

/**
 * GET /api/tickets/:ticketId (workplan 8.10) - the ticket plus the last 20
 * conversation messages so staff can triage without leaving the dashboard.
 * `customer` is an additive convenience field for call-backs (the workplan
 * only mandates `conversation`).
 */
export const getTicket = asyncHandler(async (req, res) => {
    const ticket = await findTicketByTicketId(req.params.ticketId);

    if (!ticket) {
        throw new HttpError(404, 'NOT_FOUND', `Unknown ticket ${req.params.ticketId}`);
    }

    const conversation = ticket.conversationId
        ? await findConversationById(ticket.conversationId)
        : null;
    const customer = ticket.customerId ? await findCustomerById(ticket.customerId) : null;
    const messages = conversation ? await listRecentMessages(conversation._id, 20) : [];

    res.status(200).json({
        ...toTicketResponse(ticket),
        customer: customer ? { phone: customer.phone, name: customer.name ?? null } : null,
        conversation: messages.map(toMessageResponse),
    });
});

/**
 * PATCH /api/tickets/:ticketId - status/assignee/resolution (workplan 8.11).
 * A repeated status is an idempotent no-op; an illegal jump is a 400. The
 * change is audited as TICKET_UPDATED.
 */
export const patchTicket = asyncHandler(async (req, res) => {
    const { status = null, assignee = null, resolutionNote = null } = req.ticketUpdate;
    const ticket = await findTicketByTicketId(req.params.ticketId);

    if (!ticket) {
        throw new HttpError(404, 'NOT_FOUND', `Unknown ticket ${req.params.ticketId}`);
    }

    const from = ticket.status;
    if (status && status !== from && !canTransition(from, status)) {
        throw new HttpError(
            400,
            'VALIDATION_ERROR',
            `Cannot move ticket ${ticket.ticketId} from ${from} to ${status}`,
        );
    }

    const { changed } = await applyTicketUpdate(ticket, { status, assignee, resolutionNote });

    if (changed) {
        await audit.recordTicketUpdated({
            correlationId: req.id,
            ticketId: ticket.ticketId,
            from,
            to: ticket.status,
            assignee: ticket.assignee ?? null,
            resolutionNote,
        });
    }

    res.status(200).json(toTicketResponse(ticket));
});
