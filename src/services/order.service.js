import { Order, ORDER_TRANSITIONS } from '../models/order.model.js';
import { normalisePhone } from '../utils/phone.js';

/**
 * Order domain service.
 *
 * T-010 added the lookup helpers used by the `order_status` intent handler;
 * T-011 adds `createOrder` (called by the slot-filling machine on CONFIRM)
 * and T-012 adds the staff-facing list/transition helpers behind
 * /api/orders. HTTP concerns (status codes, error shaping) stay in the
 * controller - this module only touches documents.
 */

/**
 * @param {string} orderId - human-readable reference, e.g. ORD-20261007-0001
 * @returns {Promise<object|null>} the order, if any
 */
export async function findOrderByOrderId(orderId) {
    if (!orderId) return null;
    return Order.findOne({ orderId: String(orderId).trim().toUpperCase() });
}

/**
 * Most recent order placed from a phone number - the fallback when the
 * customer asks "where is my order?" without quoting a reference.
 */
export async function findLatestOrderForPhone(phone) {
    if (!phone) return null;
    return Order.findOne({ contactPhone: phone }).sort({ createdAt: -1 });
}

/**
 * Creates an order with a human-readable reference, ORD-YYYYMMDD-####
 * (workplan 7 `orders`). The daily sequence is counted from today's orders;
 * the unique index on `orderId` is the backstop when two orders race the
 * counter, in which case the sequence is re-read and retried.
 *
 * `items` are snapshots ({ sku, name, quantity, unitPriceNGN }) - catalogue
 * price changes never rewrite history.
 *
 * @returns {Promise<object>} the created order (status pending_confirmation)
 */
export async function createOrder({
    customerId,
    conversationId = null,
    items,
    deliveryAddress,
    contactPhone,
}) {
    const totalNGN = items.reduce((sum, item) => sum + item.quantity * item.unitPriceNGN, 0);
    const prefix = `ORD-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`;

    for (let attempt = 0; attempt < 5; attempt += 1) {
        const sequence = (await Order.countDocuments({ orderId: { $regex: `^${prefix}-` } })) + 1;

        try {
            return await Order.create({
                orderId: `${prefix}-${String(sequence).padStart(4, '0')}`,
                customerId,
                conversationId,
                items,
                totalNGN,
                deliveryAddress,
                contactPhone,
            });
        } catch (err) {
            if (err?.code !== 11000) throw err;
            // Same sequence as a concurrent insert - re-read the count and retry.
        }
    }

    throw new Error(`could not allocate an order id under ${prefix}`);
}

/**
 * Staff listing behind GET /api/orders (workplan 8.6). `phone` accepts any
 * Nigerian shape and is normalised before matching `contactPhone`.
 *
 * @returns {Promise<{data: Array<object>, page: number, limit: number, total: number}>}
 */
export async function listOrders({
    status = null,
    phone = null,
    from = null,
    to = null,
    page = 1,
    limit = 20,
} = {}) {
    const query = {};
    if (status) query.status = status;
    if (phone) query.contactPhone = normalisePhone(phone) ?? String(phone).trim();
    if (from || to) {
        query.createdAt = {};
        if (from) query.createdAt.$gte = from;
        if (to) query.createdAt.$lte = to;
    }

    const total = await Order.countDocuments(query);
    const data = await Order.find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean();

    return { data, page, limit, total };
}

/** True when `to` is a legal next status for `from` (workplan 8.8 table). */
export function canTransition(from, to) {
    return Boolean(ORDER_TRANSITIONS[from]?.includes(to));
}

/**
 * Applies a staff status change and returns the fresh document. The caller
 * (controller) enforces `canTransition`; the optional note is not stored on
 * the order - it belongs in the ORDER_UPDATED audit detail.
 */
export async function updateOrderStatus(order, nextStatus) {
    order.status = nextStatus;
    return order.save();
}
