import { z } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../models/ticket.model.js';

/**
 * Ticket staff API validation (workplan 8.9-8.11).
 *
 * `overdue` arrives as the string 'true'/'false' from the query string and
 * is narrowed to a boolean. `open` is not a valid PATCH target: it is the
 * initial state, not a staff transition.
 */

const PATCHABLE_STATUSES = TICKET_STATUSES.filter((status) => status !== 'open');

const listTicketsQuerySchema = z
    .object({
        status: z.enum(TICKET_STATUSES).optional(),
        priority: z.enum(TICKET_PRIORITIES).optional(),
        assignee: z.string().min(1).max(100).optional(),
        overdue: z
            .enum(['true', 'false'])
            .transform((value) => value === 'true')
            .optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        page: z.coerce.number().int().min(1).default(1),
    })
    .strict();

const updateTicketBodySchema = z
    .object({
        status: z.enum(PATCHABLE_STATUSES).optional(),
        assignee: z.string().min(1).max(100).optional(),
        resolutionNote: z.string().min(1).max(1000).optional(),
    })
    .strict()
    .refine((body) => body.status || body.assignee || body.resolutionNote, {
        message: 'at least one of status, assignee or resolutionNote is required',
    })
    .refine((body) => body.status !== 'resolved' || Boolean(body.resolutionNote), {
        message: 'resolutionNote is required when resolving a ticket',
        path: ['resolutionNote'],
    });

const toDetails = (error) =>
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

/** GET /api/tickets -> `req.ticketsQuery`. */
export function validateListTicketsQuery(req, res, next) {
    const parsed = listTicketsQuerySchema.safeParse(req.query);

    if (!parsed.success) {
        return next(
            new HttpError(400, 'VALIDATION_ERROR', 'Invalid tickets query', toDetails(parsed.error)),
        );
    }

    req.ticketsQuery = parsed.data;
    return next();
}

/** PATCH /api/tickets/:ticketId -> `req.ticketUpdate`. */
export function validateUpdateTicketBody(req, res, next) {
    const parsed = updateTicketBodySchema.safeParse(req.body);

    if (!parsed.success) {
        return next(
            new HttpError(400, 'VALIDATION_ERROR', 'Invalid ticket update', toDetails(parsed.error)),
        );
    }

    req.ticketUpdate = parsed.data;
    return next();
}
