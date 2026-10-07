import mongoose from 'mongoose';
import { sandboxScoped } from './plugins/sandboxScope.js';

export const CONVERSATION_STATUSES = ['active', 'escalated', 'completed', 'expired'];

export const CONVERSATION_STATES = [
    'IDLE',
    'COLLECT_ITEM',
    'COLLECT_QTY',
    'COLLECT_ADDRESS',
    'COLLECT_PHONE',
    'CONFIRM',
    'COMPLETED',
    'CANCELLED',
    'ESCALATED',
    'EXPIRED',
];

/**
 * One rolling conversation per customer. `state` drives the order
 * slot-filling machine (workplan 5.2); `slots` holds partially collected
 * order data between messages.
 */
const conversationSchema = new mongoose.Schema(
    {
        customerId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Customer',
            required: true,
        },
        status: { type: String, enum: CONVERSATION_STATUSES, default: 'active' },
        currentIntent: { type: String, default: null },
        state: { type: String, enum: CONVERSATION_STATES, default: 'IDLE' },
        slots: {
            sku: { type: String, default: null },
            quantity: { type: Number, default: null },
            address: { type: String, default: null },
            phone: { type: String, default: null },
        },
        retries: { type: Number, default: 0, min: 0 },
        clarifyAttempts: { type: Number, default: 0, min: 0 },
        lastMessageAt: { type: Date, default: Date.now },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);

sandboxScoped(conversationSchema);

conversationSchema.index({ sandbox: 1, customerId: 1, status: 1 });
conversationSchema.index({ sandboxExpiresAt: 1 }, { expireAfterSeconds: 0 });

// Guard against OverwriteModelError when the module is re-imported (tests).
export const Conversation =
    mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
