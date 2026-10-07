---
kind: dependency_management
name: npm-based Dependency Management with Lockfile and Engine Pinning
category: dependency_management
scope:
    - '**'
source_files:
    - package.json
    - package-lock.json
    - Dockerfile
    - .dockerignore
---

## System / Approach

This is a Node.js project managed exclusively through **npm** (no Yarn, pnpm, or other package managers). Dependencies are declared in `package.json` and resolved against the public npm registry (`https://registry.npmjs.org`). A `package-lock.json` lockfile is committed to the repository, pinning every transitive dependency to an exact version and integrity hash.

There is no vendored third-party code under source control — the `node_modules/` directory exists at the repo root but is not part of the build artifact strategy. The Docker image installs dependencies via `npm install` during build time.

## Key Files

- `package.json` — declares runtime `dependencies`, `devDependencies`, `engines.node >=20`, and npm scripts (`start`, `dev`, `test`, `seed`, `dev:mongo`, `lint`).
- `package-lock.json` — lockfile v3 (`lockfileVersion: 3`) that pins exact versions and SHA integrity for every installed package; it is the authoritative source for reproducible installs.
- `Dockerfile` — pulls Node 20 images and runs `npm ci` / `npm install` to install from the lockfile.
- `.dockerignore` — excludes `node_modules` from container builds so they are reinstalled inside the image rather than copied from the host.
- `eslint.config.js` — dev-only linting tooling (ESLint 9) declared as a devDependency.

## Architecture and Conventions

- **Runtime vs. dev split**: All production libraries live under `dependencies`; test/lint/formatting tools (`eslint`, `mongodb-memory-server`, `prettier`, `supertest`) live under `devDependencies`. This keeps production images lean.
- **Version ranges use caret (`^`)**: Every entry in both `dependencies` and `devDependencies` uses a caret range (e.g. `express ^4.19.2`, `mongoose ^8.3.2`, `zod ^3.23.4`), allowing minor/patch upgrades within the same major version while still being pinned by the lockfile.
- **Node engine gate**: `"engines": { "node": ">=20" }` enforces a minimum Node.js version. The Dockerfile targets a Node 20 base image, aligning CI/runtime with this constraint.
- **No private registry or scoped auth**: All packages resolve from the default public npm registry; there is no `.npmrc`, `NPM_TOKEN`, or `--registry` override visible in the repo.
- **No vendoring**: Third-party JS is never checked into source control; `node_modules/` is excluded from the image via `.dockerignore` and rebuilt on each deployment.
- **Lockfile-driven installs**: The presence of `package-lock.json` means deterministic installs are expected; `npm ci` (used in Docker) consumes the lockfile rather than updating it.

## Conventions and Constraints

- **Constraint enforced by npm**: The `engines.node >=20` field causes `npm install` to warn/fail when run under an unsupported Node version, preventing accidental installs on older runtimes.
- **Deterministic builds enforced by lockfile**: `package-lock.json` is committed; using `npm ci` in Docker ensures the installed tree matches the lockfile exactly, not just the caret-ranged manifests.
- **Dev/prod separation convention**: Linters, formatters, test runners, and mock servers are placed in `devDependencies` only, following standard npm conventions — no evidence of them leaking into production bundles.
- **No private registry configuration found**: There is no `.npmrc`, `NPM_CONFIG_REGISTRY`, or `NPM_TOKEN` in the repository, indicating all dependencies come from the public npm registry.