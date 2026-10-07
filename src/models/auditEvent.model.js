import mongoose from 'mongoose';

export const AUDIT_EVENT_TYPES = [
    'MESSAGE_RECEIVED',
    'DUPLICATE_IGNORED',
    'CLASSIFIED',
    'CLASSIFIER_FALLBACK',
    'REPLY_SENT',
    'ORDER_CREATED',
    'ORDER_UPDATED',
    'TICKET_CREATED',
    'TICKET_UPDATED',
    'NOTIFICATION_SENT',
    'NOTIFICATION_FAILED',
    'WEBHOOK_REJECTED',
    'PAYLOAD_INVALID',
    'VALIDATION_FAILED',
];

export const AUDIT_ENTITY_TYPES = ['message', 'conversation', 'order', 'ticket', 'system'];

export const AUDIT_ACTORS = ['system', 'customer'];

/**
 * Append-only audit trail (workplan 7).
 *
 * Convention: this collection is only ever written, never updated or
 * deleted - there are no update/delete routes for it. Every event carries
 * the request `correlationId` so a full message journey can be replayed.
 */
const auditEventSchema = new mongoose.Schema(
    {
        correlationId: { type: String, required: true, index: true },
        type: { type: String, enum: AUDIT_EVENT_TYPES, required: true },
        entityType: { type: String, enum: AUDIT_ENTITY_TYPES, default: 'system' },
        entityId: { type: String, default: null },
        actor: { type: String, default: 'system' },
        detail: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);

auditEventSchema.index({ createdAt: -1 });
auditEventSchema.index({ type: 1, createdAt: -1 });

// Guard against OverwriteModelError when the module is re-imported (tests).
export const AuditEvent =
    mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);
