# T-002: Mongo connection and seed script
Sprint: 0 | Epic: E1 Foundation | Points: 2 | Depends on: T-001

## User story
As a developer, I want validated configuration, a resilient MongoDB connection and a repeatable product seed so that every environment (host, container, CI) behaves identically and demos always have catalogue data.

## Workplan references
- Section 7 (products collection), section 12 (environment variables), section 5 scripts (`npm run seed`).
- Product example `RICE-5KG = 8500` from the workplan sample data.

## Acceptance criteria
- [x] Given a bad or missing env value, when the app starts, then it exits with a readable list of offending variables (zod validation in `src/config/env.js`).
- [x] Given `NODE_ENV=production`, when secrets are still `change-me`, then startup is refused; `WHATSAPP_MODE=cloud` demands phone id + token; gemini/groq demand `LLM_API_KEY`.
- [x] When `npm run seed` runs twice, then the first run inserts 30 products and the second inserts 0 / updates 30 (idempotent upsert by SKU); `--reset` clears the collection first.
- [x] When Mongo is briefly unreachable, then the connection retries with backoff before giving up (dev), and connection state is exposed for health.

## Implementation notes
- `src/config/env.js` — zod schema + cross-field `superRefine`; boolean parsing without `z.coerce.boolean` pitfalls; frozen `env` export used everywhere.
- `src/utils/logger.js` — pino with phone/token redaction, child loggers.
- `src/config/db.js` — `connectDb({retry})`, exponential backoff with an unref'd timer, `disconnectDb`, `getDbState`.
- `src/models/product.model.js` — SKU unique index, aliases array, text index for search.
- `scripts/data/products.js` — 30 synthetic Lagos Fresh Mart products (rice, beans, oil, garri, …).
- `scripts/seed.js` — exports `seedProducts({reset, log})` for tests; CLI flags `--reset`.

## Tests required
- `tests/seed.test.js` — "upserts the 30-product catalogue and is idempotent", "reset clears stray products first" (both against in-memory MongoDB).
- Env validation is exercised indirectly by every suite (test values are injected before `src/` loads).

## Explain-it notes
- Trade-off: upsert-by-SKU instead of insert-many — seeding is safe to re-run and product edits in the data file flow through on the next seed.
- Trade-off: `MONGODB_URI` uses `localhost` for host development; docker-compose overrides it to `mongodb://mongo:27017/...` for the container. One variable name, two environments, no code branches.
- What fails first: an unreachable database — surfaced immediately by the seed script message and by `/health` returning 503.

## Status log
- 2026-10-07: Implemented env validation, logger, DB connection with retry, product model, 30-product data set and idempotent seed; verified with in-memory MongoDB (`npm run seed` → 30 inserted, re-run → 0 inserted / 30 updated). Task done.
