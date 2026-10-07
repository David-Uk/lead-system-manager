# AIL Assessment Workplan: WhatsApp Retail Automation API

Node.js + MongoDB build plan for the Angel Intelligence Limited Lead Systems & Automation Engineer take-home (V1.1). Context chosen: **Retail and order enquiries**.

## 1. Objective and Scope

Build the smallest complete system that receives a WhatsApp-style message, classifies intent, replies or guides the customer, validates collected data, escalates to a human when needed, notifies staff, records an audit trail, and exposes operational metrics.

**Fictional client:** Lagos Fresh Mart, a growing retail SME taking orders and enquiries over WhatsApp. Staff reply manually, data is incomplete, follow-up is inconsistent, and managers have no visibility.

**Intents (5; minimum required is 4):**

| Intent | Description | Handling |
| --- | --- | --- |
| `product_enquiry` | Availability, description, category | Auto-reply from catalogue |
| `price_check` | Price of an item | Auto-reply from catalogue |
| `place_order` | Customer wants to buy | Guided slot-filling, then order created |
| `order_status` | Where is my order | Lookup by order ID or phone |
| `complaint_or_refund` | Complaint, refund, dispute | Always escalate to human |

**Fallback intent:** `unknown` leads to a clarifying question once, then escalation.

**Deliberately not automated:** refunds, payment confirmation, price negotiation, delivery rescheduling exceptions, anything sensitive or high-impact.

**Simulated vs fully working:**

| Component | Status |
| --- | --- |
| WhatsApp channel | Simulated (webhook accepts Meta Cloud API payload shape; `/simulate/message` helper) |
| Staff notification | Telegram Bot (real, free) with fallback to log-only mode |
| API, DB, classifier, state machine, audit log, metrics, dashboard | Fully working |
| Payments, delivery partner integration | Out of scope |

## 2. Assumptions (state these in Item A)

1. Catalogue is small (about 30 products) and seeded with synthetic data.
2. One shop, one operator team; roles are `staff` and `manager` (single API key in v1).
3. Payment is cash or transfer on delivery, confirmed manually by staff.
4. Customers write mostly in English or light Nigerian Pidgin.
5. Orders are delivery-only within one city; address is free text in v1.
6. WhatsApp 24-hour customer service window applies in production.
7. All data is synthetic; phone numbers use a fictional range.
8. A response target of under 5 seconds for automated replies and under 15 minutes for human pick-up of tickets.

## 3. Tool Stack (all free)

| Layer | Choice | Justification |
| --- | --- | --- |
| Runtime | Node.js 20 LTS | Stable, widely known, easy hiring and handover |
| Framework | Express 4 (or Fastify) | Minimal, readable for juniors |
| Database | MongoDB 7 via Mongoose 8 (Atlas M0 free tier or local Docker) | Free, flexible documents suit conversations and audit events |
| Validation | Zod | Runtime schema validation for webhook, slots, AI output |
| Logging | pino + pino-http | Structured JSON logs with correlation IDs |
| Security | helmet, express-rate-limit, HMAC signature check, dotenv | Covers spoofing, abuse, secret handling |
| Notifications | Telegram Bot API (free); Nodemailer + Mailtrap or Slack webhook as alternates | Zero cost staff alerts |
| HTTP client | Native `fetch` (Node 20) with AbortController timeouts | No extra dependency |
| Testing | Vitest (or Jest), Supertest, mongodb-memory-server | Reproducible test record, no live DB needed |
| Packaging | Docker Compose (api + mongo), `.env.example` | One-command reviewer setup |
| Dashboard | Static HTML + Chart.js (CDN) reading `/api/metrics` | Meets visibility requirement with no frontend build |
| Demo tooling | Postman collection + simple HTML chat simulator | Easy to record the video |
| Diagram | Mermaid or draw.io export | Item B |

## 4. Free AI Options

Free tiers and model names change frequently. Verify current limits before committing.

| Option | Notes |
| --- | --- |
| Google Gemini API (Flash models) | Free tier, JSON output mode; good default for classification and entity extraction |
| Groq | Free tier serving open models (Llama family); very fast |
| OpenRouter | Several `:free` models behind one API |
| Ollama (local) | Fully free and offline; needs reasonable hardware; strongest no-provider-dependency story |

**Recommended: hybrid classification**

1. Rule/keyword classifier runs first (free, instant, deterministic).
2. If rule confidence is below threshold (for example 0.7), call the LLM with a strict JSON schema, validated by Zod.
3. If LLM confidence is below 0.6, the call times out (5s), errors, or returns invalid JSON, **escalate to a human**.

Wrap the provider behind an interface `classify(text, context) => { intent, confidence, entities, source }` so Gemini can be swapped for Groq or Ollama through one env variable. Treat all customer text as untrusted input (prompt injection risk): the LLM may only return JSON from the allowed intent list and never executes actions.

**LLM output schema:**

```json
{
  "intent": "product_enquiry | price_check | place_order | order_status | complaint_or_refund | unknown",
  "confidence": 0.0,
  "entities": { "productQuery": "string|null", "quantity": "number|null", "orderId": "string|null" }
}
```

## 5. Flow Process

### 5.1 End-to-end flow

```
 WhatsApp (simulated)
        |
        v
 POST /webhook  (or POST /simulate/message)
        |
 [1] Verify X-Hub-Signature-256 ---- invalid --> 401 + audit(WEBHOOK_REJECTED)
        |
 [2] Parse + Zod-validate payload -- invalid --> 400 + audit(PAYLOAD_INVALID)
        |
 [3] Respond 200 quickly, process message
        |
 [4] Dedupe by providerMessageId --- duplicate --> skip + audit(DUPLICATE_IGNORED)   [FAILURE 2]
        |
 [5] Upsert customer, load/create conversation, save inbound message, audit(MESSAGE_RECEIVED)
        |
 [6] Active slot-filling state?
        |-- yes --> go to [8] with current intent
        |-- no  --> [7]
        |
 [7] Classify: rules --> (low confidence) --> LLM
        |         LLM down/timeout/low confidence --> ESCALATE              [FAILURE 1]
        |         audit(CLASSIFIED)
        |
 [8] Route by intent
        |-- product_enquiry / price_check --> catalogue lookup --> reply
        |-- order_status ------------------> order lookup --> reply
        |-- place_order -------------------> slot-filling state machine (5.2)
        |-- complaint_or_refund -----------> ESCALATE
        |-- unknown -----------------------> clarify once --> else ESCALATE
        |
 [9] Send reply (simulated outbound), save outbound message, audit(REPLY_SENT)
        |
 [10] Update metrics counters / derived from collections

 ESCALATE:
   create Ticket (reason, priority) --> notify Telegram --> audit(TICKET_CREATED)
   notify failure --> retry x3 with backoff --> mark notificationStatus=failed   [FAILURE 3]
   customer receives holding message with ticket reference
```

### 5.2 Order slot-filling state machine

```
IDLE
  -> COLLECT_ITEM      ask: which product?          (match against catalogue)
  -> COLLECT_QTY       ask: how many?               (integer 1-50, stock check)
  -> COLLECT_ADDRESS   ask: delivery address?       (min length, area keyword check)
  -> COLLECT_PHONE     only if sender phone not usable (Nigerian format validated)
  -> CONFIRM           summarise, ask YES / NO
  -> COMPLETED         create Order (status=pending_confirmation), notify staff

Any state: invalid input -> re-prompt (retries++)
           retries >= 2 -> ESCALATED (reason: invalid_or_missing_data)   [FAILURE 3 alt]
           customer says CANCEL -> CANCELLED
           customer says HUMAN / AGENT -> ESCALATED
           idle for 30 minutes -> EXPIRED (cron/lazy check on next message)
```

### 5.3 Ticket lifecycle

```
open --> assigned --> in_progress --> resolved
  \________________________________/
        (any state) --> closed
```

SLA flag: tickets `open` for more than 15 minutes are marked `overdue` in metrics.

## 6. Project Structure

```
lagos-fresh-mart-bot/
  src/
    server.js                # bootstrap, graceful shutdown
    app.js                   # express app, middleware, routes
    config/env.js            # zod-validated env
    routes/                  # webhook, simulate, products, orders, tickets, conversations, audit, metrics, health
    controllers/
    services/
      pipeline.service.js    # orchestrates steps 1-10
      classifier/ (rules.js, llm.js, index.js)
      conversation.service.js
      order.service.js
      ticket.service.js
      notify.service.js      # telegram + retry
      audit.service.js
      metrics.service.js
      whatsapp.adapter.js    # simulated send; production swap point
    models/                  # mongoose schemas
    validators/              # zod schemas
    middleware/              # auth, signature, rateLimit, errorHandler, correlationId
    utils/                   # phone normaliser, templates, logger
  scripts/seed.js
  dashboard/index.html
  test_inputs/*.json
  tests/
  postman/collection.json
  docker-compose.yml
  Dockerfile
  .env.example
  README.md  SETUP.md
```

## 7. Data Model (MongoDB collections)

### customers

```json
{
  "_id": "ObjectId",
  "phone": "+2348012345678",       // unique, normalised E.164
  "name": "string|null",
  "consent": { "given": true, "at": "Date", "purpose": "order_processing" },
  "createdAt": "Date",
  "lastSeenAt": "Date"
}
```

### conversations

```json
{
  "_id": "ObjectId",
  "customerId": "ObjectId",
  "status": "active | escalated | completed | expired",
  "currentIntent": "string|null",
  "state": "IDLE | COLLECT_ITEM | COLLECT_QTY | COLLECT_ADDRESS | COLLECT_PHONE | CONFIRM | COMPLETED | CANCELLED | ESCALATED | EXPIRED",
  "slots": { "sku": "string|null", "quantity": "number|null", "address": "string|null", "phone": "string|null" },
  "retries": 0,
  "clarifyAttempts": 0,
  "lastMessageAt": "Date",
  "createdAt": "Date"
}
```

Index: `{ customerId: 1, status: 1 }`.

### messages

```json
{
  "_id": "ObjectId",
  "conversationId": "ObjectId",
  "direction": "inbound | outbound",
  "providerMessageId": "string",   // unique index (dedupe)
  "text": "string",
  "intent": "string|null",
  "confidence": "number|null",
  "classifierSource": "rules | llm | fallback | null",
  "createdAt": "Date"
}
```

### products

```json
{
  "_id": "ObjectId",
  "sku": "RICE-5KG",               // unique
  "name": "string",
  "aliases": ["rice", "ofada rice"],
  "category": "string",
  "priceNGN": 8500,
  "stock": 40,
  "active": true
}
```

Text index on `name` and `aliases`.

### orders

```json
{
  "_id": "ObjectId",
  "orderId": "ORD-20261007-0001",  // unique, human readable
  "customerId": "ObjectId",
  "conversationId": "ObjectId",
  "items": [{ "sku": "string", "name": "string", "quantity": 2, "unitPriceNGN": 8500 }],
  "totalNGN": 17000,
  "deliveryAddress": "string",
  "contactPhone": "+234...",
  "status": "pending_confirmation | confirmed | dispatched | delivered | cancelled",
  "createdAt": "Date",
  "updatedAt": "Date"
}
```

### tickets

```json
{
  "_id": "ObjectId",
  "ticketId": "TKT-0001",          // unique
  "conversationId": "ObjectId",
  "customerId": "ObjectId",
  "reason": "complaint | refund | low_confidence | ai_unavailable | invalid_data | unknown_intent | customer_requested",
  "priority": "low | normal | high",
  "status": "open | assigned | in_progress | resolved | closed",
  "assignee": "string|null",
  "summary": "string",
  "notificationStatus": "sent | failed | pending",
  "resolutionNote": "string|null",
  "createdAt": "Date",
  "firstResponseAt": "Date|null",
  "resolvedAt": "Date|null"
}
```

### auditevents

```json
{
  "_id": "ObjectId",
  "correlationId": "uuid",
  "type": "MESSAGE_RECEIVED | DUPLICATE_IGNORED | CLASSIFIED | CLASSIFIER_FALLBACK | REPLY_SENT | ORDER_CREATED | TICKET_CREATED | TICKET_UPDATED | NOTIFICATION_SENT | NOTIFICATION_FAILED | WEBHOOK_REJECTED | PAYLOAD_INVALID | VALIDATION_FAILED",
  "entityType": "message | conversation | order | ticket | system",
  "entityId": "string|null",
  "actor": "system | customer | staff:<name>",
  "detail": { },
  "createdAt": "Date"
}
```

Indexes: `{ createdAt: -1 }`, `{ type: 1, createdAt: -1 }`. Audit events are append-only (no update or delete routes).

## 8. API Endpoint Schemas

**Conventions:** JSON over HTTPS; `x-correlation-id` header returned on every response; staff endpoints require header `x-api-key: <STAFF_API_KEY>`; timestamps are ISO 8601 UTC.

**Standard error body:**

```json
{ "error": { "code": "VALIDATION_ERROR", "message": "quantity must be between 1 and 50", "details": [ ] }, "correlationId": "uuid" }
```

Codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401), `NOT_FOUND` (404), `RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `DEPENDENCY_UNAVAILABLE` (503).

### 8.1 GET /webhook (verification handshake)

Auth: none (verify token).

Query: `hub.mode=subscribe`, `hub.verify_token=<string>`, `hub.challenge=<string>`

| Response | Body |
| --- | --- |
| 200 | the `hub.challenge` value as plain text |
| 403 | token mismatch |

### 8.2 POST /webhook (incoming WhatsApp message)

Auth: header `X-Hub-Signature-256: sha256=<hmac of raw body using APP_SECRET>`.

Request (Meta Cloud API shape, trimmed):

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "field": "messages",
      "value": {
        "messaging_product": "whatsapp",
        "contacts": [{ "profile": { "name": "Test Customer" }, "wa_id": "2348012345678" }],
        "messages": [{
          "from": "2348012345678",
          "id": "wamid.TEST0001",
          "timestamp": "1791360000",
          "type": "text",
          "text": { "body": "How much is a bag of rice?" }
        }]
      }
    }]
  }]
}
```

Responses:

| Status | Body |
| --- | --- |
| 200 | `{ "status": "received" }` (processing continues; always 200 to prevent provider retries) |
| 400 | standard error (invalid payload) |
| 401 | standard error (bad signature) |

Non-text message types (image, audio) receive a polite reply asking for text and are logged; sensitive content escalates.

### 8.3 POST /simulate/message (test harness)

Auth: `x-api-key` (disabled when `NODE_ENV=production`).

Request:

```json
{
  "from": "+2348012345678",           // required, Nigerian format
  "name": "Test Customer",            // optional
  "text": "I want to buy 2 bags of rice",   // required, 1-1000 chars
  "messageId": "sim-0001",            // optional; auto-generated if absent (supply it to test duplicates)
  "forceLlmFailure": false            // optional test flag to simulate AI outage
}
```

Response 200:

```json
{
  "correlationId": "uuid",
  "duplicate": false,
  "intent": "place_order",
  "confidence": 0.86,
  "classifierSource": "rules",
  "replies": ["Great! Which product would you like?"],
  "conversation": { "id": "ObjectId", "state": "COLLECT_ITEM", "status": "active" },
  "ticketId": null,
  "orderId": null
}
```

### 8.4 GET /api/products

Auth: `x-api-key`. Query: `q` (string), `category` (string), `inStock` (boolean), `limit` (1-100, default 20), `page` (default 1).

Response 200:

```json
{
  "data": [{ "sku": "RICE-5KG", "name": "Rice 5kg", "category": "Grains", "priceNGN": 8500, "stock": 40, "active": true }],
  "page": 1, "limit": 20, "total": 1
}
```

### 8.5 GET /api/products/:sku

Response 200: a single product object (schema as above). 404 if not found.

### 8.6 GET /api/orders

Auth: `x-api-key`. Query: `status`, `phone`, `from`, `to`, `limit`, `page`.

Response 200:

```json
{
  "data": [{
    "orderId": "ORD-20261007-0001",
    "status": "pending_confirmation",
    "totalNGN": 17000,
    "items": [{ "sku": "RICE-5KG", "name": "Rice 5kg", "quantity": 2, "unitPriceNGN": 8500 }],
    "deliveryAddress": "12 Example Street, Yaba, Lagos",
    "contactPhone": "+2348012345678",
    "createdAt": "2026-10-07T10:00:00Z"
  }],
  "page": 1, "limit": 20, "total": 1
}
```

### 8.7 GET /api/orders/:orderId

Response 200: single order object. 404 if unknown.

### 8.8 PATCH /api/orders/:orderId

Request:

```json
{ "status": "confirmed | dispatched | delivered | cancelled", "note": "optional string" }
```

Response 200: updated order. Allowed transitions enforced (`pending_confirmation` to `confirmed` or `cancelled`, `confirmed` to `dispatched`, `dispatched` to `delivered`); invalid transition returns 400. Writes `ORDER_UPDATED` audit event.

### 8.9 GET /api/tickets

Query: `status`, `priority`, `assignee`, `overdue` (boolean), `limit`, `page`.

Response 200:

```json
{
  "data": [{
    "ticketId": "TKT-0001",
    "reason": "complaint",
    "priority": "high",
    "status": "open",
    "assignee": null,
    "summary": "Customer reports damaged item on ORD-20261006-0004",
    "notificationStatus": "sent",
    "overdue": false,
    "createdAt": "2026-10-07T10:05:00Z"
  }],
  "page": 1, "limit": 20, "total": 1
}
```

### 8.10 GET /api/tickets/:ticketId

Response 200: ticket object plus `conversation` (last 20 messages) for context.

### 8.11 PATCH /api/tickets/:ticketId

Request:

```json
{
  "status": "assigned | in_progress | resolved | closed",   // optional
  "assignee": "Amaka",                                        // optional
  "resolutionNote": "Refund handled manually via transfer"    // required when status = resolved
}
```

Response 200: updated ticket. Sets `firstResponseAt` on first assignment and `resolvedAt` on resolve. Writes `TICKET_UPDATED` audit event.

### 8.12 GET /api/conversations

Query: `status`, `phone`, `limit`, `page`. Response: list of conversations with `{ id, customerPhone, status, state, currentIntent, lastMessageAt }`.

### 8.13 GET /api/conversations/:id/messages

Response 200:

```json
{
  "data": [{ "direction": "inbound", "text": "...", "intent": "price_check", "confidence": 0.9, "classifierSource": "rules", "createdAt": "..." }]
}
```

### 8.14 GET /api/audit

Query: `type`, `entityType`, `entityId`, `correlationId`, `from`, `to`, `limit` (max 200), `cursor`.

Response 200:

```json
{
  "data": [{ "type": "CLASSIFIED", "correlationId": "uuid", "entityType": "message", "entityId": "wamid.TEST0001", "actor": "system", "detail": { "intent": "price_check", "confidence": 0.9, "source": "rules" }, "createdAt": "2026-10-07T10:00:01Z" }],
  "nextCursor": "string|null"
}
```

### 8.15 GET /api/metrics

Query: `from`, `to` (default: last 24 hours).

Response 200:

```json
{
  "period": { "from": "2026-10-06T10:00:00Z", "to": "2026-10-07T10:00:00Z" },
  "totalMessages": 120,
  "totalConversations": 48,
  "intentBreakdown": { "product_enquiry": 14, "price_check": 18, "place_order": 9, "order_status": 5, "complaint_or_refund": 2, "unknown": 0 },
  "classifier": { "rules": 38, "llm": 8, "fallback": 2 },
  "ordersCreated": 7,
  "escalationRate": 0.10,
  "tickets": { "open": 2, "assigned": 1, "resolved": 3, "overdue": 1 },
  "unresolvedConversations": 3,
  "avgAutoResponseMs": 640,
  "avgFirstHumanResponseMin": 9.5,
  "failures": { "duplicatesIgnored": 3, "llmFailures": 2, "notificationFailures": 0, "validationRetries": 6 }
}
```

### 8.16 GET /health

Auth: none.

```json
{
  "status": "ok | degraded | down",
  "uptimeSec": 3600,
  "checks": { "mongo": "up", "llm": "up | down | disabled", "notifier": "up | down | disabled" },
  "version": "1.0.0"
}
```

Returns 200 for `ok` or `degraded` (AI or notifier down but core works), 503 when MongoDB is down.

### 8.17 Dashboard

`GET /dashboard` serves static HTML that polls `/api/metrics`, `/api/tickets?status=open`, and `/api/audit?limit=20`.

## 9. Failure Conditions Handled

| # | Failure | Detection | Response | Evidence |
| --- | --- | --- | --- | --- |
| 1 | AI unavailable, timeout, invalid JSON, or low confidence | 5s timeout, Zod parse failure, confidence below 0.6 | Fall back to rules; if still unclear, escalate with reason `ai_unavailable` or `low_confidence` | Audit `CLASSIFIER_FALLBACK`, ticket created |
| 2 | Duplicate message | Unique index on `providerMessageId` | Ignore, no second reply, audit `DUPLICATE_IGNORED` | Same messageId sent twice |
| 3 | Missing or invalid order data | Zod and business validation per slot | Re-prompt twice, then escalate (`invalid_data`) | Audit `VALIDATION_FAILED` |
| 4 (bonus) | Notification channel down | Telegram error or timeout | Retry 3 times with backoff, mark `notificationStatus=failed`, show on dashboard | Audit `NOTIFICATION_FAILED` |

Choose #1 as the video failure path and evidence #2 and #3 in the test record.

## 10. Build Plan (about 8 hours of focused work)

| Block | Hours | Tasks | Done when |
| --- | --- | --- | --- |
| 0. Setup | 0.5 | Repo, Docker Compose, `.env.example`, env validation, Mongo connection, seed script | `docker compose up` runs, `/health` returns ok |
| 1. Core pipeline | 1.5 | Webhook GET/POST, signature middleware, Zod schemas, message persistence, dedupe, audit service, correlation IDs | Payload accepted, audit events written, duplicates ignored |
| 2. Classification | 1.0 | Rules classifier, LLM adapter (Gemini or Groq), thresholds, fallback logic, `forceLlmFailure` flag | All 5 intents classified; fallback tested |
| 3. Intent handlers | 1.5 | Product and price replies, order status lookup, order slot-filling state machine, phone normaliser, templates | Full order flow creates an Order |
| 4. Escalation | 0.75 | Ticket service, Telegram notifier with retry, staff endpoints, holding message | Complaint creates ticket and Telegram alert |
| 5. Metrics and dashboard | 0.75 | Aggregations, `/api/metrics`, HTML dashboard | Dashboard shows live numbers |
| 6. Tests and test record | 1.0 | Test inputs, automated tests, results table | Every intent, escalation, both failures covered |
| 7. Written items | 1.5 | Items A, B (diagram), E, F, G, H | Concise labelled document |
| 8. Demo video | 0.5 | Record success, escalation, failure paths, audit log, dashboard | 5 to 8 minutes |
| Buffer | 1.0 | Clean-clone test, README, secrets check | Fresh clone runs end to end |

**Schedule across the 72-hour window (suggested):** Day 1 blocks 0 to 3; Day 2 blocks 4 to 6; Day 3 blocks 7, 8, buffer, submit with margin.

## 11. Test Record Template (Item C)

| ID | Input | Expected | Actual | Pass |
| --- | --- | --- | --- | --- |
| T1 | "Do you have rice?" | `product_enquiry`, catalogue reply |  |  |
| T2 | "How much is 5kg rice?" | `price_check`, price reply |  |  |
| T3 | "I want to order 2 bags of rice" then address and YES | `place_order`, order created, ORD id returned |  |  |
| T4 | "Where is my order ORD-...?" | `order_status`, status reply |  |  |
| T5 | "My item came damaged, I want a refund" | `complaint_or_refund`, ticket, Telegram alert |  |  |
| T6 | Same messageId sent twice | Second ignored, `DUPLICATE_IGNORED` audit |  |  |
| T7 | Order with quantity "abc" three times | Re-prompt twice, then escalate `invalid_data` |  |  |
| T8 | Ambiguous text with `forceLlmFailure=true` | Fallback, escalation `ai_unavailable` |  |  |
| T9 | Invalid webhook signature | 401, `WEBHOOK_REJECTED` audit |  |  |
| T10 | Telegram token invalid | Retries, `notificationStatus=failed`, flagged on dashboard |  |  |

Store synthetic inputs in `test_inputs/` as JSON files named by test ID.

## 12. Environment Variables (`.env.example`)

```
NODE_ENV=development
PORT=3000
MONGODB_URI=mongodb://mongo:27017/freshmart
STAFF_API_KEY=change-me
WHATSAPP_VERIFY_TOKEN=change-me
WHATSAPP_APP_SECRET=change-me
LLM_PROVIDER=gemini            # gemini | groq | ollama | none
LLM_API_KEY=
LLM_MODEL=
LLM_TIMEOUT_MS=5000
CONFIDENCE_THRESHOLD=0.6
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TICKET_SLA_MINUTES=15
```

## 13. Mapping to the Required Submission Package

| Item | Content | Source in this plan |
| --- | --- | --- |
| A. Problem and Solution Brief (3 pages max) | Problem, users, assumptions, scope, not automated | Sections 1, 2 |
| B. Architecture (1 diagram + 1 page) | Flow diagram, storage, escalation, logging, failure handling | Sections 5, 7, 9 |
| C. Prototype and Test Record | Repo, SETUP, test inputs, results table, simulated vs working | Sections 6, 11, 12 |
| D. Demo Video (5 to 8 min) | Success, escalation, failure path, audit and dashboard | Section 10 block 8 |
| E. Cost and Feasibility (1 page) | See section 14 | Section 14 |
| F. Risk, Reliability, Security (2 pages) | See section 15 | Section 15 |
| G. Operations Runbook (2 pages) | See section 16 | Section 16 |
| H. Handover and 90-Day Plan (1 page) | See section 17 | Section 17 |

README must disclose AI tools used (required by the brief) and contain no secrets.

## 14. Cost and Commercial Feasibility (Item E outline)

- **Setup cost:** near zero in tooling (free tiers); cost is engineering time.
- **Monthly operating cost (pilot):** Atlas M0 free, free LLM tier, Telegram free, hosting on a free tier or a small VPS (low single-digit USD). Quote in naira with a stated exchange-rate assumption.
- **Main cost drivers in production:** WhatsApp Business conversation fees, LLM volume beyond free tier, hosting, MongoDB storage growth, and human support time.
- **Cost control:** rules-first classification keeps most messages off the LLM; short prompts; response caching for catalogue questions.
- **Pricing approach:** one-off setup fee plus monthly subscription tiered by message volume, with WhatsApp fees passed through at cost.
- **Affordability test:** show monthly cost as a small fraction of one part-time staff salary and the hours saved.

## 15. Risk, Reliability, and Security (Item F outline, 5+ risks)

| Risk | Mitigation |
| --- | --- |
| Webhook spoofing | HMAC signature check, verify token, rate limiting |
| LLM misclassification or prompt injection | JSON-only output validated by Zod, allowed-intent list, no tool execution, human escalation on low confidence |
| Duplicate or replayed messages | Unique `providerMessageId`, idempotent handling |
| Personal data exposure (NDPA 2023) | Data minimisation, consent record, access control on staff endpoints, no PII in logs, retention policy and deletion route, synthetic data only in prototype |
| Provider dependency or outage (LLM, WhatsApp, Telegram) | Adapter interfaces, rules fallback, retries, health checks |
| Staff notification missed | Retry, `notificationStatus`, overdue ticket flag on dashboard |
| Data loss | Scheduled `mongodump`, tested restore |
| Misuse of staff endpoints | API key now, JWT and RBAC planned, audit of staff actions |
| Audit tampering | Append-only audit collection, no update or delete routes |

## 16. Operations Runbook (Item G outline)

- **Start:** copy `.env.example` to `.env`, `docker compose up -d`, run `npm run seed`, check `/health`.
- **Monitor:** dashboard (open tickets, overdue, escalation rate), `/health` degraded states, pino logs searchable by correlation ID.
- **Troubleshoot:** AI degraded (check key, quota, switch `LLM_PROVIDER` or set `none`); Telegram failing (check token and chat ID, review `notificationStatus=failed` tickets); duplicates spiking (check provider retries); Mongo down (restart container, verify volume).
- **Maintain:** rotate keys quarterly, `mongodump` daily, update catalogue via seed or admin script, review audit weekly, dependency updates monthly.

## 17. Handover and 90-Day Plan (Item H outline)

- **Junior handover:** walkthrough of the pipeline, a starter task (add a new intent with rules, template, and test), pull request review checklist (tests pass, audit events added, no secrets, docs updated).
- **30 days:** real WhatsApp Cloud API sandbox, JWT auth with roles, retention and deletion policy, CI with tests.
- **60 days:** queue and retry worker, alerting (uptime plus ticket SLA), Pidgin test set, backups automated.
- **90 days:** payment confirmation integration, analytics for manager reports, load test, production hardening review.

## 18. Live-Stage Preparation

Be ready to explain and modify every file. Expect these changes:

| Likely change | Where to change it |
| --- | --- |
| Add a new intent | `classifier/rules.js`, templates, handler, test |
| Budget cut: drop the LLM | Set `LLM_PROVIDER=none`; rules-only plus escalation |
| LLM or Telegram broken | Adapter fallback, retries, health output |
| Security concern on staff endpoints | Add API key rotation or JWT middleware |
| Handover request | README, SETUP, runbook, starter task |

First likely failure in real use: the LLM provider (rate limits) or the notification channel. Monitor through `/health`, failure counters in `/api/metrics`, and overdue tickets.

## 19. Process Reminders

1. Confirm receipt by replying to the AIL email; your 72-hour window starts at their confirmed start time (WAT).
2. Send clarification questions within the first 12 hours to Precious Okogun via careers@angelintelligenceltd.com.
3. Submit before the deadline with the subject: Lead Systems & Automation Engineer Assessment – \[Your Full Name\], and refer to the brief as Version 1.1.
4. Keep repository and video links accessible for at least 14 days; do not modify them after submission.
5. Use synthetic data only and include no credentials.
