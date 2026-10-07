# Sprint 2

**Goal:** All five intents work end to end and failure #3 is handled
**Time-box:** 2.5h

## Committed Tasks
- [x] T-009
- [x] T-010
- [x] T-011
- [x] T-012

## Definition of Done
- All tasks are Done.
- Tests pass.
- API is documented in RapiDoc.
- Audit logs match changes.

## Demo Checklist
- [x] End to end test of sprint goals manually

## Review
- Delivered: T-009 (hybrid classifier: rules -> Ollama Cloud LLM -> safe fallback, with the T1-T5 rules tests and mocked-provider degradation tests), T-010 (product/price/order-status handlers plus the clarify-once flow), T-011 (slot-filling state machine: COLLECT_ITEM -> COLLECT_QTY -> COLLECT_ADDRESS -> CONFIRM -> order, with CANCEL/HUMAN escapes, two-re-prompt escalation for failure #3, and the 30-minute lazy expiry) and T-012 (order creation with ORD-YYYYMMDD-#### references, ORDER_CREATED audit, plus GET/GET-one/PATCH /api/orders with the enforced transition table and ORDER_UPDATED audit).
- Velocity: 4 of 4 committed tasks; sprint goal met. All five intents work end to end - place_order now finishes with a real Order (status pending_confirmation) and the T3 flow was replayed live against the real .env. Escalation branches for purchase/complaint still answer with holding replies pending T-013/T-014.
- Note: RapiDoc (Definition of Done) remains T-016 scope.

## Retrospective
- Went well: probing Ollama Cloud live (models list + one JSON chat) before writing the adapter paid off - request shape, default model (`gpt-oss:120b`) and JSON-string content matched reality on the first attempt, and a live e2e classification came back at 0.97 within the timeout.
- Went well: the state machine reuses the classifier entities (productQuery/quantity), so "I want to order 2 bags of rice" skips the questions it already has answers for - the T3 walkthrough needs only item choice, address and YES.
- Needs improvement: matcher breadth - with the full 30-product catalogue, "5kg rice" initially answered a list including Beans 5kg and Garri 5kg. Fixed by keeping only top-score matches in the handler-facing query and covered by tests.
- Needs improvement: stock is checked at collection and confirmation but not decremented on creation (staff confirm physical inventory via PATCH); revisit when payment/stock sync lands.
