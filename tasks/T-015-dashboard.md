# T-015: Metrics API and Dashboard
Sprint: 3 | Epic: E6 Metrics, Dashboard and RapiDoc | Points: 3 | Depends on: T-014

## User story
As a manager, I want live operational numbers (messages, conversations, intents, classifier mix, orders, escalations, response times, failure counters), a browsable audit trail, and a one-page dashboard that shows them, so that I can run the shop without opening a database client.

## Workplan references
- Endpoints 8.15 (metrics), 8.14 (audit trail) and 8.17 (dashboard); the failure counters map to workplan section 9 (duplicates, classifier fallbacks, notification failures, validation retries).

## Acceptance criteria
- [x] Given GET /api/metrics with an optional `from`/`to` window (default last 24 h), when called with a staff key, then it returns `period`, `totalMessages`, `totalConversations`, zero-filled `intentBreakdown` (all six intents), `classifier` (rules/llm/fallback), `ordersCreated`, `escalationRate`, a live `tickets` snapshot (per status + `overdue`), `unresolvedConversations`, `avgAutoResponseMs`, `avgFirstHumanResponseMin` and `failures` counters.
- [x] Given tickets `open` longer than `TICKET_SLA_MINUTES`, when metrics are computed, then `tickets.overdue` counts them (derived, never stored) and `avgFirstHumanResponseMin` averages `firstResponseAt - createdAt` for tickets answered within the window.
- [x] Given `from` after `to` or an unparseable date, when requested, then 400 `VALIDATION_ERROR`.
- [x] Given GET /api/audit with `type`, `entityType`, `entityId`, `correlationId`, `from`, `to`, `limit`, `cursor`, when called with a staff key, then `{data, nextCursor}` returns the trail newest-first with opaque keyset pagination; a garbage cursor is 400 (decoded in the validator, not by Mongo).
- [x] Given GET /dashboard in a browser, when opened, then a static page (no build step) loads its JS/CSS and polls `/api/metrics`, `/api/tickets` and `/api/audit` with the operator-supplied `x-api-key`; tiles, two charts, the open-tickets table and the audit table render live values.
- [x] Given no/incorrect `x-api-key`, when metrics/audit are called, then 401 `UNAUTHORIZED`; the dashboard page itself is public but shows a "enter your key" notice until a valid key is provided (key kept in sessionStorage only).

## Implementation notes
- `src/services/metrics.service.js` - `getMetrics({from,to})` runs all aggregations in one `Promise.all`; `resolvePeriod` (default last 24 h); `avgAutoResponseMs` pairs MESSAGE_RECEIVED/REPLY_SENT audit events by correlationId; `FAILURE_EVENT_MAP` tallies the section-9 counters.
- `src/services/audit.service.js` - `listEvents` keyset pagination (`encodeCursor`/`decodeCursor`, base64url `createdAt|_id`); empty `detail` normalised to `{}` on read (Mongoose `minimize` strips empty objects on save).
- `src/routes/metrics.routes.js` / `src/routes/audit.routes.js` + validators/controllers; mounted at `/api/metrics` and `/api/audit`.
- `dashboard/index.html`, `dashboard/dashboard.js`, `dashboard/dashboard.css` - textContent-only rendering (no innerHTML), 10 s auto-refresh, Chart.js from CDN; `src/routes/dashboard.routes.js` re-applies helmet with a dashboard CSP (`script-src 'self' https://cdn.jsdelivr.net`) layered over the app default.

## Tests required
- `tests/metrics.test.js` (5): 401; window figures from real pipeline activity (4 messages, 2 conversations, intent mix, classifier mix, escalation rate 0.5, live ticket snapshot); SLA backlog + first-response average; `from`/`to` scopes window figures but not the backlog snapshot; period validation.
- `tests/audit.test.js` (5): 401; newest-first keyset pagination + item shape; filters (type/entity/correlation/combined/empty); from/to bounds; validation (bad enum, limit 0/201, garbage cursor, from>to).
- `tests/dashboard.test.js` (3): static page + 301 redirect + CSP; JS/CSS content types; the polled APIs stay locked without the key.

## Explain-it notes
- Trade-off: window figures and live snapshots are mixed in one payload on purpose - "how are we doing" (period) and "what is on the desk right now" (backlog) are different questions; both are documented in the service comments and README.
- Trade-off: the audit API uses cursor pagination because the trail is append-only and continuously written - offset pages would skip or duplicate events between polls; the keyset cursor is stable across writes.
- Trade-off: the dashboard is a dependency-free static page; charts come from the Chart.js CDN and everything else is hand-rendered with textContent - XSS-safe by construction, no build tooling to maintain.
- What fails first: without the staff key the dashboard shows its notice and the APIs answer 401 - the page degrades to a shell, which is the intended behaviour.

## Status log
- 2026-10-07: metrics service/API, audit API, dashboard + 13 tests landed. Live e2e: the dashboard rendered in a browser against the real pipeline data (7 messages, 3 conversations, escalation rate 100%, average auto-response 60 ms, TKT-0003 badged "staff notified: failed", TKT-0002 sent), both charts drawn (intent bars + classifier doughnut), audit table populated with all event types, zero console errors. Task done.
