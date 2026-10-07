---
kind: build_system
name: Node.js Build & Containerization via npm scripts, Dockerfile, and docker-compose
category: build_system
scope:
    - '**'
source_files:
    - package.json
    - Dockerfile
    - docker-compose.yml
    - eslint.config.js
    - .env.example
---

## What system/approach is used

The project uses a minimal Node.js build setup with no dedicated build toolchain:
- **Dependency management**: `package.json` + `package-lock.json`, installed via `npm ci` in the container.
- **Runtime entry point**: `src/server.js` (declared as `main` in `package.json`).
- **Containerization**: single-stage `Dockerfile` based on `node:24-alpine`.
- **Local orchestration**: `docker-compose.yml` runs the API alongside a MongoDB 8 service.
- **Testing**: built-in `node --test` runner invoked through an npm script.
- **Linting**: ESLint 9 (`eslint.config.js`) invoked via `npm run lint`.

There is no Makefile, no CI pipeline file (no `.github/` directory), no release automation, and no cross-compilation. The repository is a development/devcontainer-style project rather than a packaged distribution artifact.

## Key files and packages

- `package.json` — declares Node engine `>=20`, ESM mode (`"type": "module"`), all npm scripts, dependencies, and devDependencies.
- `Dockerfile` — production container image definition.
- `docker-compose.yml` — local compose stack (api + mongo).
- `eslint.config.js` — ESLint 9 flat config for linting.
- `.env.example` — environment variable template consumed by the app.
- `.dockerignore` — excludes artifacts from the Docker build context.
- `scripts/seed.js`, `scripts/dev-memory-mongo.js`, `scripts/send-webhook.js` — ad-hoc Node utilities wired into npm scripts.

## Architecture and conventions

### npm scripts
All developer commands are declared under `scripts` in `package.json`:
- `start`: `node src/server.js`
- `dev`: `node --watch src/server.js` (uses Node's built-in file watcher)
- `test`: `node --test --test-concurrency=1` (Node:test runner, serialized execution)
- `seed`: `node scripts/seed.js`
- `dev:mongo`: `node scripts/dev-memory-mongo.js`
- `lint`: `eslint .`

No test framework beyond Node:test; HTTP assertions use `supertest`; MongoDB integration tests spin up an in-process memory server via `mongodb-memory-server` (a devDependency).

### Docker build
The `Dockerfile` follows a standard two-step pattern:
1. `COPY package*.json ./` then `RUN npm ci --omit=dev` to cache production dependency installation.
2. `COPY . .` to bring in source code.
3. `EXPOSE 3000` and `CMD ["node", "src/server.js"]`.
4. A `HEALTHCHECK` probes `http://127.0.0.1:3000/health` every 30s with a 5s timeout, 10s start period, and 3 retries.

Base image is pinned to `node:24-alpine`. Dev dependencies are explicitly omitted at install time.

### docker-compose
Defines two services:
- `api` — builds from the current directory, maps port 3000, mounts the source tree plus a volume-stripped `node_modules`, and injects default environment variables (`NODE_ENV=development`, `PORT=3000`, `MONGODB_URI=mongodb://mongo:27017/lead_system_manager`, `STAFF_API_KEY=test-key`, `WHATSAPP_VERIFY_TOKEN=test-token`, `WHATSAPP_APP_SECRET=test-secret`, `WHATSAPP_MODE=simulated`, `LLM_PROVIDER=none`).
- `mongo` — uses `mongo:8`, exposes 27017, persists data to the named volume `mongo_data`.

The api service depends on mongo and mounts the working directory for live reload during development.

### Versioning and packaging
- Version is declared statically as `"1.0.0"` in `package.json`.
- No publish step, no `prepublishOnly`, no changelog automation, no semantic-release or similar tooling.
- No `Makefile` or shell-based build scripts exist in the repository root.

### Linting
ESLint 9 is configured via the flat config format (`eslint.config.js`). It is invoked manually via `npm run lint`; there is no pre-commit hook or CI gate enforcing it.

## Conventions and constraints

- **Node version**: the `engines.node` field requires `>=20`; the Dockerfile uses `node:24-alpine`, so the runtime is newer than the minimum.
- **Module system**: the project is ESM-only (`"type": "module"`); CommonJS requires explicit `.cjs` extensions.
- **Entrypoint convention**: the application always starts via `node src/server.js` (both `npm start` and the Docker `CMD`).
- **Test isolation**: tests run with `--test-concurrency=1` to serialize Node:test workers, avoiding shared-state races.
- **Production dependency pruning**: the Docker build installs only production dependencies (`npm ci --omit=dev`), so devDependencies are not present in the image.
- **Health probe contract**: the `/health` endpoint must respond successfully on port 3000 for the container healthcheck to pass.
- **Environment configuration**: compose hard-codes defaults for all required env vars; production deployments need to override them (e.g., `MONGODB_URI`, WhatsApp tokens).
- **MongoDB version alignment**: the compose stack pins `mongo:8`, matching the Mongoose 8.x dependency in `package.json`.
- **No CI / no automated release**: there is no GitHub Actions workflow, no Makefile, and no publish/release script — builds and releases are manual.