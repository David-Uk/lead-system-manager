# T-003: Models, error handler and health endpoint
Sprint: 0 | Epic: E1 Foundation | Points: 2 | Depends on: T-002

## User story
As the team, I want all data models defined, one standard error contract and a meaningful health probe so that later endpoints stay consistent and monitoring can see exactly which dependency is broken.

## Workplan references
- Section 7 (all collections: customers, conversations, messages, orders, tickets, audit events), section 8 (error contract, 8.16 health endpoint).
- Health semantics: 503 only when Mongo is down; llm/notifier degrade without taking the API down.

## Acceptance criteria
- [x] When `GET /health` is called with Mongo up, then 200 `{status:"ok", checks:{mongo:"up", llm:"disabled", notifier:"up"}, version, uptimeSec}`; with Mongo down, then 503 `{status:"down", checks.mongo:"down"}`.
- [x] When any request completes, then `x-correlation-id` is present (given or generated) and echoed in the body of errors; audit events and logs reuse the same id.
- [x] When an error is raised, then the body is `{error:{code,message,details}, correlationId}` with codes VALIDATION_ERROR / UNAUTHORIZED / NOT_FOUND / RATE_LIMITED / INTERNAL_ERROR / DEPENDENCY_UNAVAILABLE.
- [x] When malformed JSON, a zod issue or a duplicate key arrives, then 400/400/409 respectively — never a 500.
- [x] All seven collections exist with their indexes (unique SKU, unique `providerMessageId` for dedupe, audit append-only).

## Implementation notes
- `src/models/` — customer, conversation (states), message (unique `providerMessageId`), order (`ORDER_TRANSITIONS`), ticket, audit event (14 event types) + `index.js` barrel.
- `src/utils/httpError.js` + `asyncHandler.js` — controllable errors and async route wrapping.
- `src/middleware/correlationId.js` — accepts inbound `x-correlation-id` or generates `randomUUID()`.
- `src/middleware/errorHandler.js` — single mapper: HttpError, ZodError, body-parser errors (400/413), Mongoose validation, duplicate key 11000 → 409.
- `src/controllers/health.controller.js`, `src/routes/health.routes.js` — health probe incl. version from package.json.
- `src/app.js` — correlation id → pino-http → helmet → json (captures `rawBody` for signatures) → rate limit → routes → not-found → error handler.
- `src/server.js` — listens first (health visible while connecting), graceful shutdown on SIGINT/SIGTERM with 10 s force-exit.

## Tests required
- `tests/health.test.js` — "returns 200 ok with mongo up", "returns 503 down when mongo is disconnected".
- `tests/errors.test.js` — "unknown routes return the standard 404 body with a correlation id", "malformed JSON returns 400 with a standard error body".

## Explain-it notes
- Trade-off: `/health` returns 503 only for the hard dependency (Mongo). LLM or notifier outages degrade (`degraded`) but keep serving — customers can still get price/stock answers.
- Trade-off: the server listens before the DB connects so the health endpoint itself can report "connecting" states instead of refusing connections.
- What fails first: the message unique index on `providerMessageId` is the backbone of duplicate protection (workplan failure #2) — schema-level guarantees instead of application checks.

## Status log
- 2026-10-07: Implemented all models, standard error handling with correlation ids, health endpoint and app/server bootstrap; unit tests for health and error contracts written and passing. Task done.
