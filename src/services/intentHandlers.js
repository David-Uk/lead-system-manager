import * as templates from '../utils/templates.js';
import { findProductsByQuery, loadActiveProducts } from './product.service.js';
import { findLatestOrderForPhone, findOrderByOrderId } from './order.service.js';
import { handlePlaceOrderFlow } from './slotFilling.service.js';
import { createTicket } from './ticket.service.js';

/**
 * Intent handlers - pipeline step 8 (workplan 5.1).
 *
 * Each handler receives `{ text, entities, customer, conversation }` and
 * returns `{ replies: string[], conversationPatch?, orderId?, ticketId?,
 * order?, ticket?, validationFailure? }`. Handlers may read and write the
 * database (catalogue, orders, tickets) but never mutate the conversation
 * directly - the pipeline applies `conversationPatch` so the state machine
 * stays in one place.
 *
 * place_order delegates to the slot-filling state machine (T-011).
 * Escalation branches (complaint_or_refund, unknown second miss) create a
 * Ticket here so the reply can quote its reference; the pipeline audits
 * TICKET_CREATED and triggers the staff notification (T-013/T-014).
 */

const MAX_MATCHES_IN_REPLY = 3;

async function handleProductEnquiry({ text, entities }) {
    const query = entities.productQuery ?? text;
    const matches = await findProductsByQuery(query, { limit: MAX_MATCHES_IN_REPLY });

    if (matches.length === 0) {
        return { replies: [templates.productNotFoundReply(query)] };
    }
    if (matches.length === 1) {
        return { replies: [templates.productFoundReply(matches[0])] };
    }
    return { replies: [templates.productMatchesReply(matches, query)] };
}

async function handlePriceCheck({ text, entities }) {
    const query = entities.productQuery ?? text;
    const matches = await findProductsByQuery(query, { limit: MAX_MATCHES_IN_REPLY });

    if (matches.length === 0) {
        return { replies: [templates.priceNotFoundReply(query)] };
    }
    if (matches.length === 1) {
        return { replies: [templates.priceFoundReply(matches[0])] };
    }
    return { replies: [templates.priceMatchesReply(matches, query)] };
}

/**
 * Generic "what do you sell?" questions: answer with a grouped catalogue
 * overview instead of treating the whole sentence as a product name.
 */
async function handleCatalogListing() {
    const products = await loadActiveProducts();

    if (products.length === 0) {
        return { replies: [templates.catalogEmptyReply()] };
    }
    return { replies: [templates.catalogListingReply(products)] };
}

async function handleOrderStatus({ entities, customer }) {
    // Reference first; phone lookup only when the customer did not quote one.
    let order = entities.orderId ? await findOrderByOrderId(entities.orderId) : null;

    if (!order && !entities.orderId) {
        order = await findLatestOrderForPhone(customer?.phone);
    }

    if (order) {
        return { replies: [templates.orderStatusReply(order)], orderId: order.orderId };
    }
    if (entities.orderId) {
        return { replies: [templates.orderNotFoundReply(entities.orderId)] };
    }
    return { replies: [templates.noOrdersFoundReply()] };
}

async function handlePlaceOrder({ text, entities, customer, conversation }) {
    return handlePlaceOrderFlow({ text, entities, customer, conversation });
}

async function handleComplaintOrRefund({ text, customer, conversation }) {
    // Always escalate (workplan 1): refunds and disputes are never automated.
    const ticket = await createTicket({
        conversationId: conversation?._id ?? null,
        customerId: customer?._id ?? null,
        reason: /\brefund\b/i.test(text) ? 'refund' : 'complaint',
        summary: text,
    });

    return {
        replies: [templates.complaintTicketReply(ticket)],
        conversationPatch: { state: 'ESCALATED', status: 'escalated' },
        ticket,
    };
}

/**
 * `unknown` clarifies once (workplan 5.1). The second miss escalates with a
 * ticket (T-013): the reason reflects why the classifier was unsure
 * (`ai_unavailable` | `low_confidence`, workplan failure 1) or falls back
 * to `unknown_intent`.
 */
async function handleUnknown({ text, customer, conversation, classificationFailure = null }) {
    const attempts = conversation?.clarifyAttempts ?? 0;

    if (attempts === 0) {
        return {
            replies: [templates.clarifyUnknown()],
            conversationPatch: { clarifyAttempts: 1 },
        };
    }

    const ticket = await createTicket({
        conversationId: conversation?._id ?? null,
        customerId: customer?._id ?? null,
        reason: classificationFailure ?? 'unknown_intent',
        summary: text,
    });

    return {
        replies: [templates.unknownTicketReply(ticket)],
        conversationPatch: { state: 'ESCALATED', status: 'escalated', clarifyAttempts: attempts + 1 },
        ticket,
    };
}

const INTENT_HANDLERS = {
    product_enquiry: handleProductEnquiry,
    price_check: handlePriceCheck,
    catalog_listing: handleCatalogListing,
    place_order: handlePlaceOrder,
    order_status: handleOrderStatus,
    complaint_or_refund: handleComplaintOrRefund,
    unknown: handleUnknown,
};

/**
 * Routes a classified message to its handler. Unknown intents (and any
 * intent without a handler) fall back to the clarify-once behaviour.
 */
export async function handleIntent(context) {
    const handler = INTENT_HANDLERS[context.intent] ?? INTENT_HANDLERS.unknown;
    return handler(context);
}
