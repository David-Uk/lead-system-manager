---
kind: error_handling
name: Express Error Handling with HttpError, asyncHandler, and Centralized errorHandler Middleware
category: error_handling
scope:
    - '**'
source_files:
    - src/utils/httpError.js
    - src/middleware/errorHandler.js
    - src/utils/asyncHandler.js
    - tests/errors.test.js
---

# Error Handling in Lead System Manager

## Approach

The application uses a layered Express.js error-handling strategy built around three core pieces:

1. A domain-specific `HttpError` class that carries an HTTP status code, a stable API error `code`, a human-readable `message`, and optional `details`.
2. An `asyncHandler` wrapper that forwards rejected promises from async route handlers to Express's error middleware (required because Express 4 does not catch async rejections).
3. A centralized `errorHandler` middleware that normalizes all errors into a single JSON body shape and logs them via the structured logger.

There is no global `uncaughtException` / `unhandledRejection` listener; unhandled promise rejections are expected to surface as process crashes during development, while production relies on the container orchestrator to restart the process.

## Key Files

- `src/utils/httpError.js` — defines `HttpError` and factory helpers (`badRequest`, `unauthorized`, `notFound`, `rateLimited`).
- `src/middleware/errorHandler.js` — central Express error handler + `notFoundHandler` for unmatched routes.
- `src/utils/asyncHandler.js` — wraps async route handlers so rejections flow to `errorHandler`.
- `tests/errors.test.js` — verifies the standard error response contract (status, `error.code`, `correlationId` format).

## Architecture and Conventions

### The `HttpError` type

```js
export class HttpError extends Error {
  constructor(statusCode, code, message, details = [])
}
```

It exposes four fields: `statusCode` (number), `code` (string), `message` (string), `details` (array of `{ path, message }`). Factory helpers map common cases to stable codes:

| Helper | Status | Code |
|---|---:|---|
| `badRequest` | 400 | `VALIDATION_ERROR` |
| `unauthorized` | 401 | `UNAUTHORIZED` |
| `notFound` | 404 | `NOT_FOUND` |
| `rateLimited` | 429 | `RATE_LIMITED` |

The comment in `httpError.js` references workplan section 8, which enumerates the canonical set of error codes: `VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`, `DEPENDENCY_UNAVAILABLE`. In practice, only the first five are currently used by the implementation.

### Standard error response body

All responses produced by `errorHandler` follow this shape:

```json
{
  "error": { "code": "...", "message": "...", "details": [...] },
  "correlationId": "<uuid>"
}
```

The `x-correlation-id` response header mirrors `req.id` (set by `middleware/correlationId.js`), and tests assert they match.

### Centralized mapping logic

`errorHandler` inspects the thrown value in this order:

1. `err instanceof HttpError` → use its `statusCode`, `code`, `message`, `details`.
2. `err instanceof ZodError` → 400 / `VALIDATION_ERROR`, flattening `err.issues` into `{ path, message }` pairs.
3. `body-parser` style errors where `err.expose === true` and `400 ≤ err.status < 500` → mapped to `VALIDATION_ERROR` (with a special message for 413 payload-too-large).
4. Mongoose `ValidationError` (`err.name === 'ValidationError'`) → 400 / `VALIDATION_ERROR`, iterating `err.errors`.
5. Mongoose `CastError` → 400 / `VALIDATION_ERROR` with `Invalid value for <path>`.
6. MongoDB duplicate-key `err.code === 11000` → 400 / `VALIDATION_ERROR` with the conflicting field(s) listed in `details.path`.
7. Fallback → 500 / `INTERNAL_ERROR`; in non-production environments the raw `err.message` is exposed to the client.

### Logging convention

Errors are logged through `utils/logger.js` with a level derived from the status code:

- `statusCode >= 500` → `logger.error(logPayload, 'request failed')`
- otherwise → `logger.warn(logPayload, 'request rejected')`

The log payload always includes `{ err, correlationId: req.id, statusCode, code }`.

### Route-level usage

Route handlers throw `HttpError` instances directly (e.g. `throw badRequest(...)`, `throw unauthorized(...)`). Async handlers are wrapped with `asyncHandler` so that any rejected promise is forwarded to `errorHandler` via `next(err)`. This pattern is documented in the JSDoc comment on `asyncHandler`: "Required because Express 4 does not catch async errors."

### Unmatched routes

A dedicated `notFoundHandler` throws `new HttpError(404, 'NOT_FOUND', ...)` rather than relying on Express's default behavior, ensuring the same standardized body and logging.

## Conventions and Constraints

- **Throw `HttpError` instead of plain `Error`** for any controller/service error that maps to an HTTP response. The `errorHandler` only recognizes `HttpError` by `instanceof`; throwing a bare `Error` falls through to the fallback 500 path.
- **Use the stable `code` strings** (`VALIDATION_ERROR`, `UNAUTHORIZED`, `NOT_FOUND`, `RATE_LIMITED`, `INTERNAL_ERROR`, `DEPENDENCY_UNAVAILABLE`) rather than ad-hoc messages when constructing `HttpError`. The comment in `httpError.js` documents this as the canonical set.
- **Wrap every async route handler** with `asyncHandler` so promise rejections reach the error pipeline. This is enforced by the helper's own JSDoc comment stating it is required for Express 4.
- **Never call `res.json` inside a route handler after an error has been thrown**; let `errorHandler` produce the response. The handler checks `res.headersSent` and delegates to `next(err)` if headers were already sent, preventing double-response crashes.
- **Expose raw error messages only in non-production**: the `env.NODE_ENV !== 'production'` branch is the sole place where `err.message` leaks into the client response.
- **Validation-related errors** (Zod, body-parser, Mongoose validation/cast/duplicate-key) are normalized to `VALIDATION_ERROR` with a `details` array of `{ path, message }` entries, making client-side error rendering uniform.
- **Every error response includes a `correlationId`** matching the `x-correlation-id` response header, enabling request tracing across services.

## Test Coverage

`tests/errors.test.js` asserts the two canonical error paths without a database:

- Unknown routes return 404 with `error.code === 'NOT_FOUND'`, an empty `details` array, and a UUID-format `correlationId`.
- Malformed JSON payloads return 400 with `error.code === 'VALIDATION_ERROR'` and a present `x-correlation-id` header.

These assertions enforce the public contract of the error response shape.