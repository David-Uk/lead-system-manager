import { z } from 'zod';
import { HttpError } from '../utils/httpError.js';
import { AUDIT_ENTITY_TYPES, AUDIT_EVENT_TYPES } from '../models/auditEvent.model.js';
import { decodeCursor } from '../services/audit.service.js';

/**
 * Audit query validation (workplan 8.14). `cursor` is an opaque page token;
 * it is decoded here so a malformed token is a 400 VALIDATION_ERROR instead
 * of a database cast error. `limit` caps at 200 as specified.
 */

const auditQuerySchema = z
    .object({
        type: z.enum(AUDIT_EVENT_TYPES).optional(),
        entityType: z.enum(AUDIT_ENTITY_TYPES).optional(),
        entityId: z.string().min(1).max(120).optional(),
        correlationId: z.string().min(1).max(120).optional(),
        from: z.coerce.date().optional(),
        to: z.coerce.date().optional(),
        limit: z.coerce.number().int().min(1).max(200).default(20),
        cursor: z.string().min(1).max(500).optional(),
    })
    .strict()
    .refine((query) => !query.from || !query.to || query.from <= query.to, {
        message: 'from must not be after to',
        path: ['from'],
    });

const toDetails = (error) =>
    error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }));

/** GET /api/audit -> `req.auditQuery`. */
export function validateAuditQuery(req, res, next) {
    const parsed = auditQuerySchema.safeParse(req.query);

    if (!parsed.success) {
        return next(
            new HttpError(400, 'VALIDATION_ERROR', 'Invalid audit query', toDetails(parsed.error)),
        );
    }

    if (parsed.data.cursor) {
        try {
            decodeCursor(parsed.data.cursor);
        } catch {
            return next(new HttpError(400, 'VALIDATION_ERROR', 'Invalid audit cursor'));
        }
    }

    req.auditQuery = parsed.data;
    return next();
}
