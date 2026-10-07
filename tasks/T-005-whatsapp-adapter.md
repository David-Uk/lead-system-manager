# T-005: Simulate endpoint and WhatsApp adapter
Sprint: 1 | Epic: E2 Inbound Pipeline | Points: 3 | Depends on: T-004

## User story
As a developer or reviewer, I want to drive the whole pipeline without a Meta account and watch outbound WhatsApp messages being "sent", so that demos, failure drills and tests need zero third-party setup.

## Workplan references
- Section 8.3 (`POST /simulate/message` response shape), section 6 (channel adapter: simulated + Cloud API), failure #3 (send failure handling) and test-ID T10 (`WHATSAPP_FORCE_SEND_FAILURE` hook).
- `docs/DECISIONS.md`: all messaging through the WhatsApp adapter; no Telegram.

## Acceptance criteria
- [x] Given no `x-api-key`, when `POST /simulate/message` is called, then 401; wrong-format phone (`+44…`) or empty text → 400 with per-field `details`; omitted `messageId` → one is generated; valid request → 200 with the documented pipeline shape.
- [x] Given `NODE_ENV=production`, then `/simulate/*` returns 404 (verified by spawning a real production child process, not module stubs).
- [x] The adapter never throws: `sendText` resolves to `{ok, mode, providerMessageId, error}` in every path (invalid args, forced failure, HTTP error, network error, timeout).
- [x] Simulated mode logs to stdout and appends JSON lines to `logs/whatsapp-outbound.log`; cloud mode POSTs to the Graph API with `wa_id` format (no `+`), bearer token and a 10 s abort timeout.
- [x] `WHATSAPP_FORCE_SEND_FAILURE=true` and `--bad-signature` cover the failure-drill paths used by the demo.
- [x] The pipeline service exists as a skeleton with TODO markers for T-006…T-014 and returns a stable result shape (`duplicate/intent/confidence/replies/…`).

## Implementation notes
- `src/utils/phone.js` — Nigerian E.164 normalisation (`+234[789]…`), `toWaId`, `maskPhone`.
- `src/services/whatsapp.adapter.js` — mode switch, outbound log file (`OUTBOUND_LOG_FILE` exported for tests), cloud send with timeout.
- `src/services/pipeline.service.js` — `processInboundMessage({message, correlationId, source, options})` skeleton: logs acceptance, returns the empty-but-stable shape; later tasks replace the TODOs.
- `src/middleware/auth.js` — `requireApiKey` with constant-time compare.
- `src/validators/simulate.validator.js` + `src/controllers/simulate.controller.js` + `src/routes/simulate.routes.js` — validation (Nigerian phone, text 1–1000), 404-in-production guard, controller awaiting the pipeline.
- Tooling: `scripts/send-webhook.js` (HMAC-signing helper for manual POSTs), `test_inputs/webhook-sample.json`, `scripts/dev-memory-mongo.js` (Docker-free dev database).

## Tests required
- `tests/simulate.test.js` (6): api key required; non-Nigerian phone 400; empty text 400; exact result shape; auto messageId; disabled in production (child process).
- `tests/whatsappAdapter.test.js` (6): simulated send + log file; invalid args; forced failure; cloud success (URL/bearer/body asserted); provider HTTP error; network error — the last four run in child processes with controlled environments.

## Explain-it notes
- Trade-off: simulated mode is the default so the whole flow is reviewable without Meta credentials; flipping to `WHATSAPP_MODE=cloud` changes only the adapter's transport, not callers.
- Trade-off: the never-throws adapter contract pushes retry/failure decisions to callers (T-014 handles staff-notification retries) but keeps every call site panic-free.
- Trade-off: tests that need different environments spawn real child processes instead of stubbing modules — slower but exactly what production does; it also caught nothing regressing when the test runner changed.
- What fails first: cloud credentials (expired 24 h test token is the classic) — the adapter maps it to `ok:false` with the provider's message, and `/health` reports the notifier as down.

## Status log
- 2026-10-07: Implemented phone utils, WhatsApp adapter (simulated + cloud + force-failure), pipeline skeleton, staff auth, simulate endpoint and the webhook-sending helper. All simulate/adapter tests pass; manual end-to-end (simulate 401/400/200 + outbound log) verified. Task done.
