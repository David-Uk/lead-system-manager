# T-008: Audit service and basic logs
Sprint: 1 | Epic: E2 Webhook and Pipeline | Points: 2 | Depends on: T-007

## User story
As a reviewer or support engineer, I want every step of a message's life written to an append-only audit trail with correlation ids, so that any complaint can be traced end to end without reading code.

## Workplan references
- Section 3 (`audit_events`) and section 5.1 (audit at each pipeline step); `x-correlation-id` from T-003/T-004.

## Acceptance criteria
- [x] Typed helpers exist for the lifecycle: `MESSAGE_RECEIVED`, `DUPLICATE_IGNORED`, `CLASSIFIED`, `CLASSIFIER_FALLBACK`, `REPLY_SENT` (alongside the earlier `WEBHOOK_REJECTED` / `PAYLOAD_INVALID`).
- [x] One price question leaves `[MESSAGE_RECEIVED, CLASSIFIED, REPLY_SENT]` in write order for its correlation id (integration test), with intent/confidence/source/entities on `CLASSIFIED`.
- [x] An AI outage records `CLASSIFIER_FALLBACK` with the reason (`ai_unavailable` / `low_confidence`) and the customer still gets a reply.
- [x] No raw PII: phone numbers are masked (`+234801***78`); entity ids are message/conversation ids.

## Implementation notes
- `src/services/audit.service.js` - `recordMessageReceived`, `recordDuplicateIgnored`, `recordClassified`, `recordClassifierFallback`, `recordReplySent` over the append-only `AuditEvent` model.
- `src/services/pipeline.service.js` writes one event per lifecycle step, all sharing the request's correlation id.

## Tests required
- `tests/pipeline.test.js` (2): full lifecycle chain incl. masked phone + entities; outage -> `CLASSIFIER_FALLBACK` + reply still sent.
- `tests/webhook.test.js`: `MESSAGE_RECEIVED` (actor `customer`) and `CLASSIFIED` (price_check/rules) asserted for a signed webhook.

## Explain-it notes
- Trade-off: typed helpers beat free-form `record()` at call sites - event names and detail shapes live in one file and tests assert on a stable vocabulary.
- Trade-off: events are only appended, never updated; corrections are new events.
- What fails first: a Mongo outage fails processing anyway (audit inserts are part of the same unit of work), so the trail cannot silently diverge from what happened.

## Status log
- 2026-10-07: audit helpers + pipeline coverage implemented; both pipeline tests green; live e2e shows the chain for a real Ollama Cloud classification (`CLASSIFIED` with source `llm`). Task done.
