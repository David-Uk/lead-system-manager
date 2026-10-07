# T-007: Deduplication and message persistence
Sprint: 1 | Epic: E2 Webhook and Pipeline | Points: 2 | Depends on: T-006

## User story
As the business, I want repeat deliveries of the same WhatsApp message to be ignored completely, so that customers never receive duplicate replies (workplan failure #2) and the audit trail never double-counts.

## Workplan references
- Workplan failure #2 (duplicate deliveries) and test ID T6; section 3 (`messages`).

## Acceptance criteria
- [x] First delivery stores an inbound message (`providerMessageId`, direction, type, text, conversationId) and, once classified, annotates it with `intent`, `confidence`, `classifierSource`.
- [x] The same `providerMessageId` again returns `duplicate: true` with no second reply and no second row - even when two copies arrive concurrently.
- [x] Dedupe runs before any conversation work, so replayed webhooks cannot touch customer or conversation state.
- [x] Outbound replies are persisted too (the adapter's provider id, or `local-out-*` in simulated mode).

## Implementation notes
- `src/services/message.service.js` - `findByProviderMessageId` (fast path), `saveInboundMessage` (E11000 -> duplicate), `annotateMessage`, `saveOutboundMessage`.
- Unique index on `providerMessageId` (message model, T-003) is the correctness backstop; the fast-path find is the efficiency one.
- `src/services/pipeline.service.js` - step 4 dedupe gate + audit `DUPLICATE_IGNORED`; annotation maps `classification.source` -> `classifierSource` explicitly so the stored row follows the model vocabulary.

## Tests required
- `tests/dedupe.test.js` (3): store + annotate; repeat delivery ignored (T6); concurrent race with `Message.init()` guaranteeing the index exists.

## Explain-it notes
- Trade-off: fast-path lookup + unique-index backstop - the index makes correctness independent of timing, the extra find keeps the common duplicate case cheap.
- Trade-off: the dedupe check happens before persisting the new copy, so a replay never touches the original row.
- What fails first: two concurrent first copies - both insert, one hits E11000 and is mapped to `duplicate`, so exactly one row survives (covered by the race test).

## Status log
- 2026-10-07: message service + dedupe gate wired into the pipeline; dedupe suite green including the concurrent race; live e2e: resending `e2e-rules-1` returned `duplicate: true` with no reply. Task done.
