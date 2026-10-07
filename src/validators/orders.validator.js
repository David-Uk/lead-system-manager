import { z } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { ORDER_STATUSES } from '../models/order.model.js';

/**
 * Order staff API validation (workplan 8.6-8.8).
 *
 * Query strings and JSON bodies arrive as loose strings, so numbers and
 * dates are coerced before the strict checks run; both schemas reject
 * unknown keys.
 */

const listOrdersQuerySchema = z
    .object({
        status: z.enum(ORDER_STATUSES).optional(),
        phone: z.string().min(1).max(20).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        page: z.coerce.number().int().min(1).default(1),
    })
    .strict();

const updateOrderBodySchema = z
    .object({
        status: z.enum(ORDER_STATUSES),
        note: z.string().min(1).max(500).optional(),
    })
    .strict();

const toDetails = (error) =>
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

/** GET /api/orders -> `req.ordersQuery`. */
export function validateListOrdersQuery(req, res, next) {
    const parsed = listOrdersQuerySchema.safeParse(req.query);

    if (!parsed.success) {
        return next(
            new HttpError(400, 'VALIDATION_ERROR', 'Invalid orders query', toDetails(parsed.error)),
        );
    }

    req.ordersQuery = parsed.data;
    return next();
}

/** PATCH /api/orders/:orderId -> `req.orderUpdate`. */
export function validateUpdateOrderBody(req, res, next) {
    const parsed = updateOrderBodySchema.safeParse(req.body);

    if (!parsed.success) {
        return next(
            new HttpError(400, 'VALIDATION_ERROR', 'Invalid order update', toDetails(parsed.error)),
        );
    }

    req.orderUpdate = parsed.data;
    return next();
}
