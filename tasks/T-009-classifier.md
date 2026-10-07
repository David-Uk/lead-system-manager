# T-009: Rules classifier and LLM adapter
Sprint: 2 | Epic: E3 Classification | Points: 3 | Depends on: T-008

## User story
As the business, I want intent classification that always works and never fabricates, so that replies are accurate, most messages never need an AI call, and provider outages degrade gracefully instead of blocking customers.

## Workplan references
- Section 4 (hybrid classifier: rules -> LLM -> fallback) and failure #1 (AI unavailable); test IDs T1-T5, T8.
- `docs/DECISIONS.md`: the LLM step is Ollama Cloud (`https://ollama.com`, `gpt-oss:120b`), key required; there is no local Ollama.

## Acceptance criteria
- [x] Rules decide alone at or above `RULES_CONFIDENCE_THRESHOLD` (0.7): the T1-T5 inputs map to the five intents, including pidgin forms ("na how much be your rice?").
- [x] Below the threshold the LLM is consulted: `POST {OLLAMA_BASE_URL}/api/chat` with bearer `OLLAMA_API_KEY`, `gpt-oss:120b` default, `format: json`, `temperature: 0`, aborted after `LLM_TIMEOUT_MS`.
- [x] An LLM answer is trusted only when it names a real intent and confidence >= `CONFIDENCE_THRESHOLD` (0.6); output is Zod-validated and the prompt treats customer text as untrusted input (injection).
- [x] Provider down / timeout / invalid output / low confidence -> a `failure` is recorded; the rules opinion is used when one exists, otherwise `unknown`; the pipeline audits `CLASSIFIER_FALLBACK` (T8 shape).
- [x] Catalogue aliases confirm product/price/purchase intents (+1 confidence); equally-strong multi-product matches leave `productQuery` null so the handler can list the matches.

## Implementation notes
- `src/services/classifier/rules.js` - deterministic scorer (strong 2 / weak 1 points, base 0.5, +0.175 per point, cap 0.95, explicit tie precedence).
- `src/services/classifier/llm.js` - one `classifyWithLlm(text)` over gemini/groq/ollama adapters; loose JSON parsing; errors carry `code` (`timeout` / `http_error` / `invalid_output`).
- `src/services/classifier/index.js` - the hybrid orchestration. `src/config/env.js` gained `RULES_CONFIDENCE_THRESHOLD` and the Ollama-Cloud key rule. The Ollama Cloud model list and a real JSON chat round trip were verified live before the adapter was written.

## Tests required
- `tests/classifier.test.js` (15): 10 rules tests (T1-T5, pidgin, fallback, outage, weak-signal rescue, ambiguous product) + 5 mocked-provider scenarios run in child processes, asserting the outbound request shape (URL, bearer, model, JSON mode) and every degradation path (low confidence, invalid JSON, HTTP error, timeout).

## Explain-it notes
- Trade-off: the rules threshold is tuned so the five canonical workplan phrases decide deterministically - tests stay fast and free, and the LLM only sees genuinely ambiguous text.
- Trade-off: `temperature: 0` + JSON mode + Zod make provider answers effectively typed; a schema miss degrades to `ai_unavailable` instead of raising.
- What fails first: a revoked Ollama Cloud key - every unsure message then falls back (with `CLASSIFIER_FALLBACK` in the audit) and `/health` reports `llm: down`; rules-only traffic is unaffected.

## Status log
- 2026-10-07: rules engine + LLM adapters + hybrid orchestration implemented; 15 classifier tests green. Live e2e (real Ollama Cloud, `gpt-oss:120b`): an ambiguous complaint phrase classified as `complaint_or_refund` at 0.97, `source: llm`, inside the 5 s timeout. Task done.
