---
kind: external_dependency
name: Google Gemini (LLM provider)
slug: google-gemini
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - .env.example
    - README.md
---

### Google Gemini
- Optional LLM classification backend selected via `LLM_PROVIDER=gemini`. Requires `LLM_API_KEY` obtained from [aistudio.google.com](https://aistudio.google.com) and a model name such as `gemini-2.0-flash` set in `LLM_MODEL`.
- When enabled the classifier calls Gemini first; if confidence falls below `CONFIDENCE_THRESHOLD` (default 0.6) the result is treated as unsure and escalates to a ticket. If the call times out (default `LLM_TIMEOUT_MS=5000`) the pipeline falls back to rules-only classification.
- `LLM_PROVIDER=none` (the default) makes the whole system fully functional without any LLM key.