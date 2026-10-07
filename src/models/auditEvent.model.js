import mongoose from 'mongoose';
import { sandboxScoped } from './plugins/sandboxScope.js';

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
        correlationId: { type: String, required: true },
        type: { type: String, enum: AUDIT_EVENT_TYPES, required: true },
        entityType: { type: String, enum: AUDIT_ENTITY_TYPES, default: 'system' },
        entityId: { type: String, default: null },
        actor: { type: String, default: 'system' },
        detail: { type: mongoose.Schema.Types.Mixed, default: {} },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);

sandboxScoped(auditEventSchema);

auditEventSchema.index({ sandbox: 1, correlationId: 1 });
auditEventSchema.index({ sandbox: 1, createdAt: -1 });
auditEventSchema.index({ sandbox: 1, type: 1, createdAt: -1 });
auditEventSchema.index({ sandboxExpiresAt: 1 }, { expireAfterSeconds: 0 });

// Guard against OverwriteModelError when the module is re-imported (tests).
export const AuditEvent =
    mongoose.models.AuditEvent || mongoose.model('AuditEvent', auditEventSchema);
