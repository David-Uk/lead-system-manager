# T-004: Webhook routes and signature check
Sprint: 1 | Epic: E2 Inbound Pipeline | Points: 2 | Depends on: T-003

## User story
As the platform, I want to complete Meta's webhook handshake and accept only correctly signed callbacks so that forged or malformed traffic is rejected and audited, while genuine messages are acknowledged instantly.

## Workplan references
- Section 8.1 (`GET /webhook` handshake), 8.2 (`POST /webhook` payload), failure #T9 (unsigned/invalid webhooks rejected and audited).
- Audit events: `WEBHOOK_REJECTED`, `PAYLOAD_INVALID`, `MESSAGE_RECEIVED` (recorded by the pipeline).

## Acceptance criteria
- [x] Given a correct verify token, when Meta calls `GET /webhook?hub.mode=subscribe`, then the `hub.challenge` value is echoed with 200; a wrong token gets 403 `UNAUTHORIZED`.
- [x] Given `x-hub-signature-256`, when the HMAC-SHA256 over the raw body matches `WHATSAPP_APP_SECRET`, then the request proceeds; missing header or wrong signature → 401 and a `WEBHOOK_REJECTED` audit event with reason `missing_signature_header` / `invalid_signature`.
- [x] Given a payload that is not a WhatsApp message callback, when validation runs, then 400 `VALIDATION_ERROR` (with zod details) and a `PAYLOAD_INVALID` audit event.
- [x] Given a valid signed payload, then the response is an immediate 200 `{status:"received"}` and processing continues asynchronously — a processor crash can never cause a Meta retry storm.
- [x] Given a status-only callback (delivery receipt), then 200 is returned and no audit events are written.
- [x] Signature comparison uses `crypto.timingSafeEqual` and audit correlation ids match the response `x-correlation-id`.

## Implementation notes
- `src/middleware/signature.js` — parses `sha256=` prefix, recomputes HMAC over `req.rawBody`, constant-time compare; audits rejects with the request correlation id.
- `src/validators/webhook.validator.js` — zod schema for the Meta envelope (`object: "whatsapp_business_account"`), `extractInboundMessages()` for text messages, audits `PAYLOAD_INVALID`.
- `src/controllers/webhook.controller.js` — handshake (403 on mismatch) and receiver (200 first, then `processInboundMessage` per message with a `.catch`).
- `src/services/audit.service.js` — minimal append-only recorder introduced here because the reject flows must be auditable; best-effort (never fails the request).
- `src/routes/webhook.routes.js` + mounting in `src/routes/index.js`; `rawBody` captured in the `express.json` verify hook in `src/app.js`.

## Tests required
- `tests/webhook.test.js` (7 tests): handshake ok / wrong token; signed POST accepted; wrong signature → 401 + `WEBHOOK_REJECTED(invalid_signature)`; missing header → 401 + `missing_signature_header`; invalid shape → 400 + `PAYLOAD_INVALID`; status-only → 200 with zero audit rows.

## Explain-it notes
- Trade-off: always respond 200 then process asynchronously. Meta retries anything non-2xx, so synchronous processing would turn transient bugs into duplicate-message storms — dedupe (T-007) is the second line of defence.
- Trade-off: HMAC is computed over the raw request bytes (captured before JSON parsing), not a re-serialized body — re-stringifying JSON would change byte order and break signatures.
- What fails first: the app secret mismatch (common when moving from test to live Meta app) — the 401 carries the reason and the audit event records which rejection path fired.

## Status log
- 2026-10-07: Implemented signature middleware, payload validator, handshake + receiver controllers, audit service and routes. All 7 webhook tests pass; manual signed POST and `--bad-signature` verified against a running server (200/401 + audit rows). Task done.
