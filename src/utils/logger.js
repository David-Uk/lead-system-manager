import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Shared structured logger (pino).
 *
 * Secrets and signature headers are redacted so they can never end up in the
 * log stream. Correlation ids are attached by pino-http via `req.id` (see
 * src/middleware/correlationId.js) or manually with `logger.child()`.
 */
export const logger = pino({
    level: env.LOG_LEVEL,
    base: {
        service: 'lead-system-manager',
        env: env.NODE_ENV,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
        paths: [
            'req.headers["x-api-key"]',
            'req.headers.authorization',
            'req.headers["x-hub-signature-256"]',
        ],
        censor: '[REDACTED]',
    },
});

/**
 * Returns a child logger bound to the given context (e.g. a correlation id).
 */
export function childLogger(bindings) {
    return logger.child(bindings);
}
