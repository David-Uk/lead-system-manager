# T-013: Ticket service and staff endpoints
Sprint: 3 | Epic: E5 Escalation and WhatsApp | Points: 3 | Depends on: T-012

## User story
As a manager, I want every unsafe conversation (complaint, refund, AI outage, repeated bad data, explicit human request) to become a referenced ticket I can list and update through a key-protected API, so that escalations are tracked, prioritised and never lost between chat and staff.

## Workplan references
- Section 5.3 (ticket lifecycle: transitions, SLA), section 7 (`tickets` collection, `conversation.state`), endpoints 8.9 (list), 8.10 (detail + conversation) and 8.11 (PATCH); the ESCALATE step of the pipeline (section 4).

## Acceptance criteria
- [x] Given a complaint/refund message, when the pipeline handles it, then a ticket exists (reason `complaint`|`refund`, priority `high`, status `open`, summary = customer text), `TICKET_CREATED` is audited and the reply quotes the `TKT-` reference.
- [x] Given repeated unusable answers, an explicit human request, or a classifier outage, when escalation triggers (slot machine or unknown-intent second miss), then a ticket is created with reason `invalid_data` / `customer_requested` / `ai_unavailable`|`unknown_intent` and the reply quotes the reference.
- [x] Given GET /api/tickets with `status`, `priority`, `assignee`, `overdue`, `limit`, `page`, when called with a staff key, then `{data, page, limit, total}` newest-first; `overdue=true` returns only `open` tickets older than `TICKET_SLA_MINUTES`.
- [x] Given GET /api/tickets/:ticketId (any case), when the ticket exists, then the ticket plus its customer and the last 20 conversation messages (oldest first) are returned; unknown -> 404 `NOT_FOUND`.
- [x] Given PATCH /api/tickets/:ticketId with a legal transition (open -> assigned|closed, assigned -> in_progress|resolved|closed, in_progress -> resolved|closed, resolved -> closed), when called, then the ticket updates, the first assignment sets `firstResponseAt`, resolving requires and stores `resolutionNote`, `resolvedAt` is set and `TICKET_UPDATED` is audited with from/to/assignee/note; an illegal jump -> 400; a repeated value -> idempotent no-op (no audit event).
- [x] Given no/incorrect `x-api-key`, when any tickets route is called, then 401 `UNAUTHORIZED`.
- [x] Given a bad query/body, when validated, then 400 `VALIDATION_ERROR` with per-field details (`open` is not a PATCHable target).

## Implementation notes
- `src/models/ticket.model.js` - reason/priority/status/notification enums + `TICKET_TRANSITIONS`.
- `src/services/ticket.service.js` - `createTicket` (global `TKT-####` sequence with E11000 re-read/retry), `listTickets`, `canTransition`, `overdueCutoff`, `isOverdue`, `applyTicketUpdate`, `setNotificationStatus`.
- `src/services/intentHandlers.js` / `slotFilling.service.js` - escalation points create the Ticket so replies can quote the reference (handlers stay HTTP-free).
- `src/services/pipeline.service.js` - audits `TICKET_CREATED`, then notifies staff (T-014), then sends the reply.
- `src/routes/tickets.routes.js`, `src/controllers/tickets.controller.js`, `src/validators/tickets.validator.js`; mounted at `/api/tickets`.
- `src/services/audit.service.js` - `recordTicketCreated`, `recordTicketUpdated`; `src/utils/templates.js` - complaint/holding/handoff replies.

## Tests required
- `tests/tickets.test.js` (18): auth 401s; list ordering + full shape; status/priority/assignee filters; overdue filter both ways; pagination; query validation; detail with customer + conversation oldest-first; case-insensitive reference + 404; PATCH assign (firstResponseAt + audit), idempotent no-op, open -> assigned, illegal jump 400 + no mutation, resolve-needs-note, full walk with audit from/to sequence, 404, body validation.
- `tests/intentHandlers.test.js` / `tests/slotFilling.test.js` - escalation tests upgraded to assert ticket details, `notificationStatus` and the `TICKET_CREATED`/`NOTIFICATION_SENT` audits (T5, T8, failure 3 paths).

## Explain-it notes
- Trade-off: ticket IDs are a global `TKT-0001` sequence (unique index + retry) instead of per-day - tickets are low-volume and staff quote the ID verbatim on the phone; the daily `ORD-` format fits order volume, not this.
- Trade-off: `overdue` is derived at read time from `createdAt` + `TICKET_SLA_MINUTES`, never stored - no cron job, no stale flags; changing the SLA re-labels history honestly.
- Trade-off: a repeated status in PATCH is a 200 no-op with no audit event - retries are safe and the trail records changes, not noise (same discipline as the orders API).
- What fails first: the transition table - staff cannot jump `open` -> `in_progress` or reopen `closed`; the API answers 400 naming the current and target state.

## Status log
- 2026-10-07: model transitions, ticket service, escalation wiring (complaint/refund, unknown second miss, invalid-data retries, human request), staff endpoints + 18 tests landed; suite green. Live e2e: complaint created TKT-0001 (priority high, `notificationStatus: sent`), PATCH assigned set `firstResponseAt`, and the audit trail showed MESSAGE_RECEIVED -> CLASSIFIED -> TICKET_CREATED -> NOTIFICATION_SENT -> REPLY_SENT -> TICKET_UPDATED for the journey. Task done.
