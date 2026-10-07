# T-012: Order creation and API
Sprint: 2 | Epic: E4 Intent Handlers | Points: 3 | Depends on: T-011

## User story
As a manager, I want to list and update customer orders through a key-protected API - with the same lifecycle rules the chatbot follows - so that the shop can confirm, dispatch and deliver without touching the database.

## Workplan references
- Section 7 (`orders` collection); endpoints 8.6 (list), 8.7 (single) and 8.8 (PATCH transitions); the transition table in `order.model.js`.

## Acceptance criteria
- [x] Given the slot-filling machine completes, when CONFIRM is answered yes, then an order exists with a human-readable `orderId` (`ORD-YYYYMMDD-####`), item snapshots, computed `totalNGN`, the address, the contact phone, `conversationId`, and status `pending_confirmation`; audit `ORDER_CREATED`.
- [x] Given concurrent order creations on one day, when they race the sequence counter, then the unique index on `orderId` triggers a re-read and retry - references never collide.
- [x] Given GET /api/orders with `status`, `phone`, `from`, `to`, `limit`, `page`, when called with a staff key, then it returns `{data, page, limit, total}` newest-first; `phone` accepts any Nigerian shape (e.g. `0801...`) and is normalised.
- [x] Given GET /api/orders/:orderId (any case), when the reference exists, then the full order is returned; unknown -> 404 `NOT_FOUND`.
- [x] Given PATCH /api/orders/:orderId with a legal transition (`pending_confirmation` -> `confirmed`/`cancelled`, `confirmed` -> `dispatched`/`cancelled`, `dispatched` -> `delivered`), when called, then the order updates and `ORDER_UPDATED` is audited with from/to/note; an illegal jump -> 400 `VALIDATION_ERROR`.
- [x] Given a repeated status, when PATCHed, then it is an idempotent no-op (no duplicate audit event).
- [x] Given no/incorrect `x-api-key`, when any orders route is called, then 401 `UNAUTHORIZED` (constant-time comparison).
- [x] Given a bad query/body, when validated, then 400 `VALIDATION_ERROR` with per-field details.

## Implementation notes
- `src/routes/orders.routes.js` - `router.use(requireApiKey)`; `GET /`, `GET /:orderId`, `PATCH /:orderId`; mounted at `/api/orders` in `src/routes/index.js`.
- `src/controllers/orders.controller.js` - transition enforcement via `canTransition`, 404/400 mapping, `toOrderResponse` shape (no Mongoose internals leak), `ORDER_UPDATED` audit with `req.id` as correlationId.
- `src/validators/orders.validator.js` - Zod schemas (strict): enum filters, coerced limit/page/date range; unknown keys rejected.
- `src/services/order.service.js` - `createOrder`, `listOrders`, `canTransition`, `updateOrderStatus`; HTTP-free, testable.
- `src/services/audit.service.js` - `recordOrderCreated`, `recordOrderUpdated`, `recordValidationFailed`.

## Tests required
- `tests/orders.test.js` (10): auth 401; list sorting + pagination metadata; status/phone/date filters; invalid status filter; single fetch (case-insensitive); 404; legal transition + audit detail; illegal transition 400 + no mutation; idempotent no-op; body validation.
- `tests/slotFilling.test.js` (8) covers the creation side end to end (T3 + order document + audit chain).

## Explain-it notes
- Trade-off: the staff note on PATCH lives in the `ORDER_UPDATED` audit detail instead of the order document - the order stays the operational record, the audit trail is the narrative.
- Trade-off: `phone` filtering normalises to the stored E.164 form; raw strings that cannot be normalised fall back to exact match (honest empty result over fuzzy guessing).
- Trade-off: same-status PATCH returns 200 without an audit event - retries are safe and the trail records changes, not noise.
- What fails first: workflow discipline - an operator trying to jump `pending_confirmation` -> `delivered` gets a 400 naming the current and target status; the order lifecycle is the confirmation path, not a free-form field.

## Status log
- 2026-10-07: order service, routes/controller/validator, audits and 10 API tests landed; full suite 84/84 green; live e2e created `ORD-20261007-0001` via chat, found it with `GET /api/orders?phone=08012345678`, then PATCHed confirmed -> (illegal delivered blocked 400) -> dispatched with two `ORDER_UPDATED` audit events. Task done.
