# Sprint 0

**Goal:** docker compose up works and /health returns ok
**Time-box:** 1h

## Committed Tasks
- [x] T-001
- [x] T-002
- [x] T-003

## Definition of Done
- All tasks are Done.
- Tests pass.
- API is documented in RapiDoc.
- Audit logs match changes.

## Demo Checklist
- [x] End to end test of sprint goals manually
  - `npm run dev:mongo` + `npm run seed` (30 products) + `npm start`
  - `GET /health` → 200 ok, `checks.mongo=up`; with Mongo stopped → 503 down

## Review
- Delivered: T-001, T-002, T-003 — repo boots from a fresh clone, seed is idempotent, `/health` reports per-dependency status.
- Velocity: 3 tasks delivered within the time-box; goal met (health returns ok with Mongo up).

## Retrospective
- Went well: env validation caught misconfiguration early; in-memory MongoDB removed the Docker dependency for dev and tests.
- Needs improvement: the initial vitest setup did not run on Node 25 — switched to the built-in node:test runner before sprint 1.
