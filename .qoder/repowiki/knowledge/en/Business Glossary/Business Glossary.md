---
kind: business_term
name: Business Glossary
category: business_term
scope:
    - '**'
---

### Lagos Fresh Mart
- Definition：The retail business this system automates customer service for; customers message the WhatsApp number with natural-language queries about products, orders, and complaints.

### simulated mode
- Definition：Default WhatsApp adapter behavior where outbound messages are logged to stdout and `logs/whatsapp-outbound.log` instead of being sent through the Meta Graph API; enables full development without a Meta account.
- Aliases：simulated

### cloud mode
- Definition：WhatsApp adapter behavior (`WHATSAPP_MODE=cloud`) that sends real replies through the Meta Graph API using the configured phone number ID and access token.
- Aliases：cloud

### staff endpoints
- Definition：Internal APIs protected by the `x-api-key` header (currently `/simulate/message` and related simulate routes); used by operators to drive the pipeline without connecting Meta.
- Aliases：staff API key、x-api-key

### message pipeline
- Definition：The end-to-end processing flow for inbound WhatsApp messages: accept → validate → classify (rules + optional LLM) → reply → persist conversation/order/ticket → audit. At T-005 it is a skeleton that accepts/validates/logs and returns the documented result shape; classification, dedupe, orders and tickets land in later tasks.
- Aliases：pipeline

### providerMessageId
- Definition：The unique identifier attached to each WhatsApp message (e.g. wamid) used to deduplicate duplicate deliveries from Meta before reprocessing.
- Aliases：wamid

### WEBHOOK_REJECTED
- Definition：Audit event code recorded when an incoming webhook fails signature verification; distinguishes rejected webhooks from successful ones in the append-only audit trail.

### T-NNN
- Definition：Task identifiers used throughout the project's task board (`tasks/T-*.md`, `tasks/BOARD.md`, `tasks/sprints/*.md`). Each task is a user story with acceptance criteria, implementation notes, trade-offs, and a dated status log; completed tasks are checked off in the board and sprint files.
- Aliases：task T-NNN
