# T-010: Intent handlers (enquiry, price, status)
Sprint: 2 | Epic: E4 Intent Handlers | Points: 3 | Depends on: T-009

## User story
As a customer, I want stock, price and order questions answered instantly from real data - and anything the bot cannot do yet acknowledged politely - so that I am never left in silence.

## Workplan references
- Section 5.1 pipeline step 8 (routing) and section 6 (templates); test IDs T1, T2, T4; the clarify-once flow.

## Acceptance criteria
- [x] product_enquiry / price_check: single best catalogue match -> name, price and stock (out-of-stock called out); several equally-good matches -> short list to choose from; no match -> honest not-found.
- [x] order_status: a quoted reference (`ORD-...`) wins; otherwise the latest order on the sender's number; unknown reference -> honest not-found naming it; no orders at all -> says so.
- [x] place_order and complaint_or_refund answer with holding replies and record `currentIntent` on the conversation (TODO seams for T-011 slot filling and T-013 tickets).
- [x] unknown intent: clarifies once (`clarifyAttempts` 1), a second miss hands off to a human; any clear intent resets the counter to 0.
- [x] Every customer-visible string comes from `src/utils/templates.js`.

## Implementation notes
- `src/services/intentHandlers.js` - the six handlers + registry; each returns `{replies, conversationPatch?, orderId?, ticketId?}` and never mutates the conversation itself.
- `src/services/product.service.js` - free-text matcher; `findProductsByQuery` keeps only top-score products so weaker "5kg" matches cannot pollute a clear answer.
- `src/services/order.service.js` (reference lookup, latest-for-phone) and `src/utils/templates.js` (`formatNGN` -> `₦8,500` style).
- `src/services/pipeline.service.js` - step 8 applies the patch, sends and persists replies; failed sends are excluded from `replies`.

## Tests required
- `tests/intentHandlers.test.js` (14): product found / out-of-stock / multi-list / not-found; price found / not-found; order by reference / latest-by-phone / unknown reference / none; place_order + complaint holding; clarify-once, second-miss hand-off, counter reset.

## Explain-it notes
- Trade-off: handlers read but never write - all state changes flow through `conversationPatch`, so the state machine has one owner and handlers stay testable in isolation.
- Trade-off: top-score matching means "How much is 5kg rice?" answers with Rice 5kg alone, while a genuinely ambiguous "rice or beans" still lists both.
- What fails first: an empty catalogue makes every product question an honest "could not find" - never a wrong price.

## Status log
- 2026-10-07: handlers, templates and catalogue/order services implemented; 14 handler tests green; integration + live e2e show T1/T2/T4 answered from the seeded catalogue ("Rice 5kg costs ₦8,500."). Task done.
