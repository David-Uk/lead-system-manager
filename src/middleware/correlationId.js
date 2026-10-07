import { randomUUID } from 'node:crypto';

/**
 * Attaches a correlation id to every request. The id is:
 *  - stored on `req.id` (pino-http picks it up for log lines),
 *  - passed down to services and audit events,
 *  - returned in the `x-correlation-id` response header (workplan 8).
 */
export function correlationId(req, res, next) {
    req.id = randomUUID();
    res.setHeader('x-correlation-id', req.id);
    next();
}
