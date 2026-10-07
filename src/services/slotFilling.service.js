import * as templates from '../utils/templates.js';
import { findProductsByQuery, getProductBySku } from './product.service.js';
import { createOrder } from './order.service.js';
import { createTicket } from './ticket.service.js';

/**
 * Order slot-filling state machine (workplan 5.2, T-011).
 *
 *   IDLE -> COLLECT_ITEM -> COLLECT_QTY -> COLLECT_ADDRESS -> CONFIRM -> COMPLETED
 *
 * The machine owns no HTTP and no messaging: it takes the inbound text plus
 * the current conversation, reads the catalogue/order services, and returns
 * `{ replies, conversationPatch, order?, ticket?, validationFailure? }` for
 * the pipeline to apply, send and audit. Every slot answer is validated here.
 *
 * Rules from the workplan implemented below:
 *   - Any state: CANCEL -> CANCELLED; HUMAN/AGENT -> ESCALATED with a ticket
 *     (`customer_requested`); two re-prompts then ESCALATED with reason
 *     `invalid_data` (failure 3) - both escalation branches create a Ticket
 *     (T-013) so the reply can quote its reference.
 *   - Idle for 30 minutes -> EXPIRED; the pipeline does the lazy rollover
 *     via `isStale()` before routing a message.
 *   - COLLECT_PHONE is unreachable in v1: a conversation only exists for a
 *     usable Nigerian number, which doubles as the order contact phone.
 */

export const COLLECTING_STATES = [
    'COLLECT_ITEM',
    'COLLECT_QTY',
    'COLLECT_ADDRESS',
    'COLLECT_PHONE',
    'CONFIRM',
];

/** Workplan 5.2: a half-finished order older than this is dead. */
const EXPIRY_MS = 30 * 60 * 1000;

/** Workplan failure 3: re-prompt twice, the third unusable answer escalates. */
const MAX_RETRIES = 2;

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 50;
const MIN_ADDRESS_LENGTH = 10;
const MAX_MATCHES_IN_REPLY = 3;

const CANCEL_RE = /\bcancel\b/i;
const HUMAN_RE = /\b(human|agent|representative)\b/i;
const YES_RE = /^\s*(yes|yeah|yep|y|sure|ok|okay|confirm(?:ed)?|correct|proceed)\b/i;
const NO_RE = /^\s*(no|nope|nah|don'?t|cancel)\b/i;

/** Lagos delivery areas the address check looks for (assumption 5: one city). */
const LAGOS_AREAS = [
    'lagos', 'yaba', 'ikeja', 'lekki', 'ikoyi', 'victoria island', 'surulere',
    'ajah', 'gbagada', 'festac', 'apapa', 'oshodi', 'mushin', 'maryland',
    'ilupeju', 'ojota', 'ketu', 'magodo', 'agege', 'ikorodu', 'epe', 'badagry',
    'amuwo', 'isolo', 'okota', 'aguda', 'ogba', 'ojodu', 'akowonjo', 'egbeda',
    'idimu', 'sangotedo', 'oniru', 'ikate', 'alimosho', 'ebute metta',
];

/** Street markers that make "House 7, Admiralty Way" acceptable without an area name. */
const STREET_WORDS = [
    'street', 'road', 'avenue', 'ave', 'way', 'close', 'crescent', 'estate',
    'drive', 'lane', 'boulevard', 'plaza', 'junction', 'phase', 'block', 'flat',
];

const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the conversation is mid-order and waiting for a slot answer. */
export function isCollectingState(state) {
    return COLLECTING_STATES.includes(state);
}

/**
 * Workplan 5.2: lazy expiry - a collecting conversation idle for more than
 * 30 minutes is stale. The pipeline expires it and rolls the customer onto
 * a fresh conversation on the next message.
 */
export function isStale(conversation, now = Date.now()) {
    if (!conversation || !isCollectingState(conversation.state)) return false;
    const last = new Date(conversation.lastMessageAt ?? 0).getTime();
    return Number.isFinite(last) && now - last > EXPIRY_MS;
}

/** First standalone number in the text; null when there is none. */
function parseQuantity(text) {
    const match = String(text ?? '').match(/\b(\d{1,3})\b/);
    return match ? Number(match[1]) : null;
}

/** Min length + must mention a Lagos area, or a street word with a house number. */
function isValidAddress(text) {
    const value = String(text ?? '').trim();
    if (value.length < MIN_ADDRESS_LENGTH || !/[a-z]/i.test(value)) return false;

    const lower = value.toLowerCase();
    if (LAGOS_AREAS.some((area) => new RegExp(`\\b${escapeForRegExp(area)}\\b`).test(lower))) {
        return true;
    }
    return /\d/.test(value) && STREET_WORDS.some((word) => new RegExp(`\\b${word}\\b`).test(lower));
}

/** Short, safe excerpt of customer text for ticket summaries. */
const snippet = (text) => String(text ?? '').trim().slice(0, 200);

/** Explicit slot pick - a mongoose subdocument must not be spread blindly. */
function readSlots(conversation) {
    return {
        sku: conversation?.slots?.sku ?? null,
        quantity: conversation?.slots?.quantity ?? null,
        address: conversation?.slots?.address ?? null,
        phone: conversation?.slots?.phone ?? null,
    };
}

const ask = (state, reply, slots, retries) => ({
    replies: [reply],
    conversationPatch: { state, slots, retries },
});

/**
 * Invalid slot answer: re-prompt with the attempt count, or escalate with a
 * ticket once the customer has burned their retries (failure 3). The
 * attempted event is reported as `validationFailure` so the pipeline can
 * audit it.
 */
async function invalidInput({ reply, state, slots, retries, reason, text, customer, conversation }) {
    const attempt = retries + 1;

    if (attempt > MAX_RETRIES) {
        // Failure 3 alt: escalate with reason invalid_data (T-013).
        const ticket = await createTicket({
            conversationId: conversation?._id ?? null,
            customerId: customer?._id ?? null,
            reason: 'invalid_data',
            summary: `Order flow stopped after ${attempt} unusable answers (${reason}). Last message: "${snippet(text)}"`,
        });

        return {
            replies: [templates.orderInvalidDataHolding(ticket)],
            conversationPatch: { state: 'ESCALATED', status: 'escalated', slots, retries: attempt },
            validationFailure: { state, reason, attempt },
            ticket,
        };
    }

    return {
        replies: [reply],
        conversationPatch: { state, slots, retries: attempt },
        validationFailure: { state, reason, attempt },
    };
}

/**
 * Asks the next missing question, or the CONFIRM summary once every slot is
 * filled. Guards keep a conversation that was tampered with (or answered
 * while stale) from ever skipping a question.
 */
async function advance({ slots, retries = 0 }) {
    const product = slots.sku ? await getProductBySku(slots.sku) : null;

    if (!product) {
        return ask('COLLECT_ITEM', templates.orderItemPrompt(), slots, retries);
    }
    if (product.stock === 0) {
        slots.sku = null; // selection was valid, the product is not - ask again
        return ask('COLLECT_ITEM', templates.orderItemOutOfStockReply(product), slots, retries);
    }
    if (!Number.isInteger(slots.quantity) || slots.quantity < MIN_QUANTITY || slots.quantity > MAX_QUANTITY) {
        return ask('COLLECT_QTY', templates.orderQuantityPrompt(product), slots, retries);
    }
    if (slots.quantity > product.stock) {
        return ask('COLLECT_QTY', templates.orderQuantityStockReply(product), slots, retries);
    }
    if (!slots.address) {
        return ask('COLLECT_ADDRESS', templates.orderAddressPrompt(), slots, retries);
    }
    return ask(
        'CONFIRM',
        templates.orderConfirmPrompt({
            product,
            quantity: slots.quantity,
            address: slots.address,
        }),
        slots,
        retries,
    );
}

/** CONFIRM + YES: snapshot the product into an order and close the conversation. */
async function completeOrder({ slots, customer, conversation }) {
    const product = slots.sku ? await getProductBySku(slots.sku) : null;

    if (!product || product.stock === 0 || !Number.isInteger(slots.quantity) || !slots.address) {
        return advance({ slots, customer, conversation });
    }

    const order = await createOrder({
        customerId: customer._id,
        conversationId: conversation._id,
        items: [
            {
                sku: product.sku,
                name: product.name,
                quantity: slots.quantity,
                unitPriceNGN: product.priceNGN,
            },
        ],
        deliveryAddress: slots.address,
        contactPhone: customer.phone,
    });

    return {
        replies: [templates.orderPlacedReply(order)],
        conversationPatch: { state: 'COMPLETED', status: 'completed', slots, retries: 0 },
        order: { orderId: order.orderId, totalNGN: order.totalNGN, itemCount: order.items.length },
    };
}

/** Fresh place_order: seed slots from the classifier entities, then advance. */
async function startOrder({ text, entities, customer, conversation, slots }) {
    const quantity = Number.isInteger(entities.quantity) ? entities.quantity : null;
    slots.quantity = quantity;

    // A resolved productQuery names exactly one product; otherwise re-match
    // the raw text and let the customer pick when several are equally good.
    const query = entities.productQuery ?? text;
    const matches = entities.productQuery
        ? await findProductsByQuery(query, { limit: MAX_MATCHES_IN_REPLY })
        : await findProductsByQuery(text, { limit: MAX_MATCHES_IN_REPLY });

    if (matches.length === 1) {
        slots.sku = matches[0].sku;
        return advance({ slots, customer, conversation, retries: 0 });
    }
    if (matches.length > 1) {
        return {
            replies: [templates.productMatchesReply(matches, query)],
            conversationPatch: { state: 'COLLECT_ITEM', slots, retries: 0 },
        };
    }
    return ask('COLLECT_ITEM', templates.orderItemPrompt(), slots, 0);
}

/** The customer is answering the question the machine last asked. */
async function resumeSlot({ text, customer, conversation, slots, retries }) {
    const state = conversation.state;

    if (state === 'COLLECT_QTY' && !slots.sku) {
        return advance({ slots, customer, conversation, retries });
    }

    switch (state) {
        case 'COLLECT_ITEM': {
            const matches = await findProductsByQuery(text, { limit: MAX_MATCHES_IN_REPLY });

            if (matches.length === 0) {
                return invalidInput({
                    reply: templates.orderItemNotFoundReply(text),
                    state,
                    slots,
                    retries,
                    reason: 'item_not_found',
                    text,
                    customer,
                    conversation,
                });
            }
            if (matches.length === 1) {
                slots.sku = matches[0].sku;
                return advance({ slots, customer, conversation, retries: 0 });
            }
            // Several equal candidates is a normal choice, not a failed retry.
            return {
                replies: [templates.productMatchesReply(matches, text)],
                conversationPatch: { state, slots, retries },
            };
        }

        case 'COLLECT_QTY': {
            const product = await getProductBySku(slots.sku);
            const quantity = parseQuantity(text);

            if (quantity === null || quantity < MIN_QUANTITY || quantity > MAX_QUANTITY) {
                return invalidInput({
                    reply: templates.orderQuantityInvalidReply(product),
                    state,
                    slots,
                    retries,
                    reason: 'quantity_invalid',
                    text,
                    customer,
                    conversation,
                });
            }
            if (product && quantity > product.stock) {
                return invalidInput({
                    reply: templates.orderQuantityStockReply(product),
                    state,
                    slots,
                    retries,
                    reason: 'quantity_exceeds_stock',
                    text,
                    customer,
                    conversation,
                });
            }
            slots.quantity = quantity;
            return advance({ slots, customer, conversation, retries: 0 });
        }

        case 'COLLECT_ADDRESS': {
            if (!isValidAddress(text)) {
                return invalidInput({
                    reply: templates.orderAddressInvalidReply(),
                    state,
                    slots,
                    retries,
                    reason: 'address_invalid',
                    text,
                    customer,
                    conversation,
                });
            }
            slots.address = String(text).trim();
            return advance({ slots, customer, conversation, retries: 0 });
        }

        case 'CONFIRM': {
            if (YES_RE.test(text)) {
                return completeOrder({ slots, customer, conversation });
            }
            if (NO_RE.test(text)) {
                return {
                    replies: [templates.orderCancelledReply()],
                    conversationPatch: { state: 'CANCELLED', status: 'completed', slots, retries: 0 },
                };
            }
            return invalidInput({
                reply: templates.orderConfirmInvalidReply(),
                state,
                slots,
                retries,
                reason: 'confirm_unclear',
                text,
                customer,
                conversation,
            });
        }

        default:
            // COLLECT_PHONE never happens in v1 - fall back to re-advancing.
            return advance({ slots, customer, conversation, retries });
    }
}

/**
 * Entry point used by the place_order intent handler (and the pipeline's
 * slot-resume path). Handles the "any state" escapes first, then dispatches
 * to a fresh start or to the current question's answer.
 *
 * @returns {Promise<{replies: string[], conversationPatch: object,
 *   order?: {orderId: string, totalNGN: number, itemCount: number},
 *   ticket?: object,
 *   validationFailure?: {state: string, reason: string, attempt: number}}>}
 */
export async function handlePlaceOrderFlow({ text, entities = {}, customer, conversation }) {
    if (CANCEL_RE.test(text)) {
        return {
            replies: [templates.orderCancelledReply()],
            conversationPatch: { state: 'CANCELLED', status: 'completed', retries: 0 },
        };
    }
    if (HUMAN_RE.test(text)) {
        // Hand-off with a ticket (T-013), reason customer_requested.
        const ticket = await createTicket({
            conversationId: conversation?._id ?? null,
            customerId: customer?._id ?? null,
            reason: 'customer_requested',
            summary: `Customer asked for a human during the order flow. Last message: "${snippet(text)}"`,
        });

        return {
            replies: [templates.orderHumanHandoff(ticket)],
            conversationPatch: { state: 'ESCALATED', status: 'escalated', retries: 0 },
            ticket,
        };
    }

    const slots = readSlots(conversation);
    const retries = conversation?.retries ?? 0;

    if (isCollectingState(conversation?.state)) {
        return resumeSlot({ text, customer, conversation, slots, retries });
    }
    return startOrder({ text, entities, customer, conversation, slots });
}
