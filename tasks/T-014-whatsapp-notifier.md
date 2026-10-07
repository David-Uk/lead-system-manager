# T-014: WhatsApp staff notifier
Sprint: 3 | Epic: E5 Escalation and WhatsApp | Points: 3 | Depends on: T-013

## User story
As a support agent, I want a WhatsApp alert for every new ticket on the staff number, so that escalations reach a phone even when nobody is watching the dashboard - with retries and a visible failure state when delivery dies.

## Workplan references
- Failure 4 (staff notification), pipeline ESCALATE step; `docs/DECISIONS.md` "WhatsApp Override" - staff alerts go through the WhatsApp adapter to `STAFF_WHATSAPP_NUMBER` (Telegram is ignored).
- Message copy lives in `src/utils/templates.js` (`staffTicketAlert`), per workplan section 6.

## Acceptance criteria
- [x] Given a ticket is created, when the pipeline finishes escalation, then the alert (`New HIGH ticket TKT-…`, customer phone, summary, "Pick it up…") is sent to `STAFF_WHATSAPP_NUMBER` through the adapter; in simulated mode it is logged to stdout and `logs/whatsapp-outbound.log`.
- [x] Given the first send succeeds, when notified, then the ticket's `notificationStatus` becomes `sent` and `NOTIFICATION_SENT` is audited with channel, masked `to` and attempts.
- [x] Given send failures, when retrying, then up to 3 attempts fire with exponential backoff (defaults 250 ms / 500 ms); a later success records the successful attempt number.
- [x] Given every attempt fails, when giving up, then the ticket is flagged `failed`, `NOTIFICATION_FAILED` is audited with the last error and attempts=3, and the pipeline continues - the notifier never throws (the ticket already exists by then).
- [x] Given staff notifications touch logs/audit, when destinations are recorded, then the number is masked (`+234800***00`) - the raw staff number never appears in the trail.

## Implementation notes
- `src/services/notify.service.js` - `notifyStaffOfTicket({ticket, correlationId, customerPhone, send, retryDelaysMs, log})`; `MAX_ATTEMPTS = 3`, `RETRY_DELAYS_MS = [250, 500]`; `send` and delays are injectable so tests run instantly and offline.
- `src/services/pipeline.service.js` - calls the notifier right after auditing `TICKET_CREATED` (final order: TICKET_CREATED -> NOTIFICATION_SENT|FAILED -> REPLY_SENT).
- `src/services/ticket.service.js` - `setNotificationStatus`; `src/services/audit.service.js` - `recordNotificationSent`, `recordNotificationFailed`; `src/utils/templates.js` - `staffTicketAlert`.

## Tests required
- `tests/notify.test.js` (4): success on the first attempt (result shape, adapter call contents, masked audit, ticket status); retry-to-success on attempt 3; exhausted retries -> `failed` + audit + exactly 3 calls; retry-policy constants.
- `tests/intentHandlers.test.js` / `tests/slotFilling.test.js` - pipeline escalation tests assert `notificationStatus: 'sent'` and the `NOTIFICATION_SENT` audit end to end.

## Explain-it notes
- Trade-off: the notifier is best-effort and never throws - a dead channel must not roll back an escalation; the outcome is stored on the ticket (`notificationStatus`) so the dashboard and API can flag tickets nobody was alerted about (this is exactly failure 4's demo path).
- Trade-off: delivery state is deliberately duplicated - the ticket carries it as a query-able field, the audit carries the narrative (attempts, masked destination, error).
- What fails first: the channel itself - when sends fail (e.g. `WHATSAPP_FORCE_SEND_FAILURE=true`), customer replies are dropped by the same adapter and the staff alert is marked after 3 attempts; the ticket remains, flagged for humans.

## Status log
- 2026-10-07: notifier + pipeline wiring + 4 tests landed; escalation suites assert `notificationStatus: 'sent'`. Live e2e: the TKT-0001 complaint delivered the staff alert to `logs/whatsapp-outbound.log` (simulated mode); with `WHATSAPP_FORCE_SEND_FAILURE=true`, TKT-0003 ended `notificationStatus: failed` with a `NOTIFICATION_FAILED` audit (attempts 3, `forced_send_failure`), `failures.notificationFailures: 1` in metrics and the red badge on the dashboard - failure 4 reproduced end to end. Task done.
