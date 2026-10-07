import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { logger } from '../utils/logger.js';

/** 404 for unmatched routes, in the standard error body shape. */
export function notFoundHandler(req, res, next) {
    next(new HttpError(404, 'NOT_FOUND', `Route ${req.method} ${req.originalUrl} not found`));
}

/**
 * Central error handler. Produces the standard error body:
 *   { error: { code, message, details }, correlationId }
 * and maps Zod / Mongoose errors onto VALIDATION_ERROR responses.
 */
export function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        return next(err);
    }

    let statusCode = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';
    let details = [];

    if (err instanceof HttpError) {
        statusCode = err.statusCode;
        code = err.code;
        message = err.message;
        details = err.details;
    } else if (err instanceof ZodError) {
        statusCode = 400;
        code = 'VALIDATION_ERROR';
        message = 'Request validation failed';
        details = err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
        }));
    } else if (
        err?.expose === true &&
        typeof err?.status === 'number' &&
        err.status >= 400 &&
        err.status < 500
    ) {
        // body-parser errors: malformed JSON, payload too large, bad charset...
        statusCode = err.status;
        code = 'VALIDATION_ERROR';
        message = err.status === 413 ? 'Request payload too large' : err.message;
    } else if (err?.name === 'ValidationError' && err.errors) {
        // Mongoose schema validation
        statusCode = 400;
        code = 'VALIDATION_ERROR';
        message = 'Document validation failed';
        details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
    } else if (err?.name === 'CastError') {
        statusCode = 400;
        code = 'VALIDATION_ERROR';
        message = `Invalid value for ${err.path}`;
    } else if (err?.code === 11000) {
        statusCode = 400;
        code = 'VALIDATION_ERROR';
        message = 'Duplicate value';
        details = [{ path: Object.keys(err.keyPattern ?? {}).join(','), message: 'already exists' }];
    } else if (env.NODE_ENV !== 'production') {
        message = err?.message || message;
    }

    const logPayload = { err, correlationId: req.id, statusCode, code };
    if (statusCode >= 500) {
        logger.error(logPayload, 'request failed');
    } else {
        logger.warn(logPayload, 'request rejected');
    }

    res.status(statusCode).json({
        error: { code, message, details },
        correlationId: req.id,
    });
}
