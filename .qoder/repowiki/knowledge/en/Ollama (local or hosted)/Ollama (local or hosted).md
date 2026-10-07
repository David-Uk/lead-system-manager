---
kind: external_dependency
name: Ollama (local or hosted)
slug: ollama
category: external_dependency
category_hints:
    - vendor_identity
    - client_constraint
scope:
    - '**'
source_files:
    - .env.example
    - README.md
---

### Ollama
- Optional local LLM backend selected via `LLM_PROVIDER=ollama`. By default it points at a local instance on `OLLAMA_BASE_URL=http://localhost:11434`; no API key is required for that setup.
- `OLLAMA_API_KEY` is accepted for hosted/proxied Ollama deployments but is a placeholder in local setups.
- The project was asked to use "Ollama cloud" for AI tasks, but the current codebase only exposes the local/base-url integration — there is no dedicated cloud client wired in yet.