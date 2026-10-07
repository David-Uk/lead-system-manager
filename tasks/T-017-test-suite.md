# T-017: Full test suite mapping
Sprint: 4 | Epic: E7 Testing and Quality | Points: 5 | Depends on: T-016

## User story
As the assessor (and any future maintainer), I want every workplan test row T1–T10 mapped to a
synthetic input, an automated test or documented manual step, and a recorded result, so the
submission's "reproducible test record" can be verified by re-running one command.

## Workplan references
- Section 10 block 6 — "Test inputs, automated tests, results table".
- Section 11 — Test Record Template (rows T1…T10).
- Section 9 — failure conditions (T7 = #3, T8 = #1, T9 = signature reject, T10 = #4).
- Section 13 item C — Prototype and Test Record.

## Acceptance criteria
- [ ] `test_inputs/` holds a synthetic input per test ID where a payload applies (T1–T5 message
  texts, T6 duplicate pair, T7 invalid quantities, T9 bad signature); webhook-shaped payloads
  reuse `test_inputs/webhook-sample.json`.
- [ ] Every row T1–T10 states: input, expected result, actual result, pass flag, and the exact
  evidence — test file + test name, or the manual command that produced the result.
- [ ] Channel rename honoured: T5/T10 say "Telegram" — recorded against the WhatsApp staff
  notifier per `docs/DECISIONS.md` (same retry/flag semantics, one channel for everything).
- [ ] The record (`docs/TEST-RECORD.md`) embeds a clean `npm test` summary (currently 123 tests /
  31 suites) and the dated manual-play evidence for the video beats.
- [ ] README "Testing and linting" links the record.

## Implementation notes
- Mapping over invention: most rows already have automated evidence — T1–T2 classifier +
  intent-handler suites; T3–T4 slot-filling + order-status tests; T5 tickets + notifier suites;
  T6 dedupe suite; T7 slot-filling escalation path; T8 classifier fallback tests; T9 webhook
  signature tests; T10 notifier retry tests + the `WHATSAPP_FORCE_SEND_FAILURE` adapter test.
- The record is hand-maintained markdown (generated files drift); keep it one table plus two
  short command transcripts.
- Rows whose only evidence is visual (dashboard "failed" badge) are marked manual with exact
  steps instead of being claimed as automated.

## Tests required
- The mapping itself; as the guard, every referenced test name must exist — confirm with a full
  `npm test` run, and re-check the links whenever tests are renamed.

## Explain-it notes
- Automated vs manual boundary: everything deterministic is a test; only inherently visual
  claims (browser rendering) stay manual, with steps a reviewer can repeat.
- `mongodb-memory-server` is what makes the record reproducible: no live DB, no Docker, no
  network after the first binary cache.
- What fails first: renamed or deleted tests silently invalidating the table — treat the record
  like code and update it in the same change that touches tests.

## Status log
- (not started)
