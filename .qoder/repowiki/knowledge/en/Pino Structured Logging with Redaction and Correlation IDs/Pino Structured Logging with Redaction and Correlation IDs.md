---
kind: logging_system
name: Pino Structured Logging with Redaction and Correlation IDs
category: logging_system
scope:
    - '**'
source_files:
    - src/utils/logger.js
    - src/config/env.js
    - src/middleware/correlationId.js
    - src/app.js
    - src/config/db.js
    - src/controllers/webhook.controller.js
---

## What system/approach is used

The application uses **pino** as its structured JSON logging framework, configured once in `src/utils/logger.js` and re-exported as a singleton. HTTP request/response logging is handled by **pino-http**, which integrates with the pino logger to emit per-request log lines.

## Key files and packages

- `src/utils/logger.js` — pino instance creation, shared `logger`, and `childLogger()` factory.
- `src/config/env.js` — Zod schema that validates `LOG_LEVEL` (enum: fatal/error/warn/info/debug/trace/silent; default `info`) and `NODE_ENV`.
- `src/middleware/correlationId.js` — attaches a UUID to `req.id` so pino-http can include it in every request log line.
- `src/app.js` — wires `pinoHttp` into Express and imports the shared logger.
- `src/config/db.js` — logs MongoDB connection lifecycle events via `logger.info`/`warn`/`debug`.
- `src/controllers/webhook.controller.js` — logs webhook handshake results and inbound message flow.
- `scripts/dev-memory-mongo.js`, `scripts/seed.js` — use the shared logger for dev/seed output.

## Architecture and conventions

1. **Single source of truth**: All application code imports `logger` from `src/utils/logger.js`; there are no ad-hoc console.log calls in production modules. The only exceptions are `scripts/send-webhook.js`, which uses `console.log` for manual CLI diagnostics.
2. **Structured fields**: Log entries carry a `base` object with `service: 'lead-system-manager'` and `env: env.NODE_ENV`. Additional context is attached either through pino-http's automatic request binding or via `logger.child({ correlationId })` / passing an object as the first argument to `logger.<level>(obj, msg)`.
3. **Secret redaction**: Pino's `redact.paths` configuration strips three header values before they reach the log stream:
   - `req.headers["x-api-key"]`
   - `req.headers.authorization`
   - `req.headers["x-hub-signature-256"]`
   They are replaced with `[REDACTED]`. This is enforced at the logger construction site.
4. **Correlation IDs**: `correlationId` middleware generates a `randomUUID()` and stores it on `req.id`. The comment in `correlationId.js` states that pino-http picks this up for log lines, and the id is also passed down to services and audit events and returned in the `x-correlation-id` response header.
5. **Log levels**: The level is driven entirely by the `LOG_LEVEL` environment variable, validated by Zod against pino's full level enum. Default is `info`. The `db.js` module demonstrates usage across `debug`, `info`, and `warn`.
6. **Child loggers**: A `childLogger(bindings)` helper wraps `logger.child(bindings)` so callers can create scoped loggers (e.g., bound to a correlation id) without directly invoking pino's child API.
7. **Early startup logging**: `config/env.js` explicitly notes that the logger is not available when parsing `.env`, so validation failures fall back to `console.error` + `process.exit(1)` — a deliberate exception to the rule.

## Conventions and constraints

- **Convention**: Production and script code should import `logger` from `src/utils/logger.js` rather than instantiate pino locally or call `console.log` for operational output.
- **Convention**: Sensitive request headers (`x-api-key`, `authorization`, `x-hub-signature-256`) must never be logged; redaction is enforced by the pino `redact` configuration in `src/utils/logger.js`.
- **Convention**: Every incoming request gets a correlation id stored on `req.id` by the `correlationId` middleware, which pino-http then includes in the log line.
- **Constraint**: `LOG_LEVEL` is validated by Zod against the exact set `['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']` with a default of `'info'` (see `src/config/env.js`).
- **Constraint**: `NODE_ENV` is constrained to `['development', 'test', 'production']` and is included in every log entry's base object.