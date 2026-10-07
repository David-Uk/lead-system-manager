/**
 * Error type that carries the HTTP status and the standard API error code
 * (workplan section 8: VALIDATION_ERROR, UNAUTHORIZED, NOT_FOUND,
 * RATE_LIMITED, INTERNAL_ERROR, DEPENDENCY_UNAVAILABLE).
 */
export class HttpError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code
   * @param {string} message
   * @param {Array<{path: string, message: string}>} [details]
   */
  constructor(statusCode, code, message, details = []) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message, code = 'VALIDATION_ERROR', details = []) =>
  new HttpError(400, code, message, details);

export const unauthorized = (message = 'Unauthorized') => new HttpError(401, 'UNAUTHORIZED', message);

export const notFound = (message = 'Not found') => new HttpError(404, 'NOT_FOUND', message);

export const rateLimited = (message = 'Too many requests') =>
  new HttpError(429, 'RATE_LIMITED', message);
