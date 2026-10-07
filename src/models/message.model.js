import mongoose from 'mongoose';

export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'];
export const CLASSIFIER_SOURCES = ['rules', 'llm', 'fallback'];

/**
 * Immutable conversation message.
 *
 * The unique index on `providerMessageId` is the dedupe backstop for
 * webhook retries (workplan failure #2): the second insert of the same
 * provider message id fails with a duplicate-key error.
 */
const messageSchema = new mongoose.Schema(
    {
        conversationId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Conversation',
            required: true,
            index: true,
        },
        direction: { type: String, enum: MESSAGE_DIRECTIONS, required: true },
        providerMessageId: { type: String, required: true, unique: true },
        text: { type: String, default: '' },
        intent: { type: String, default: null },
        confidence: { type: Number, default: null, min: 0, max: 1 },
        classifierSource: { type: String, enum: [...CLASSIFIER_SOURCES, null], default: null },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);

messageSchema.index({ conversationId: 1, createdAt: 1 });

// Guard against OverwriteModelError when the module is re-imported (tests).
export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
