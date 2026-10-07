import { z } from 'zod';
import { HttpError } from '../utils/httpError.js';

/**
 * Metrics query validation (workplan 8.15). `from`/`to` bound the reporting
 * window; when omitted the service defaults to the last 24 hours.
 */

const metricsQuerySchema = z
    .object({
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
    })
    .strict()
    .refine((query) => !query.from || !query.to || query.from <= query.to, {
        message: 'from must not be after to',
        path: ['from'],
    });

const toDetails = (error) =>
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

/** GET /api/metrics -> `req.metricsQuery`. */
export function validateMetricsQuery(req, res, next) {
    const parsed = metricsQuerySchema.safeParse(req.query);

    if (!parsed.success) {
        return next(
            new HttpError(400, 'VALIDATION_ERROR', 'Invalid metrics query', toDetails(parsed.error)),
        );
    }

    req.metricsQuery = parsed.data;
    return next();
}
