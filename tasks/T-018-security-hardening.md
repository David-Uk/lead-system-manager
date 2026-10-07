# T-018: Security review and hardening
Sprint: 4 | Epic: E7 Testing and Quality | Points: 2 | Depends on: T-017

## User story
As the operator, I want the workplan's risk table verified against the actual implementation and
any gaps fixed or consciously accepted, so the security posture described in the submission
matches the code that ships.

## Workplan references
- Section 15 — Risk, Reliability and Security (the checklist this task audits).
- Section 5 — security expectations (HMAC signature, verify token, rate limiting).
- Section 13 item F — Risk, Reliability, Security (2 pages) uses this review as its evidence.
- NDPA 2023 note in section 15 (data minimisation, no PII in logs).

## Acceptance criteria
- [ ] Every section-15 risk row is verified in code with a one-line evidence pointer
  (file/endpoint/test): webhook spoofing, classifier misclassification or prompt injection,
  duplicate or replayed messages, personal data exposure, provider outage, missed staff
  notification, data loss, staff endpoint misuse, audit tampering.
- [ ] `npm audit` reviewed; each critical/high advisory is fixed or documented with mitigation
  and a revisit date.
- [ ] Secret scan clean: `.env` gitignored, no keys in README/logs/tests, production boot
  refuses `change-me` placeholders (already enforced at startup, confirm by test).
- [ ] PII check: phone numbers masked in audit details (`maskPhone`) and pino log redaction
  covers auth headers/tokens.
- [ ] Findings and any code changes recorded in the status log; behaviour changes carry tests.

## Implementation notes
- Review-first task; expected touchpoints are small (logger redaction list, any missing test).
  Resist scope creep: JWT/RBAC is explicitly in the 90-day plan (workplan 17), not sprint 4.
- Existing evidence to lean on: `tests/errors.test.js` (error shapes, headers), webhook 401
  tests, staff auth 401 tests, append-only audit (no update/delete routes exist).
- The review output feeds item F: each verified row becomes a line in the two-pager.

## Tests required
- Only for fixes; otherwise the review references the existing suite. Any new hardening must
  land with a regression test.

## Explain-it notes
- In-scope threats for a prototype (spoofing, replay, PII, endpoint misuse) vs deferred ones
  (roles, per-tenant limits) — why a shared API key is the right bar today.
- Why constant-time comparison (`timingSafeEqual`) matters even for a single shared key.
- What fails first in production: a leaked staff key — rotate via `.env`, restart, done
  (single-key design makes rotation one action).

## Status log
- (not started)
