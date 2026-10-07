# Lead System Manager — WhatsApp Retail Automation API

Backend for **Lagos Fresh Mart**'s automated WhatsApp customer service. Customers send
natural-language messages ("Do you have 5kg rice?", "I want to order 2 bags of rice"),
the API classifies each message into one of five intents, answers price/stock questions
from a product catalogue, takes orders, tracks complaints as tickets, and keeps an
append-only audit trail of everything.

> **Channel decision:** all messaging — customer replies *and* staff notifications — goes
> through the WhatsApp adapter. There is no Telegram integration (see `docs/DECISIONS.md`).
> In the default **simulated** mode no Meta account is needed: outbound messages are logged
> to stdout and to `logs/whatsapp-outbound.log` instead of being sent.

---

## Table of contents

1. [Current status](#current-status)
2. [Tech stack](#tech-stack)
3. [Requirements](#requirements)
4. [Quick start](#quick-start)
5. [Running MongoDB](#running-mongodb)
6. [Running the API](#running-the-api)
7. [Simulated vs live mode](#simulated-vs-live-mode)
8. [The workflow, stage by stage](#the-workflow-stage-by-stage)
9. [Configuration reference](#configuration-reference)
10. [Obtaining keys and secrets](#obtaining-keys-and-secrets)
11. [Trying the API by hand](#trying-the-api-by-hand)
12. [Testing and linting](#testing-and-linting)
13. [Project structure](#project-structure)
14. [API reference](#api-reference)
15. [Troubleshooting](#troubleshooting)
16. [AI tools disclosure](#ai-tools-disclosure)
17. [Roadmap](#roadmap)

---

## Current status

Sprints 0–3 are implemented (tasks T-001 to T-016):

- Repository setup, Dockerfile, docker-compose, environment validation (`src/config/env.js`)
- Products/customer/conversation/message/order/ticket/audit models and the seed script (`30`-product synthetic catalogue)
- Standard error handling, `x-correlation-id` on every response, structured pino logging
- `GET /health` with mongo/llm/notifier checks (503 when Mongo is down)
- `POST /webhook` with HMAC-SHA256 signature verification, payload validation, instant 200 + async processing, audit events for rejects
- `POST /simulate/message` (staff API key) to drive the pipeline without Meta, and the WhatsApp adapter (simulated + Cloud API modes)
- The message pipeline is **live end to end**: it persists the customer + conversation, dedupes repeat deliveries by `providerMessageId` (workplan failure #2), classifies each message (rules first, Ollama Cloud LLM when unsure, safe fallback), answers stock/price/order-status questions and records the full audit trail
- `place_order` runs a **slot-filling state machine** (item → quantity → address → YES/NO confirm) that creates a real Order (`ORD-20261007-0001`, status `pending_confirmation`) and audits `ORDER_CREATED`; `cancel`/`human` escape mid-flow, invalid answers re-prompt twice then escalate, and conversations idle 30+ minutes expire lazily
- The staff **orders API** (`/api/orders`, `x-api-key`) lists/filters orders, fetches one by reference and enforces the status transition table with `ORDER_UPDATED` audits
- Every unsafe conversation escalates into a **ticket**: complaints/refunds, unknown-intent second misses, AI outages, repeated invalid data and explicit human requests create `TKT-####` references and the customer reply quotes the reference; staff work the queue through `GET/GET-one/PATCH /api/tickets` with `TICKET_CREATED`/`TICKET_UPDATED` audits and a derived SLA `overdue` flag
- Each new ticket triggers a **WhatsApp staff notification** to `STAFF_WHATSAPP_NUMBER` (3 attempts with backoff); delivery state lands on the ticket (`notificationStatus`) and in the audit (`NOTIFICATION_SENT`/`NOTIFICATION_FAILED`), so a dead channel is flagged instead of silently losing the escalation
- The **operations dashboard** at `/dashboard` (static page, staff-key prompt, 10 s auto-refresh) renders metrics tiles, intent/classifier charts and the ticket + audit tables from `GET /api/metrics` and the cursor-paginated `GET /api/audit`
- The API is **self-documented**: an OpenAPI 3.0 document at `/openapi.json` rendered by self-hosted RapiDoc at `/docs`
- **Sprint 4 in progress** — T-017–T-020: full test record T1–T10, security hardening, SETUP/RUNBOOK docs, demo script (the README pass in this sprint is part of T-019)

---

## Tech stack

- **Node.js** (ES modules) + **Express 4**
- **MongoDB** via **Mongoose 8**
- **Zod** for all input/env validation
- **pino / pino-http** structured JSON logging with correlation ids
- **helmet** + **express-rate-limit** for HTTP hardening
- **node:test** (built-in runner) + **supertest** + **mongodb-memory-server** for tests — no database or Docker needed to run the suite

---

## Requirements

| Requirement | Notes |
|---|---|
| Node.js >= 20 | Developed and tested on Node 25 |
| npm | Ships with Node |
| MongoDB | Not needed up front — see [Running MongoDB](#running-mongodb) for the three options (Docker, in-memory dev script, Atlas) |
| Docker Desktop | Optional, only if you want the compose stack or a containerized Mongo |
| Public HTTPS URL | Only needed when connecting **real** WhatsApp traffic (ngrok works) |

> Note: the project deliberately uses the built-in `node:test` runner. Vitest was tried
> first but its module runner is not compatible with Node 25, so the suite runs on the
> native runner which requires zero extra tooling.

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Create your environment file
copy .env.example .env        # Windows (cmd)
# cp .env.example .env        # macOS / Linux
#    then set STAFF_API_KEY - the README examples use "dev-staff-key-0001"
#    (generate a strong value for real use; see "Obtaining keys and secrets")

# 3. Start MongoDB — pick ONE option from "Running MongoDB" below, e.g. no Docker:
npm run dev:mongo             # terminal 1 (in-memory, resets on exit; dev only)

# 4. Seed the product catalogue (30 products, idempotent)
npm run seed

# 5. Start the API
npm run dev                   # or: npm start

# 6. Verify
curl http://localhost:3000/health
# -> {"status":"ok","checks":{"mongo":"up",...},"version":"1.0.0"}
```

The `.env` created from `.env.example` works as-is for local development in simulated
WhatsApp mode — every value is a placeholder, nothing external is required.

## Running MongoDB

Pick whichever fits your machine; the app only needs `MONGODB_URI` to point at it.

**Option A — Docker (recommended when Docker Desktop is running)**

```bash
docker compose up -d mongo
# MongoDB on localhost:27017, data persisted in the mongo_data volume
```

**Option B — No Docker: in-memory MongoDB for development**

```bash
npm run dev:mongo
# Starts mongodb-memory-server on port 27017.
# All data is lost when you stop it — perfect for local demos.
```

**Option C — MongoDB Atlas (free tier)**

Create a cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas) (see
[Obtaining keys and secrets](#obtaining-keys-and-secrets)) and set:

```
MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/lead_system_manager
```

## Running the API

**Locally (fastest loop)**

```bash
npm run dev      # node --watch, restarts on file changes
npm start        # plain run
```

The server listens on `PORT` (default `3000`).

**Docker compose (api + mongo together)**

```bash
docker compose up --build
```

The compose file overrides `MONGODB_URI` inside the container to point at the `mongo`
service (`mongodb://mongo:27017/lead_system_manager`); existing environment variables
always win over `.env` because dotenv never overrides them.

**Useful scripts**

| Script | What it does |
|---|---|
| `npm run dev` | Start with `--watch` |
| `npm start` | Start once |
| `npm run seed` | Upsert the 30-product catalogue (idempotent) |
| `npm run seed -- --reset` | Clear products first, then seed |
| `npm run dev:mongo` | In-memory MongoDB on 27017 (no Docker) |
| `npm test` | Full test suite (node:test + in-memory Mongo) |
| `npm run lint` | ESLint |

## Simulated vs live mode

One variable decides whether messages really leave the building: `WHATSAPP_MODE`. Everything
else — classification, orders, tickets, staff alerts — behaves identically in both modes; only
the transport changes.

| | `simulated` (default) | `cloud` (live) |
|---|---|---|
| External accounts | none | Meta app + WhatsApp Cloud API |
| Inbound traffic | `POST /simulate/message`, or signed fake webhooks via `scripts/send-webhook.js` | Meta delivers real customer messages to `POST /webhook` |
| Outbound traffic (customer replies *and* staff alerts) | logged to stdout and `logs/whatsapp-outbound.log` | sent through the Graph API to real phone numbers |
| Use it for | local development, demos, the test suite | a pilot with real customers |

### Run the simulation (default — nothing external needed)

1. Start the stack: `npm run dev:mongo`, `npm run seed`, `npm start` (see Quick start).
2. Drive an inbound message:

   ```bash
   curl -X POST http://localhost:3000/simulate/message \
     -H "content-type: application/json" -H "x-api-key: dev-staff-key-0001" \
     -d '{"from":"+2348012345678","text":"How much is 5kg rice?"}'
   ```

3. Nothing is sent to WhatsApp: the reply appears in the response (`replies`), on stdout and as
   one JSON line in `logs/whatsapp-outbound.log`. Replay the whole journey with
   `GET /api/audit?correlationId=<id from the response>`.

The simulation kit also covers the awkward paths:

- `node scripts/send-webhook.js` — the *real* signed-webhook route (add `--bad-signature` for a
  401, resend an `--id` for duplicate handling)
- `"forceLlmFailure": true` in the simulate body — failure #1 (AI outage)
- `WHATSAPP_FORCE_SEND_FAILURE=true` — failure #4 (staff notification channel down)

### Switch to live (WhatsApp Cloud API)

1. Complete the checklist in [Obtaining keys and secrets](#obtaining-keys-and-secrets) — Meta
   app, phone number ID, access token, app secret, verify token, `STAFF_WHATSAPP_NUMBER`.
2. In `.env` set `WHATSAPP_MODE=cloud` plus the WhatsApp values from step 1.
3. Expose the API over HTTPS: `ngrok http 3000`, then in Meta's app dashboard
   (WhatsApp → Configuration) set the callback URL to `https://<id>.ngrok-free.app/webhook` with
   your `WHATSAPP_VERIFY_TOKEN`, and subscribe to the `messages` field.
4. Restart the API and check `GET /health` — `checks.notifier` reports `up` once the access
   token and phone number ID are present.
5. Message the business test number from your phone: the reply arrives in real WhatsApp, and
   `GET /api/audit?correlationId=...` replays the delivery (Meta's `wamid` is the message id).

Notes: the free test token expires after 24 hours — use a system-user token for anything longer;
switching back is just `WHATSAPP_MODE=simulated`; the classifier has an independent switch of
the same style (`LLM_PROVIDER=none` for rules-only, or `gemini` / `groq` / `ollama` for real AI).

## The workflow, stage by stage

```
customer message
   │
   ├─ live      : POST /webhook (Meta-signed)
   └─ simulated : POST /simulate/message or scripts/send-webhook.js
        │
        ▼
   pipeline: dedupe ▸ classify ▸ handle
        ├─ question        ▸ reply via adapter
        ├─ place_order     ▸ slot filling ▸ Order (ORD-…)
        └─ unsafe/unclear  ▸ Ticket (TKT-…) + staff alert

staff: /api/orders ▸ /api/tickets      ops: /api/metrics ▸ /api/audit ▸ /dashboard ▸ /docs ▸ /health
```

| # | Stage | Endpoint(s) | What to know |
|---|---|---|---|
| 0 | Bring the system up | `npm run dev:mongo`, `npm run seed`, `npm start`, then `GET /health` | `GET /health` is also the monitoring probe: 200 `ok`/`degraded`, 503 when Mongo is down |
| 1 | A message arrives | **live:** `GET /webhook` (handshake, once) and `POST /webhook` · **simulated:** `POST /simulate/message` or `scripts/send-webhook.js` | The POST always answers `200` fast; processing happens asynchronously |
| 2 | Pipeline runs (automatic) | — (internal) | Dedupe by `providerMessageId`, persist customer/conversation/message, classify (rules → LLM → safe fallback), audit everything — watch it with `GET /api/audit?correlationId=…` |
| 3a | Question answered | reply goes out via the adapter | `product_enquiry` / `price_check` / `order_status` answered from the catalogue or order data |
| 3b | Order taken | completion → Order; staff side: `GET /api/orders`, `GET /api/orders/:orderId`, `PATCH /api/orders/:orderId` | Slot filling item → quantity → address → YES; staff move it `confirmed` → `dispatched` → `delivered` |
| 3c | Escalation raised | completion → Ticket + WhatsApp staff alert; staff side: `GET /api/tickets`, `GET /api/tickets/:ticketId`, `PATCH /api/tickets/:ticketId` | Complaint / refund / unknown / AI outage → `TKT-####` quoted to the customer; staff assign → in progress → resolve (note required) → close |
| 4 | Observe and trace | `GET /api/metrics`, `GET /api/audit`, `/dashboard`, `/docs`, `GET /health` | Metrics = window figures + live backlog snapshot; audit = every event, keyset-cursor paginated |

Every simulate response includes its `correlationId`, and every webhook-derived audit event
carries one too: grep a single id through `GET /api/audit?correlationId=…` and the server logs
to replay any message end to end. All staff endpoints (`/simulate/*`, `/api/*`) expect the
`x-api-key` header — see [Obtaining keys and secrets](#obtaining-keys-and-secrets).

## Configuration reference

All variables are validated at startup by `src/config/env.js` (Zod). Invalid values —
including production runs that still use `change-me` secrets — abort the process with a
readable error. See `.env.example` for a ready-to-copy template.

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `PORT` | `3000` | HTTP port |
| `LOG_LEVEL` | `info` | pino level (`silent` disables logs) |
| `MONGODB_URI` | `mongodb://localhost:27017/freshmart` | Mongo connection string |
| `STAFF_API_KEY` | `change-me` | Key for `x-api-key` staff endpoints (`/simulate/*`) |
| `WHATSAPP_MODE` | `simulated` | `simulated` (log only) or `cloud` (real Graph API sends) |
| `WHATSAPP_VERIFY_TOKEN` | `change-me` | Your own secret string; echoed during Meta's webhook handshake |
| `WHATSAPP_APP_SECRET` | `change-me` | Meta app secret; verifies `x-hub-signature-256` on incoming webhooks |
| `WHATSAPP_PHONE_NUMBER_ID` | — | Cloud API sender id (required when `WHATSAPP_MODE=cloud`) |
| `WHATSAPP_ACCESS_TOKEN` | — | Cloud API bearer token (required when `WHATSAPP_MODE=cloud`) |
| `WHATSAPP_API_VERSION` | `v19.0` | Graph API version, e.g. `v19.0` |
| `WHATSAPP_FORCE_SEND_FAILURE` | `false` | Test hook: force every send to fail (demo of the notifier-failure path) |
| `STAFF_WHATSAPP_NUMBER` | — | E.164 number that receives escalation/complaint alerts |
| `LLM_PROVIDER` | `none` | `none` / `gemini` / `groq` / `ollama` (Ollama Cloud). `none` = rules only, still fully functional |
| `LLM_API_KEY` | — | Required for `gemini` / `groq` |
| `LLM_MODEL` | provider default | e.g. `gemini-2.0-flash`, `llama-3.3-70b-versatile`, `gpt-oss:120b` (Ollama default) |
| `LLM_TIMEOUT_MS` | `5000` | Classifier call timeout before falling back to rules |
| `OLLAMA_BASE_URL` | `https://ollama.com` | Ollama **Cloud** API base — there is no local Ollama setup |
| `OLLAMA_API_KEY` | — | Required for `LLM_PROVIDER=ollama`; create one at [ollama.com](https://ollama.com) |
| `CONFIDENCE_THRESHOLD` | `0.6` | Below this an LLM result is treated as unsure → fallback/escalation |
| `RULES_CONFIDENCE_THRESHOLD` | `0.7` | Rules results at or above this skip the LLM entirely |
| `TICKET_SLA_MINUTES` | `15` | Tickets older than this are flagged overdue |

Rules enforced by validation:

- `NODE_ENV=production` refuses `change-me` for `STAFF_API_KEY`, `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET`
- `WHATSAPP_MODE=cloud` requires `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN`
- `LLM_PROVIDER=gemini|groq` requires `LLM_API_KEY`; `LLM_PROVIDER=ollama` requires `OLLAMA_API_KEY` (Ollama Cloud is keyed)

## Obtaining keys and secrets

Everything below is optional for local development — the checklist at the end of each
section tells you exactly which `.env` values to paste. **Never commit real secrets:**
`.env` is gitignored; keep only placeholders in `.env.example`.

### WhatsApp Cloud API (Meta) — for real messaging

This is the only external messaging integration (no Telegram). You can do all of this
with a free Meta developer account while on the test number.

1. **Create a Meta app.** Go to [developers.facebook.com](https://developers.facebook.com)
   → *My Apps* → *Create App* → type **Business** → link a Meta Business account.
2. **Add the WhatsApp product.** In the app dashboard choose *WhatsApp → Set up*.
   The *API Setup* page shows:
   - a **test phone number** you can send from (free, up to 5 recipient numbers),
   - the **Phone number ID** → `WHATSAPP_PHONE_NUMBER_ID`,
   - a **temporary access token** (24 h) → `WHATSAPP_ACCESS_TOKEN` for quick tests.
3. **App secret.** *App Settings → Basic → App Secret* (click *Show*) →
   `WHATSAPP_APP_SECRET`. This is what your API uses to verify the
   `x-hub-signature-256` header on every incoming webhook.
4. **Verify token.** Make one up — any random string, e.g. 32 hex characters. Put it in
   `.env` as `WHATSAPP_VERIFY_TOKEN`; you will type the same value into Meta's webhook
   configuration so both sides can complete the handshake:
   `GET /webhook?hub.mode=subscribe&hub.verify_token=...&hub.challenge=...`.
5. **Expose your API publicly** (Meta must reach it over HTTPS):
   ```bash
   ngrok http 3000
   # then in WhatsApp → Configuration → Webhook:
   #   Callback URL : https://<your-id>.ngrok-free.app/webhook
   #   Verify token : the exact WHATSAPP_VERIFY_TOKEN from your .env
   ```
   Save, then **subscribe to the `messages` field** on the same page.
6. **Switch to cloud mode.** Set `WHATSAPP_MODE=cloud` in `.env`. Your server now sends
   real replies through the Graph API instead of logging them.
7. **Permanent access token (for anything beyond a test).** In *Business Settings →
   Users → System Users* create a system user, assign the app + WhatsApp asset, and
   generate a token with the `whatsapp_business_messaging` permission. Use that as
   `WHATSAPP_ACCESS_TOKEN` — temporary tokens expire after 24 h.
8. Optional: put your own WhatsApp number in `STAFF_WHATSAPP_NUMBER` (E.164, e.g.
   `+2348012345678`) to receive escalations once staff notifications land (T-014).

**Checklist:** `WHATSAPP_MODE=cloud`, `WHATSAPP_API_VERSION` (match the version shown in
API Setup), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`,
`WHATSAPP_VERIFY_TOKEN`, `STAFF_WHATSAPP_NUMBER`.

### LLM classification (optional)

The hybrid classifier always runs the rules first; when they are unsure (below
`RULES_CONFIDENCE_THRESHOLD`) it consults the configured LLM, and degrades safely (rules
opinion or human hand-off) if the provider fails. With `LLM_PROVIDER=none` (the default)
it is rules-only and still fully functional. Pick one provider:

- **Google Gemini** — create a key at [aistudio.google.com](https://aistudio.google.com)
  (*Get API key*). Set `LLM_PROVIDER=gemini`, `LLM_API_KEY=<key>`,
  `LLM_MODEL=gemini-2.0-flash` (or another current model).
- **Groq** — create a key at [console.groq.com](https://console.groq.com) (*API Keys*).
  Set `LLM_PROVIDER=groq`, `LLM_API_KEY=<key>`,
  `LLM_MODEL=llama-3.3-70b-versatile`.
- **Ollama Cloud** — sign in at [ollama.com](https://ollama.com) and create an API key
  in your account settings. Set `LLM_PROVIDER=ollama`, `OLLAMA_API_KEY=<key>` (optionally
  `LLM_MODEL`, default `gpt-oss:120b`). Requests go to `https://ollama.com` (the
  `OLLAMA_BASE_URL` default) — there is no local Ollama setup in this project.

**Checklist:** `LLM_PROVIDER`, `LLM_API_KEY` (gemini/groq only), `OLLAMA_API_KEY` (ollama only), `LLM_MODEL` (optional).

### MongoDB Atlas connection string

1. Create a free **M0** cluster at [mongodb.com/atlas](https://www.mongodb.com/atlas).
2. *Database Access* → add a database user (username + password).
3. *Network Access* → allow your IP (or `0.0.0.0/0` for the demo).
4. *Connect → Drivers* → copy the connection string and set:
   `MONGODB_URI=mongodb+srv://<user>:<password>@<cluster>.mongodb.net/lead_system_manager`

### Staff API key (`STAFF_API_KEY`) — how to obtain it

Every staff-facing endpoint is protected by one shared key, sent as the `x-api-key` header:
`POST /simulate/message`, `GET /api/orders` and `GET/PATCH /api/orders/:orderId`, the same for
`/api/tickets`, plus `GET /api/metrics` and `GET /api/audit`. Customer-facing traffic
(`/webhook`) is *not* covered by this key — it is protected by Meta's signature and the verify
token instead.

To obtain (or rotate) the key:

1. Generate one — any strong random string works:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   # or: openssl rand -hex 32
   ```

2. Paste it into `.env`:

   ```
   STAFF_API_KEY=paste-the-value-here
   ```

3. Restart the API, then send the key on every staff request:

   ```bash
   curl http://localhost:3000/api/tickets \
     -H "x-api-key: paste-the-value-here"
   ```

   A missing or wrong key returns `401 UNAUTHORIZED` (constant-time comparison, no hints).

For quick local use a memorable value is fine — the curl examples throughout this README assume
`dev-staff-key-0001`. Whatever you choose, production refuses to boot with the `change-me`
placeholder. The dashboard asks for the key once per browser tab and keeps it in
`sessionStorage` (never a cookie, never a URL).

Rotation is one action by design: generate a new value, update `.env` (and the deployed
environment), restart.

### Secrets policy (what the code enforces)

- `.env` is gitignored; only `.env.example` (placeholders) is committed
- Production mode rejects default `change-me` secrets at boot
- Logs mask phone numbers (`+234801***78`); webhook rejects are audited with reasons, never raw payload secrets
- The README contains no real credentials — rotate anything that ever leaks into a screenshot or log

## Trying the API by hand

The examples below assume the default **simulated** mode and a local `STAFF_API_KEY` of
`dev-staff-key-0001` (see [Obtaining keys and secrets](#obtaining-keys-and-secrets)).

**Health**

```bash
curl http://localhost:3000/health
# 200 {"status":"ok","uptimeSec":9,"checks":{"mongo":"up","llm":"disabled","notifier":"up"},"version":"1.0.0"}
# 503 {"status":"down",...} when MongoDB is unreachable
```

**Webhook handshake (what Meta does once)**

```bash
curl "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=dev-verify-token&hub.challenge=ping123"
# -> ping123 when the token matches, 403 otherwise
```

**Signed webhook POST — without needing Meta**

`scripts/send-webhook.js` signs the sample payload with `WHATSAPP_APP_SECRET`, exactly
like Meta would:

```bash
node scripts/send-webhook.js                        # -> 200 {"status":"received"}
node scripts/send-webhook.js --text "Do you have rice?"
node scripts/send-webhook.js --bad-signature        # -> 401 (audited as WEBHOOK_REJECTED)
node scripts/send-webhook.js --id wamid.DEMO1       # resend the same id: dedupe ignores the duplicate (T-007)
```

**Simulate a customer message (no Meta at all — the normal developer loop)**

```bash
curl -X POST http://localhost:3000/simulate/message ^
  -H "content-type: application/json" ^
  -H "x-api-key: dev-staff-key-0001" ^
  -d "{\"from\":\"+2348012345678\",\"name\":\"Ada\",\"text\":\"How much is 5kg rice?\",\"messageId\":\"sim-1\"}"
```

```json
{
  "correlationId": "…",
  "duplicate": false,
  "intent": "price_check",
  "confidence": 0.95,
  "classifierSource": "rules",
  "replies": ["Rice 5kg costs ₦8,500."],
  "conversation": { "id": "…", "state": "IDLE", "status": "active" },
  "ticketId": null,
  "orderId": null
}
```

`classifierSource` is `rules` / `llm` / `fallback`: the rules decided here, while unusual
phrasing goes to the Ollama Cloud LLM. `orderId` is returned the moment the slot-filling
flow creates the order and `ticketId` the moment an escalation raises one (both
illustrated below). Optional extras:
`"forceLlmFailure": true` (exercise the LLM-fallback path) and omitting `messageId` (one
is generated). The endpoint returns 404 in production by design.

**Example: placing an order over several messages** (`POST /simulate/message`, same `from`)

| Send | Reply (trimmed) | Resulting state |
|---|---|---|
| "I want to order 2 bags of rice" | lists the rice matches, "Which one would you like?" | `COLLECT_ITEM` |
| "Rice 5kg" | "What is the delivery address? …" | `COLLECT_ADDRESS` |
| "12 Example Street, Yaba, Lagos" | summary + "Reply YES to place the order or NO to cancel." | `CONFIRM` |
| "yes" | "Done! Your order ORD-20261007-0001 (₦17,000) is pending confirmation…" | `COMPLETED`, `orderId` returned |

Answers to the machine's question **skip classification** (`classifierSource` stays `null`).
"cancel" aborts the request, "human"/"agent" hands off to a person, and invalid answers are
re-prompted twice before escalating (`VALIDATION_FAILED` audits, workplan failure #3).

**Example: a complaint becomes a ticket (with a staff notification)**

```bash
curl -X POST http://localhost:3000/simulate/message \
  -H "content-type: application/json" -H "x-api-key: dev-staff-key-0001" \
  -d '{"from":"+2348012345678","text":"The rice was stale, I want a refund"}'
# -> "ticketId":"TKT-0001" in the response, the reply quotes the reference,
#    conversation escalates, staff alert lands in logs/whatsapp-outbound.log

curl -H "x-api-key: dev-staff-key-0001" http://localhost:3000/api/tickets
curl -X PATCH http://localhost:3000/api/tickets/TKT-0001 \
  -H "content-type: application/json" -H "x-api-key: dev-staff-key-0001" \
  -d '{"status":"assigned","assignee":"Amaka"}'
# -> firstResponseAt set, TICKET_UPDATED audited
```

Then browse to `http://localhost:3000/dashboard` (prompts for the staff key; tiles,
charts, ticket and audit tables) and `http://localhost:3000/docs` (interactive RapiDoc
reference). `GET /api/metrics` returns the dashboard payload; `GET /api/audit` replays
the journey for any correlation id.

**Where simulated outbound messages go**

- stdout (`whatsapp message (simulated send)` log lines)
- `logs/whatsapp-outbound.log` — one JSON line per message (`at`, `to`, `text`, `providerMessageId`)

## Testing and linting

```bash
npm test        # 123 tests / 31 suites, uses in-memory MongoDB — no services required
npm run lint    # ESLint, zero warnings expected
```

- Runner: Node's built-in `node --test` (files run one at a time for predictable memory use on Windows)
- `mongodb-memory-server` downloads a MongoDB binary on first use (needs network once, then cached)
- Coverage includes: env-gated production behavior (spawned child processes), webhook signature success/failure/audit trails, simulate validation + response shape, health up/down, seed idempotency, adapter simulated/cloud/forced-failure modes
- Classification (rules T1–T5, LLM scenarios against a mocked provider, timeout/outage/invalid-output fallbacks), dedupe (repeat + concurrent deliveries), intent handlers, the slot-filling order flow (T3 happy path, T7 escalation, cancel/human/expiry/stock/address branches), the orders staff API (auth, filters, pagination, transitions), the tickets staff API (transition table, SLA filter, detail with conversation), the staff notifier (retry/backoff, masked audit, failure flag), metrics aggregation + the cursor-paginated audit API, customer/conversation lifecycle, the dashboard/CSP wiring and the OpenAPI document, and the pipeline's full audit chain

To run a single file: `node --test tests/webhook.test.js`

## Project structure

```
src/
  config/        env validation (zod), Mongo connection, logger wiring
  controllers/   health, webhook, simulate, orders, tickets, metrics, audit
  middleware/    correlation id, error handler, signature check, staff auth
  models/        product, customer, conversation, message, order, ticket, audit event
  routes/        /health, /webhook, /simulate, /api/{orders,tickets,metrics,audit}, /dashboard, /docs
  services/      pipeline, classifier (rules + LLM + hybrid), intent handlers, slot filling, domain services, audit recorder, whatsapp adapter
  validators/    webhook + simulate + orders/tickets/metrics/audit query schemas (zod)
  openapi/       hand-authored OpenAPI 3.0 document (served raw at /openapi.json)
  utils/         phone normalisation, http errors, async wrapper
dashboard/      static operations dashboard (no build step, served at /dashboard)
scripts/
  seed.js                  catalogue seeder (npm run seed)
  dev-memory-mongo.js      Docker-free dev MongoDB (npm run dev:mongo)
  send-webhook.js          signed webhook sender for manual testing
tests/                     node:test suites + helpers (in-memory Mongo, child-process scenarios)
tasks/                     sprint board, task specs, acceptance criteria
docs/DECISIONS.md          architecture decisions (WhatsApp-only, simulated default, …)
WORKPLAN.md                the full brief: endpoints, data model, failure tests
```

## API reference

Standard error body for every failure:

```json
{ "error": { "code": "UNAUTHORIZED", "message": "…", "details": [] }, "correlationId": "uuid" }
```

Codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` (401/403), `NOT_FOUND` (404),
`RATE_LIMITED` (429), `INTERNAL_ERROR` (500), `DEPENDENCY_UNAVAILABLE` (503).
Every response carries `x-correlation-id`, which also appears in audit events and logs —
grep one id to trace a message end to end.

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /` | none | Service signpost — name, version and links to `/docs`, `/dashboard`, `/health`, `/openapi.json` |
| `GET /health` | none | Liveness/readiness: `ok` / `degraded` (200) or `down` (503) |
| `GET /webhook` | verify token | Meta handshake, echoes `hub.challenge` |
| `POST /webhook` | `x-hub-signature-256` | Inbound WhatsApp messages; always 200 fast, processing async |
| `POST /simulate/message` | `x-api-key` | Drive the pipeline without Meta (disabled in production) |
| `GET /api/orders` | `x-api-key` | Staff order list — filters `status`, `phone`, `from`, `to`; paginated (`page`, `limit`) |
| `GET /api/orders/:orderId` | `x-api-key` | Single order by reference (any case) |
| `PATCH /api/orders/:orderId` | `x-api-key` | Status transitions only (`confirmed` → `dispatched` → `delivered`; `cancelled` from pending/confirmed), `ORDER_UPDATED` audit |
| `GET /api/tickets` | `x-api-key` | Staff escalation queue — filters `status`, `priority`, `assignee`, `overdue`; paginated |
| `GET /api/tickets/:ticketId` | `x-api-key` | Ticket + customer + last 20 conversation messages (oldest first) |
| `PATCH /api/tickets/:ticketId` | `x-api-key` | Assign/transition/resolve (`TICKET_UPDATED` audit); illegal jumps 400, resolving requires a note |
| `GET /api/metrics` | `x-api-key` | Dashboard aggregations for a `from`/`to` window (default 24 h) + live ticket backlog snapshot |
| `GET /api/audit` | `x-api-key` | Append-only audit trail, newest-first with keyset `cursor` pagination |
| `GET /dashboard` | none | Static operations dashboard (prompts for the staff key; polls the APIs above) |
| `GET /docs` | none | Interactive RapiDoc reference rendering `GET /openapi.json` |

Rate limiting is on by default outside tests (see `src/app.js`). Interactive OpenAPI/RapiDoc
documentation lives at `/docs` (raw document at `/openapi.json`).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid environment variables` at startup | Compare `.env` with `.env.example`; the error lists each offending variable |
| `/health` returns 503 `mongo: down` | MongoDB isn't reachable — start Docker mongo, `npm run dev:mongo`, or fix `MONGODB_URI` |
| `EADDRINUSE` on port 3000 | Something else uses the port — change `PORT` in `.env` |
| Webhook POST returns 401 `Invalid webhook signature` | `WHATSAPP_APP_SECRET` doesn't match the signer; with the script, omit `--secret` to use the one from `.env` |
| Handshake returns 403 | `WHATSAPP_VERIFY_TOKEN` in `.env` and in Meta's webhook config must be identical |
| Make sends fail on purpose | `WHATSAPP_FORCE_SEND_FAILURE=true` (or `--bad-signature` on the script for webhook rejects) |
| Tests download a MongoDB binary | First `npm test` run fetches it once (network required); afterwards it's cached |

## AI tools disclosure

Required by the brief: this project was built with **AI coding assistance** (Qoder — an
agentic IDE assistant) working under human direction against `WORKPLAN.md` and
`docs/DECISIONS.md`. Every generated change was run, linted and exercised locally: 123
automated tests plus manual end-to-end checks (seed → health → handshake → signed
webhook → simulate with rules *and* live Ollama Cloud classification → the full
order flow creating `ORD-20261007-0001` → staff orders API transitions → a complaint
escalating to a ticket with a simulated staff notification → tickets API transition →
metrics → the dashboard rendered in a browser → failure paths #1 (LLM outage) and
#4 (forced send failure) → audit log) documented in the task files under `tasks/`.

## Roadmap

Shipped: T-001–T-016 (sprints 0–3). Sprint 4 is in progress and closes the submission:

| Task | Scope | Status |
|---|---|---|
| T-017 | Full test record (T1–T10 mapped to automated evidence) | Planned |
| T-018 | Security review and hardening against the workplan risk table | Planned |
| T-019 | Documentation: README (done in this pass), SETUP, RUNBOOK, written items | In progress |
| T-020 | Demo script and 5–8 min recorded walkthrough | Planned |
