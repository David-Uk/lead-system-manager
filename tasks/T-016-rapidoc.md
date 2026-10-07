# T-016: Complete OpenAPI in RapiDoc
Sprint: 3 | Epic: E6 Metrics, Dashboard and RapiDoc | Points: 2 | Depends on: T-015

## User story
As an operator or reviewer, I want every implemented endpoint described in an OpenAPI document rendered as an interactive RapiDoc page - with the staff auth scheme and try-it-out - so that the API can be explored and exercised without reading the source.

## Workplan references
- Workplan section 8 (full endpoint catalogue) and the sprint-3 DoD ("API is documented in RapiDoc"); the document covers every implemented endpoint as of this sprint.

## Acceptance criteria
- [x] Given GET /openapi.json, when fetched, then it returns a valid OpenAPI 3.0.3 document titled `Lead System Manager API` with `ApiKeyAuth` (`x-api-key`, header) and `WebhookSignature` (HMAC header) security schemes.
- [x] Given the document, when inspected, then it documents all served paths - `/health`, `/webhook`, `/simulate/message`, `/api/orders`, `/api/orders/{orderId}`, `/api/tickets`, `/api/tickets/{ticketId}`, `/api/audit`, `/api/metrics` - every operation has a summary and explicit responses, and enum values are imported from the models so they cannot drift.
- [x] Given GET /docs, when opened in a browser, then a self-hosted RapiDoc (served from node_modules at `/docs/vendor/rapidoc-min.js`) renders the document with try-it-out enabled, under a docs-specific CSP (`style-src 'self' 'unsafe-inline'`) layered over the app default.
- [x] Given a reviewer uses try-it-out on a staff endpoint, when they supply the `x-api-key`, then the request executes against the same server; the docs page itself is public (the document contains no secrets).

## Implementation notes
- `src/openapi/document.js` - hand-authored 3.0.3 document: shared error envelope, keyset-cursor parameters on `/api/audit`, schemas for Error/Health/WebhookPayload/SimulateResponse/Order(s)/Ticket(s)/TicketDetail/Message/AuditEvent/AuditPage/Metrics; enums imported from `auditEvent.model.js`, `order.model.js`, `ticket.model.js` and `classifier/llm.js`.
- `src/routes/docs.routes.js` - `GET /openapi.json` (raw document), `GET /docs` (RapiDoc page), `GET /docs/vendor/rapidoc-min.js` (`createRequire(import.meta.url).resolve('rapidoc/dist/rapidoc-min.js')`); mounted at the root in `src/routes/index.js`.
- Docs-specific helmet CSP: `default-src 'self'`, `style-src 'self' 'unsafe-inline'` (RapiDoc injects styles as a web component), no inline scripts.

## Tests required
- `tests/openapi.test.js` (4): document basics + exact path list + `ApiKeyAuth` scheme; every operation carries a summary and responses; `/docs` contains `<rapi-doc>`, `spec-url` and the vendor script URL; the vendor bundle is served as JavaScript (>1 KB).

## Explain-it notes
- Trade-off: the document is hand-authored instead of generated (`@asteasolutions/zod-to-openapi` is installed) - generation tends to mirror validator internals, while hand-authoring documents the responses controllers actually send; the drift-prone part (enums) is still imported from the models. Revisit if the endpoint count grows a lot.
- Trade-off: RapiDoc is served from node_modules, not a CDN - docs work offline and the docs CSP can stay tight (`script-src 'self'`).
- Scope note: only implemented endpoints are documented. The workplan's products (8.4/8.5) and conversations (8.12/8.13) staff APIs are not covered by any sprint task, so they are neither implemented nor documented - flagged as a known gap, not silently dropped.
- What fails first: the RapiDoc asset - `require.resolve` fails loudly at import time if the package layout changes, which beats a silent 404 in the browser.

## Status log
- 2026-10-07: OpenAPI document (9 paths, shared error envelope, enum imports), docs routes + CSP and 4 tests landed. Verified live: `/docs` renders the interactive reference and `/openapi.json` serves the valid document (200, all operations summarized) on the running server. Task done.
