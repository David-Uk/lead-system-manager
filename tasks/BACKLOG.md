# Backlog

| ID | Title | Epic | Points | Depends on | Priority | Sprint |
|---|---|---|---|---|---|---|
| T-001 | Repository setup and env | E1 Foundation | 1 | | High | 0 |
| T-002 | Mongo connection and seed script | E1 Foundation | 2 | T-001 | High | 0 |
| T-003 | Models, error handler, health endpoint | E1 Foundation | 2 | T-002 | High | 0 |
| T-004 | Webhook routes and signature check | E2 Webhook and Pipeline | 2 | T-003 | High | 1 |
| T-005 | Simulate endpoint and WhatsApp adapter | E2 Webhook and Pipeline | 3 | T-004 | High | 1 |
| T-006 | Customer and conversation models | E2 Webhook and Pipeline | 2 | T-005 | High | 1 |
| T-007 | Deduplication and message persistence | E2 Webhook and Pipeline | 2 | T-006 | High | 1 |
| T-008 | Audit service and basic logs | E2 Webhook and Pipeline | 2 | T-007 | High | 1 |
| T-009 | Rules classifier and LLM adapter | E3 Classification | 3 | T-008 | High | 2 |
| T-010 | Intent handlers (enquiry, price, status) | E4 Intent Handlers | 3 | T-009 | High | 2 |
| T-011 | Slot-filling state machine (place_order) | E4 Intent Handlers | 5 | T-010 | High | 2 |
| T-012 | Order creation and API | E4 Intent Handlers | 3 | T-011 | High | 2 |
| T-013 | Ticket service and staff endpoints | E5 Escalation and WhatsApp | 3 | T-012 | High | 3 |
| T-014 | WhatsApp staff notifier | E5 Escalation and WhatsApp | 3 | T-013 | High | 3 |
| T-015 | Metrics API and Dashboard | E6 Metrics, Dashboard and RapiDoc | 3 | T-014 | High | 3 |
| T-016 | Complete OpenAPI in RapiDoc | E6 Metrics, Dashboard and RapiDoc | 2 | T-015 | High | 3 |
| T-017 | Full test suite mapping | E7 Testing and Quality | 5 | T-016 | High | 4 |
| T-018 | Security review and hardening | E7 Testing and Quality | 2 | T-017 | Medium | 4 |
| T-019 | Documentation (README, SETUP, RUNBOOK, etc.) | E8 Documentation and Handover | 3 | T-018 | High | 4 |
| T-020 | Demo script and record test results | E9 Demo and Submission | 2 | T-019 | High | 4 |
