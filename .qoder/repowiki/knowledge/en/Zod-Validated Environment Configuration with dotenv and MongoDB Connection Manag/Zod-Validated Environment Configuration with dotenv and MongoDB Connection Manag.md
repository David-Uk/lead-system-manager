---
kind: configuration_system
name: Zod-Validated Environment Configuration with dotenv and MongoDB Connection Manager
category: configuration_system
scope:
    - '**'
source_files:
    - src/config/env.js
    - src/config/db.js
    - .env.example
    - package.json
    - scripts/seed.js
    - src/server.js
---

## Approach

The application uses a single, centralized configuration system built on three layers:

1. **`.env` loading** via `dotenv` (loaded from the project root regardless of CWD).
2. **Schema validation & coercion** via `zod`, which defines every supported environment variable, its type, default value, and cross-field constraints.
3. **A frozen, typed config object** (`src/config/env.js`) exported as `env`, consumed everywhere instead of reading `process.env` directly.

MongoDB connection management is co-located in `src/config/db.js`, which reads `env.MONGODB_URI` and provides `connectDb({ retry })` / `disconnectDb()` helpers used by both the server and seed script.

## Key Files

- `src/config/env.js` — schema definition, `.env` loading, validation, frozen export.
- `src/config/db.js` — Mongoose connection lifecycle with exponential-backoff retry.
- `.env.example` — canonical list of all supported variables with comments.
- `package.json` — declares `dotenv` and `zod` as dependencies; `type: "module"` so imports are ESM.
- `scripts/seed.js` — CLI entry that calls `connectDb({ retry: false })` to fail fast on bad DB config.
- `src/server.js` — main entry that calls `connectDb()` then starts Express.

## Architecture and Conventions

### Loading order
`dotenv.config({ path: .../.env })` runs at import time of `src/config/env.js`. The comment documents that existing `process.env` values always win, which allows `docker-compose.yml` to override `MONGODB_URI` inside the API container.

### Schema design
All variables are declared in one `z.object` schema under `src/config/env.js`:

- **Runtime**: `NODE_ENV` (enum), `PORT` (coerced int 1–65535), `LOG_LEVEL` (pino enum).
- **Database**: `MONGODB_URI`.
- **Auth**: `STAFF_API_KEY`.
- **WhatsApp Cloud API**: `WHATSAPP_MODE` (enum `simulated` | `cloud`), `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_API_VERSION` (regex `/^v\d+\.\d+$/`), `WHATSAPP_FORCE_SEND_FAILURE`, `STAFF_WHATSAPP_NUMBER`.
- **LLM classification** (optional): `LLM_PROVIDER` (enum `none` | `gemini` | `groq` | `ollama`), `LLM_API_KEY`, `LLM_MODEL`, `LLM_TIMEOUT_MS`, `CONFIDENCE_THRESHOLD`, `OLLAMA_BASE_URL`, `OLLAMA_API_KEY`.
- **Tickets**: `TICKET_SLA_MINUTES`.

Booleans are parsed through a custom `booleanFromEnv` helper because `z.coerce.boolean()` treats `Boolean("false") === true`; the helper normalizes to lowercase and only accepts literal `true`/`false` strings.

### Cross-field validation (`superRefine`)
- In `NODE_ENV=production`: rejects default placeholder values for `STAFF_API_KEY`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
- When `WHATSAPP_MODE=cloud`: requires `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN`.
- When `LLM_PROVIDER` is `gemini` or `groq`: requires `LLM_API_KEY`.

On any validation failure the module logs each issue to stderr and calls `process.exit(1)` before the logger is available.

### Consumption pattern
Every module that needs configuration imports `{ env }` from `./config/env.js` (or a relative path). Consumers include:
- `src/app.js`, `src/server.js`
- `src/controllers/{health,webhook}.controller.js`
- `src/middleware/{auth,errorHandler,signature}.js`
- `src/routes/simulate.routes.js`
- `src/services/whatsapp.adapter.js`
- `src/utils/logger.js`
- `scripts/send-webhook.js`

The exported `env` is wrapped in `Object.freeze(parsed.data)`, making it immutable at runtime.

### MongoDB connection manager
`src/config/db.js` exposes:
- `getDbState()` — returns `'up'` when `mongoose.connection.readyState === 1`.
- `connectDb({ retry = true })` — connects using `env.MONGODB_URI` with `serverSelectionTimeoutMS: 5000`. On failure with `retry=true`, logs a warning and starts an exponential-backoff background retry loop (base 1s, max 30s); on failure with `retry=false` (used by `scripts/seed.js`), throws immediately.
- `disconnectDb()` — stops retries and closes the connection; used in graceful shutdown.

Retry timers are `unref()`ed so they do not keep test processes alive.

### Docker / deployment convention
`.env.example` documents that `MONGODB_URI` defaults to local Mongo and is overridden by `docker-compose.yml` for the `api` service. Production secrets (`STAFF_API_KEY`, `WHATSAPP_*` tokens) are expected to be injected via environment variables rather than committed files.

## Conventions and Constraints

- **Rule**: All environment variables are defined centrally in `src/config/env.js`; no other file may read `process.env` directly. This is enforced by the fact that `env` is the sole exported configuration object and every consumer imports it from there.
- **Rule**: `.env` must live at the repository root; the loader resolves it relative to `import.meta.url` going up two levels from `src/config/env.js`.
- **Rule**: Boolean-valued env vars must be the literal strings `true` or `false`; other values fail Zod validation.
- **Rule**: `WHATSAPP_API_VERSION` must match the regex `/^v\d+\.\d+$/` (e.g. `v19.0`).
- **Rule**: In `NODE_ENV=production`, `STAFF_API_KEY`, `WHATSAPP_APP_SECRET`, and `WHATSAPP_VERIFY_TOKEN` cannot retain their `change-me` defaults — startup exits with code 1.
- **Rule**: When `WHATSAPP_MODE=cloud`, `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` are required.
- **Rule**: When `LLM_PROVIDER` is `gemini` or `groq`, `LLM_API_KEY` is required.
- **Rule**: The seed script (`scripts/seed.js`) calls `connectDb({ retry: false })`, so a missing/unreachable MongoDB causes immediate failure rather than background retry.
- **Convention**: Optional features (LLM providers, WhatsApp cloud mode) are gated by env flags and fall back to safe defaults (`LLM_PROVIDER=none`, `WHATSAPP_MODE=simulated`) so the system remains functional without external credentials.
- **Convention**: `NODE_ENV` is restricted to `development` | `test` | `production` and controls production-only validation checks.