import mongoose from 'mongoose';
import { sandboxScoped } from './plugins/sandboxScope.js';

export const ORDER_STATUSES = [
    'pending_confirmation',
    'confirmed',
    'dispatched',
    'delivered',
    'cancelled',
];

/** Allowed status transitions enforced by PATCH /api/orders/:orderId (T-012). */
export const ORDER_TRANSITIONS = {
    pending_confirmation: ['confirmed', 'cancelled'],
    confirmed: ['dispatched', 'cancelled'],
    dispatched: ['delivered'],
    delivered: [],
    cancelled: [],
};

const orderItemSchema = new mongoose.Schema(
    {
        sku: { type: String, required: true },
        name: { type: String, required: true },
        quantity: { type: Number, required: true, min: 1 },
        unitPriceNGN: { type: Number, required: true, min: 0 },
    },
    { _id: false },
);

/**
 * Customer order created by the place_order slot-filling flow.
 * `orderId` is the human-readable reference sent back on WhatsApp
 * (e.g. ORD-20261007-0001).
 */
const orderSchema = new mongoose.Schema(
    {
        orderId: { type: String, required: true },
        customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true },
        conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
        items: { type: [orderItemSchema], default: [] },
        totalNGN: { type: Number, required: true, min: 0 },
        deliveryAddress: { type: String, required: true, trim: true },
        contactPhone: { type: String, required: true },
        status: { type: String, enum: ORDER_STATUSES, default: 'pending_confirmation' },
    },
    { timestamps: true },
);

sandboxScoped(orderSchema);

// References stay unique per scope; the count-based sequence in
// order.service restarts at 0001 inside each sandbox because its
// countDocuments runs scoped too.
orderSchema.index({ sandbox: 1, orderId: 1 }, { unique: true });
orderSchema.index({ sandbox: 1, status: 1, createdAt: -1 });
orderSchema.index({ sandboxExpiresAt: 1 }, { expireAfterSeconds: 0 });

// Guard against OverwriteModelError when the module is re-imported (tests).
export const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
