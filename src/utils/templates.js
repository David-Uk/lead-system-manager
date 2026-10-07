/**
 * Customer-facing reply templates (workplan 6: utils/templates).
 *
 * Every customer-visible string lives here so tone stays consistent, the
 * demo script can quote stable phrases, and tests can assert on fragments
 * instead of full copy.
 */

const prices = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    maximumFractionDigits: 0,
});

/** ₦8,500 style formatting for the Nigerian market. */
export function formatNGN(amount) {
    return prices.format(Number(amount) || 0);
}

const STATUS_LABELS = {
    pending_confirmation: 'pending confirmation - our team will confirm it shortly',
    confirmed: 'confirmed and being prepared',
    dispatched: 'dispatched - it is on the way',
    delivered: 'delivered',
    cancelled: 'cancelled',
};

/** Non-text message (image, audio, sticker) - workplan 8.2. */
export function textOnlyPrompt() {
    return 'I can only read text messages right now - please send your question or order as text.';
}

/** Sender number we cannot normalise to a Nigerian E.164 (v1 scope). */
export function unsupportedNumber() {
    return 'Sorry, this WhatsApp service is only available to Nigerian numbers at the moment.';
}

/** First unknown-intent miss: clarify once (workplan 5.1 step 8). */
export function clarifyUnknown() {
    return 'Sorry, I did not quite understand that. Are you asking about a product, a price, or an order?';
}

/**
 * Second unknown-intent miss: escalated with a ticket (T-013). The reason
 * reflects why the classifier was unsure (`ai_unavailable` |
 * `low_confidence` | `unknown_intent`).
 */
export function unknownTicketReply(ticket) {
    return `Let me get someone from our team to help you with this - your reference is ${ticket.ticketId}. They will reply here shortly.`;
}

/** complaint_or_refund: ticket created, reference sent to the customer (T-013). */
export function complaintTicketReply(ticket) {
    return `Sorry about that experience. I have logged it for our team as ${ticket.ticketId} and someone will continue with you here shortly.`;
}

/** Slot-filling (T-011): the order is missing a product - workplan 8.3 example copy. */
export function orderItemPrompt() {
    return 'Great! Which product would you like?';
}

/** Slot-filling: nothing in the catalogue matches the item answer. */
export function orderItemNotFoundReply(query) {
    return `Sorry, I could not find "${query}" in our catalogue. Which product would you like to order? You can tell me the name or size.`;
}

/** Slot-filling: the chosen product has no stock - pick another. */
export function orderItemOutOfStockReply(product) {
    return `${product.name} is currently out of stock - which other product would you like?`;
}

/** Slot-filling: how many of the chosen product? */
export function orderQuantityPrompt(product) {
    return `How many ${product.name} would you like? (a whole number between 1 and 50)`;
}

/** Slot-filling: the quantity answer was not a usable number (failure 3). */
export function orderQuantityInvalidReply(product) {
    return `Sorry, I need a whole number between 1 and 50 - how many ${product.name} would you like?`;
}

/** Slot-filling: the quantity exceeds available stock (failure 3). */
export function orderQuantityStockReply(product) {
    return `We only have ${product.stock} ${product.name} left - how many would you like?`;
}

/** Slot-filling: delivery address (min length + Lagos area check in the machine). */
export function orderAddressPrompt() {
    return 'What is the delivery address? Please include the area - for example: 12 Example Street, Yaba.';
}

/** Slot-filling: the address answer failed the min-length / area checks. */
export function orderAddressInvalidReply() {
    return 'Sorry, that does not look like a full delivery address. Please send it again with the street and area, e.g. Yaba, Ikeja or Lekki.';
}

/** Slot-filling: summary before the order is created. */
export function orderConfirmPrompt({ product, quantity, address }) {
    return [
        'Please confirm your order:',
        `- ${quantity} x ${product.name} at ${formatNGN(product.priceNGN)} each = ${formatNGN(product.priceNGN * quantity)}`,
        `Delivery to: ${address}`,
        'Reply YES to place the order or NO to cancel.',
    ].join('\n');
}

/** Slot-filling: neither YES nor NO was recognisable. */
export function orderConfirmInvalidReply() {
    return 'Sorry, I did not catch that - please reply YES to place the order or NO to cancel.';
}

/** Slot-filling: order created, status pending_confirmation (workplan 5.2). */
export function orderPlacedReply(order) {
    return `Done! Your order ${order.orderId} (${formatNGN(order.totalNGN)}) is pending confirmation - our team will confirm it shortly.`;
}

/** Slot-filling: the customer cancelled the order (workplan 5.2). */
export function orderCancelledReply() {
    return 'No problem, I have cancelled this order request. You can start a new order anytime.';
}

/** Slot-filling escalated after repeated unusable answers (failure 3) - ticket created. */
export function orderInvalidDataHolding(ticket) {
    return `Sorry, I am having trouble completing this order, so I have passed it to our team as ${ticket.ticketId} - they will reply here shortly.`;
}

/** Slot-filling: the customer asked for a human - ticket created (T-013). */
export function orderHumanHandoff(ticket) {
    return `No problem - I have passed this order to our team as ${ticket.ticketId}. They will reply here shortly.`;
}

function stockLabel(product) {
    return product.stock > 0 ? `in stock (${product.stock} left)` : 'currently out of stock';
}

function bulletList(products, line) {
    return products.map((product) => `- ${line(product)}`).join('\n');
}

/** product_enquiry, single best match. */
export function productFoundReply(product) {
    return `Yes, we have ${product.name} at ${formatNGN(product.priceNGN)} - ${stockLabel(product)}.`;
}

/** product_enquiry, several catalogue matches. */
export function productMatchesReply(products, query) {
    return `Here is what I found for "${query}":\n${bulletList(products, (p) => `${p.name}: ${formatNGN(p.priceNGN)}, ${stockLabel(p)}`)}\nWhich one would you like?`;
}

export function productNotFoundReply(query) {
    return `Sorry, I could not find "${query}" in our catalogue. Could you check the spelling or tell me more about the product?`;
}

/** price_check, single best match. */
export function priceFoundReply(product) {
    return `${product.name} costs ${formatNGN(product.priceNGN)}.`;
}

/** price_check, several catalogue matches. */
export function priceMatchesReply(products, query) {
    return `Prices for "${query}":\n${bulletList(products, (p) => `${p.name}: ${formatNGN(p.priceNGN)}`)}`;
}

export function priceNotFoundReply(query) {
    return `Sorry, I could not find "${query}" in our catalogue, so I do not have a price for it. Could you check the spelling?`;
}

/** order_status with a found order. */
export function orderStatusReply(order) {
    const label = STATUS_LABELS[order.status] ?? order.status;
    return `Order ${order.orderId} is ${label}. Total: ${formatNGN(order.totalNGN)}.`;
}

export function orderNotFoundReply(orderId) {
    return `I could not find an order with reference ${orderId}. Please double-check the reference and try again.`;
}

export function noOrdersFoundReply() {
    return 'I cannot see any recent orders on this number. If you ordered with a different number, send the order reference (it looks like ORD-...) and I will check.';
}

/**
 * Staff-facing alert for a new escalation ticket (T-014), sent through the
 * WhatsApp adapter to STAFF_WHATSAPP_NUMBER. Plain text - staff read it on
 * a phone.
 */
export function staffTicketAlert(ticket, { customerPhone = null } = {}) {
    return [
        `New ${String(ticket.priority).toUpperCase()} ticket ${ticket.ticketId} (${ticket.reason})`,
        customerPhone ? `Customer: ${customerPhone}` : null,
        `Message: ${ticket.summary}`,
        'Pick it up from the staff dashboard.',
    ]
        .filter(Boolean)
        .join('\n');
}
