# T-001: Repository setup and env
Sprint: 0 | Epic: E1 Foundation | Points: 1 | Depends on: 

## User story
As the delivery engineer, I want a reproducible project skeleton with pinned scripts and container config so that every later task starts from a baseline that boots the same way on every machine.

## Workplan references
- Section 5 (tech stack and scripts), section 12 (environment variables), repo layout in section 13.
- `docs/DECISIONS.md` (WhatsApp-only channel, simulated mode default).

## Acceptance criteria
- [x] Given a fresh clone, when `npm install` completes, then dependencies install with no vulnerabilities and `npm run lint` passes clean.
- [x] Given `.env.example`, when copied to `.env`, then the app starts with no edits (simulated WhatsApp mode, rules-only classifier).
- [x] When `docker compose config` runs, then the compose file validates; `docker compose up` maps api:3000 and mongo:27017 with `MONGODB_URI` pointed at the `mongo` service inside the container.
- [x] When the API image builds, then it runs on `node:24-alpine` with a healthcheck hitting `/health`.

## Implementation notes
- `package.json` — ESM (`"type": "module"`), engines `>=20`, scripts: start / dev / test / seed / dev:mongo / lint.
- `Dockerfile` + `.dockerignore` — production image (`npm ci --omit=dev`), non-root run, healthcheck.
- `docker-compose.yml` — `api` (build from Dockerfile, volume-mounted for dev) + `mongo:8` with a named volume; compose env overrides `.env` because dotenv never overwrites existing variables.
- `.env.example` — every variable from `src/config/env.js` with comments; `.env` stays gitignored.
- `eslint.config.js` — flat config, node globals; `logs/**` and `node_modules/**` ignored.
- `.gitignore` — `.env`, `logs/`, `coverage/`, generated folders.

## Tests required
Scaffolding only — verified by `npm run lint`, `docker compose config -q`, and the full end-to-end run documented in README (seed → health → webhook → simulate).

## Explain-it notes
- Trade-off: the test runner is Node's built-in `node --test` instead of vitest. Vitest 1–5 cannot run on Node 25 (runner state never initialises), and the built-in runner needs zero extra tooling — see the Testing section of README.
- Trade-off: one `.env` for host runs plus compose env overrides for the container, instead of two files. dotenv's "never override existing vars" rule makes this safe.
- What fails first: Mongo connectivity — handled explicitly with connection retries (`src/config/db.js`) and a 503 from `/health`.

## Status log
- 2026-10-07: Setup repo, created .env.example, docker-compose.yml, package.json, eslint config, and directories. Installed dependencies.
- 2026-10-07: Added Dockerfile/.dockerignore, normalized .env (MONGODB_URI, STAFF_API_KEY, WHATSAPP_* placeholders), switched test runner to node:test, `docker compose config` validates clean. Task done.
