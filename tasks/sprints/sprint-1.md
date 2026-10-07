# Sprint 1

**Goal:** A message goes in, is stored, audited, answered through the adapter, and duplicates are ignored (workplan failure #2)
**Time-box:** 2h

## Committed Tasks
- [x] T-004
- [x] T-005
- [x] T-006
- [x] T-007
- [x] T-008

## Definition of Done
- All tasks are Done.
- Tests pass.
- API is documented in RapiDoc.
- Audit logs match changes.

## Demo Checklist
- [x] End to end test of sprint goals manually

## Review
- Delivered: T-004 (signed webhook ingress with audit on rejects), T-005 (simulate endpoint, WhatsApp adapter in simulated + cloud modes, pipeline skeleton), then T-006 (customer/conversation services), T-007 (dedupe + message persistence) and T-008 (full lifecycle audit incl. CLASSIFIER_FALLBACK).
- Velocity: 5 of 5 committed tasks. Sprint goal met: a message is stored, duplicate deliveries are ignored (workplan failure #2 - fast-path find + unique-index backstop, race-tested), the lifecycle is audited end to end and replies go out through the adapter; one price question leaves MESSAGE_RECEIVED -> CLASSIFIED -> REPLY_SENT.
- Note: RapiDoc (Definition of Done) remains T-016 scope - until then the lifecycle is documented in the README and task files.

## Retrospective
- Went well: the dedupe design survived the concurrent-delivery race test on the first run; typed audit helpers (T-008) kept the event vocabulary stable while the pipeline grew from skeleton to steps 4-9.
- Needs improvement: expectations copied by eye drifted from source (masked-phone format) - derive test expectations from the implementation (`maskPhone`), not from memory.
