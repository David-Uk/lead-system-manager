# T-011: Slot-filling state machine (place_order)
Sprint: 2 | Epic: E4 Intent Handlers | Points: 5 | Depends on: T-010

## User story
As a customer, I want to order by chatting naturally - the bot asks only for what is missing and confirms before placing the order - so that buying on WhatsApp takes seconds without a form.

## Workplan references
- Section 5.2 (order slot-filling state machine); pipeline step 6 (resume) and failure #3 (missing/invalid order data); tests T3 and T7.

## Acceptance criteria
- [x] Given "I want to order 2 bags of rice", when the item is ambiguous, then the bot lists the equal matches and asks which one; a unique match skips straight to the next missing question.
- [x] Given an order intent with item + quantity already extracted, when the machine starts, then it asks only for the delivery address (ENTITY reuse - no repeated question).
- [x] Given a collecting conversation, when the next message arrives, then classification is skipped (`classifierSource` stays null) and the text is treated as the answer to the last question.
- [x] Given quantity `abc` three times, when each arrives, then the bot re-prompts twice (`retries` 1, 2), then escalates on the third with status `escalated` - audit `VALIDATION_FAILED` for each attempt (failure #3, test T7).
- [x] Given quantity above stock, when it is entered, then the bot re-prompts naming the available count; a product with zero stock cannot be selected.
- [x] Given a delivery address under 10 chars or without a Lagos area / street+number marker, when it is entered, then it is rejected with guidance.
- [x] Given CONFIRM + "yes", when accepted, then an Order is created (status `pending_confirmation`), the conversation is `COMPLETED`/`completed`, and the reply quotes the ORD reference.
- [x] Given any collecting state, when the customer sends CANCEL or asks for a human/agent, then the request is cancelled (`CANCELLED`/`completed`) or escalated (`ESCALATED`/`escalated`).
- [x] Given a conversation idle for 30+ minutes, when the next message arrives, then the old conversation is `EXPIRED`/`expired` and the message starts cleanly on a fresh conversation.

## Implementation notes
- `src/services/slotFilling.service.js` (new) - the machine: `handlePlaceOrderFlow`, `isCollectingState`, `isStale`; validators for quantity (integer 1-50, stock) and Lagos addresses (min length + area keyword list, or number+street word).
- `src/services/intentHandlers.js` - `handlePlaceOrder` delegates to the machine (serves both fresh orders and slot answers).
- `src/services/pipeline.service.js` - new step [6a] lazy expiry rollover and step [6] resume path (skip `classify`, annotate intent only); audits `VALIDATION_FAILED` and `ORDER_CREATED` from the handler outcome.
- `src/services/order.service.js` - `createOrder` (ORD-YYYYMMDD-#### with unique-index retry, item snapshots, computed total).
- `src/utils/templates.js` - 15 slot-filling strings (item/qty/address/confirm prompts, invalid-input guidance, placed/cancelled/hand-off); the old `orderAssistPending` holding is gone.
- COLLECT_PHONE stays unreachable in v1 by design: a conversation only exists for a usable Nigerian number, which doubles as the contact phone.

## Tests required
- `tests/slotFilling.test.js` (8): T3 happy path (start -> item choice -> address -> CONFIRM -> order + ORDER_CREATED audit + stored annotation skip), T7 escalation (3x VALIDATION_FAILED), quantity-above-stock, address validation (reject + street pass), CANCEL, HUMAN hand-off, out-of-stock selection, 30-minute lazy expiry.
- Updated `tests/simulate.test.js` and `tests/intentHandlers.test.js` for the new slot-filling replies/states.

## Explain-it notes
- Trade-off: while a conversation is collecting, every message is treated as a slot answer (workplan step 6) - questions on other topics are re-prompted and eventually escalated; only CANCEL/HUMAN escape mid-flow.
- Trade-off: quantity must be digits (1-50) - "two bags" in a slot answer is re-prompted, in exchange for zero parsing ambiguity.
- Trade-off: stock is checked but not decremented at creation; the order waits in `pending_confirmation` for staff, and overselling is prevented at staff confirmation time.
- What fails first: a catalogue gap - if the requested product is not in the active catalogue, the bot honestly says so and stays in COLLECT_ITEM rather than inventing one.

## Status log
- 2026-10-07: machine, templates, pipeline wiring, order creation and 8 integration tests landed; full suite 84/84 green; live e2e against the real .env walked COLLECT_ITEM -> COLLECT_ADDRESS -> CONFIRM -> COMPLETED and created `ORD-20261007-0001` (2 x Rice 5kg, ₦17,000, Yaba address). Task done.
