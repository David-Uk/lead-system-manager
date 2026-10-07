/**
 * Wraps an async Express handler so rejected promises are forwarded to the
 * error handler. Required because Express 4 does not catch async errors.
 *
 * @param {import('express').RequestHandler} fn
 * @returns {import('express').RequestHandler}
 */
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};
