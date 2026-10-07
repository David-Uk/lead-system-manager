import mongoose from 'mongoose';

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
        orderId: { type: String, required: true, unique: true },
        customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
        conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
        items: { type: [orderItemSchema], default: [] },
        totalNGN: { type: Number, required: true, min: 0 },
        deliveryAddress: { type: String, required: true, trim: true },
        contactPhone: { type: String, required: true },
        status: { type: String, enum: ORDER_STATUSES, default: 'pending_confirmation' },
    },
    { timestamps: true },
);

orderSchema.index({ status: 1, createdAt: -1 });

// Guard against OverwriteModelError when the module is re-imported (tests).
export const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);
