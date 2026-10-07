# T-006: Customer and conversation models
Sprint: 1 | Epic: E2 Webhook and Pipeline | Points: 2 | Depends on: T-005

## User story
As the automated assistant, I want every phone number to map to one customer and every thread to be a resumable conversation, so that repeated messages continue the same discussion and later tasks (slot filling, tickets) have context to work with.

## Workplan references
- Section 3 data model (`customers`, `conversations`) and section 5.1 pipeline step 5 (customer upsert, conversation resume/create).
- `docs/DECISIONS.md`: all messaging through the WhatsApp adapter; one active conversation per customer in v1.

## Acceptance criteria
- [x] Given a new phone number, when the first message arrives, then exactly one customer is created with consent timestamps; repeat messages refresh `lastSeenAt` without duplicating the row or blanking a stored name.
- [x] Given an active conversation in a non-terminal state, when a new message arrives, then the same conversation id is reused; a terminal one (COMPLETED / CANCELLED / ESCALATED / EXPIRED) rolls over to a fresh IDLE conversation.
- [x] Conversation updates go through one `updateConversation` helper (`currentIntent`, `lastMessageAt`, `clarifyAttempts`); handlers never mutate documents directly - the pipeline applies patches.
- [x] Two first-messages racing on the same number are handled: the E11000 duplicate-key retry falls back to a plain update.

## Implementation notes
- `src/services/customer.service.js` - `upsertCustomer` (`$set` lastSeenAt; `$setOnInsert` consent) and `findCustomerByPhone`.
- `src/services/conversation.service.js` - `getOrCreateActiveConversation`, `findConversationById`, `updateConversation`; terminal-state list.
- `src/services/pipeline.service.js` - step 5 wiring (upsert -> resume -> persist -> audit); step 8 applies the returned `conversationPatch`.

## Tests required
- `tests/conversation.test.js` (6): customer upsert x3 (created once, repeat refresh, unusable phone -> null) and conversation resume / terminal rollover / patch.

## Explain-it notes
- Trade-off: exactly one active conversation per customer keeps the v1 state machine simple; parallel threads (e.g. delivery + refund) are a v2 concern.
- Trade-off: `$setOnInsert` for consent means replayed traffic cannot rewrite the original opt-in timestamps.
- What fails first: without a usable Nigerian number there is no customer row at all - the pipeline answers politely and skips persistence rather than inventing an identity.

## Status log
- 2026-10-07: customer + conversation services implemented and wired into pipeline step 5. `tests/conversation.test.js` green; live e2e shows both messages of a session resolving to the same conversation id. Task done.
