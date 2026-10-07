---
kind: external_dependency
name: Groq (LLM provider)
slug: groq
category: external_dependency
category_hints:
    - vendor_identity
scope:
    - '**'
source_files:
    - .env.example
    - README.md
---

### Groq
- Alternative optional LLM classification backend selected via `LLM_PROVIDER=groq`. Requires `LLM_API_KEY` from [console.groq.com](https://console.groq.com) and a model name such as `llama-3.3-70b-versatile` set in `LLM_MODEL`.
- Shares the same fallback semantics as Gemini: low-confidence results escalate, timed-out calls fall back to rules-only classification.