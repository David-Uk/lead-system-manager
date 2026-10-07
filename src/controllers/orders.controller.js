import { asyncHandler } from '../utils/asyncHandler.js';
import { HttpError } from '../utils/httpError.js';
import * as audit from '../services/audit.service.js';
import {
    canTransition,
    findOrderByOrderId,
    listOrders,
    updateOrderStatus,
} from '../services/order.service.js';

/**
 * Staff order API (workplan 8.6-8.8). Authentication (x-api-key) and
 * validation run as middleware; this controller only talks to the order
 * service, enforces the transition table and shapes the JSON.
 */

/** Stable order JSON for staff consumers - item snapshots included. */
function toOrderResponse(order) {
    return {
        orderId: order.orderId,
        status: order.status,
        totalNGN: order.totalNGN,
        items: (order.items ?? []).map((item) => ({
            sku: item.sku,
            name: item.name,
            quantity: item.quantity,
            unitPriceNGN: item.unitPriceNGN,
        })),
        deliveryAddress: order.deliveryAddress,
        contactPhone: order.contactPhone,
        conversationId: order.conversationId ? String(order.conversationId) : null,
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
    };
}

/** GET /api/orders - newest first, filtered and paginated (workplan 8.6). */
export const getOrders = asyncHandler(async (req, res) => {
    const { data, page, limit, total } = await listOrders(req.ordersQuery);

    res.status(200).json({
        data: data.map(toOrderResponse),
        page,
        limit,
        total,
    });
});

/** GET /api/orders/:orderId (workplan 8.7). */
export const getOrder = asyncHandler(async (req, res) => {
    const order = await findOrderByOrderId(req.params.orderId);

    if (!order) {
        throw new HttpError(404, 'NOT_FOUND', `Unknown order ${req.params.orderId}`);
    }

    res.status(200).json(toOrderResponse(order));
});

/**
 * PATCH /api/orders/:orderId - status transitions only (workplan 8.8).
 * A repeated status is an idempotent no-op; an illegal jump is a 400. The
 * optional staff note is preserved in the ORDER_UPDATED audit detail.
 */
export const patchOrder = asyncHandler(async (req, res) => {
    const { status, note = null } = req.orderUpdate;
    const order = await findOrderByOrderId(req.params.orderId);

    if (!order) {
        throw new HttpError(404, 'NOT_FOUND', `Unknown order ${req.params.orderId}`);
    }

    const from = order.status;
    if (status !== from) {
        if (!canTransition(from, status)) {
            throw new HttpError(
                400,
                'VALIDATION_ERROR',
                `Cannot move order ${order.orderId} from ${from} to ${status}`,
            );
        }
        await updateOrderStatus(order, status);
        await audit.recordOrderUpdated({
            correlationId: req.id,
            orderId: order.orderId,
            from,
            to: status,
            note,
        });
    }

    res.status(200).json(toOrderResponse(order));
});
