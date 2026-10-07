# Sprint 3

**Goal:** A complaint creates a ticket plus a WhatsApp staff notification, the dashboard shows live numbers, failure #1 and failure #4 work
**Time-box:** 1.5h

## Committed Tasks
- [x] T-013
- [x] T-014
- [x] T-015
- [x] T-016

## Definition of Done
- All tasks are Done.
- Tests pass.
- API is documented in RapiDoc.
- Audit logs match changes.

## Demo Checklist
- [x] End to end test of sprint goals manually

## Review
- Delivered: T-013 (ticket lifecycle `TKT-####` with escalation wiring for complaints/refunds, unknown-intent second misses, AI outages, invalid-data retries and human requests, plus `GET/GET-one/PATCH /api/tickets` with `TICKET_CREATED`/`TICKET_UPDATED` audits), T-014 (best-effort WhatsApp staff notifier: 3 attempts with backoff, `notificationStatus` sent/failed on the ticket, `NOTIFICATION_SENT`/`NOTIFICATION_FAILED` audits, masked destinations), T-015 (metrics API, cursor-paginated audit API, static operations dashboard at `/dashboard` with tiles, charts, ticket + audit tables) and T-016 (hand-authored OpenAPI 3.0 document at `/openapi.json` rendered by self-hosted RapiDoc at `/docs`).
- Velocity: 4 of 4 committed tasks (11 points); sprint goal met. Suite grew 84 -> 123 tests (39 new), all green; lint clean. Live demo: complaint -> TKT-0001 + staff alert in `logs/whatsapp-outbound.log`; tickets API PATCH assigned with audit; dashboard rendered real numbers in a browser (escalation rate 100%, TKT-0003 flagged "staff notified: failed"); failure #1 (LLM outage -> clarify then `ai_unavailable` ticket) and failure #4 (forced send failure -> failed notification + dashboard badge) reproduced end to end.
- Note: the sprint-3 DoD item "API is documented in RapiDoc" is now satisfied for all implemented endpoints; products (8.4/8.5) and conversations (8.12/8.13) staff APIs are a known gap with no owning task (see retro).

## Retrospective
- Went well: creating the Ticket inside the handlers before the reply means the customer-facing reply can quote `TKT-` reference for every escalation branch (complaint, second miss, invalid data, human) with no extra round trip - and the failure-#1/#4 demo hooks (`LLM_PROVIDER=none`, `WHATSAPP_FORCE_SEND_FAILURE=true`) made both failure paths reproducible in minutes.
- Went well: the audit trail doubles as the metrics source (MESSAGE_RECEIVED/REPLY_SENT pairing gives avg auto-response; failure counters are audit counts) - no new tables, and every dashboard number traces back to an event.
- Needs improvement: one Mongoose detail bit us late - `minimize` strips empty `{}` before saving, so audit events without a detail payload came back without the key; fixed by normalising `detail: row.detail ?? {}` in `listEvents` (covered by tests). Empty-object edge cases deserve a thought before trusting `lean()` output.
- Needs improvement: workplan sections 8.4/8.5 (products API) and 8.12/8.13 (conversations API) have no owning task - decide in sprint-4 planning whether to implement or explicitly drop them, so the OpenAPI document and README can state it either way.
