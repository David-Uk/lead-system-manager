---
kind: external_dependency
name: MongoDB (via Mongoose 8)
slug: mongodb
category: external_dependency
category_hints:
    - client_constraint
scope:
    - '**'
source_files:
    - src/config/db.js
    - scripts/seed.js
    - .env.example
---

### MongoDB
- The app connects to MongoDB through Mongoose 8; the connection string is read from `MONGODB_URI`.
- Three deployment options are supported: Docker Compose (`docker compose up -d mongo`, data in `mongo_data` volume), an in-memory dev instance via `npm run dev:mongo` (uses `mongodb-memory-server`), or a hosted Atlas cluster with a `mongodb+srv://` URI.
- In docker-compose the API service overrides `MONGODB_URI` to point at the `mongo` service hostname (`mongodb://mongo:27017/lead_system_manager`); existing environment variables always win over `.env` because dotenv does not override them.
- All collections are created by Mongoose models under `src/models/`; the seed script (`scripts/seed.js`) upserts a synthetic 30-product catalogue and is idempotent.