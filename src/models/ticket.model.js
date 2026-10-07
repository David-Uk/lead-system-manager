import mongoose from 'mongoose';

export const TICKET_REASONS = [
    'complaint',
    'refund',
    'low_confidence',
    'ai_unavailable',
    'invalid_data',
    'unknown_intent',
    'customer_requested',
];

export const TICKET_PRIORITIES = ['low', 'normal', 'high'];
export const TICKET_STATUSES = ['open', 'assigned', 'in_progress', 'resolved', 'closed'];
export const TICKET_NOTIFICATION_STATUSES = ['sent', 'failed', 'pending'];

/**
 * Allowed status transitions enforced by PATCH /api/tickets/:ticketId (T-013,
 * workplan 5.3): open -> assigned -> in_progress -> resolved, any state -> closed.
 */
export const TICKET_TRANSITIONS = {
    open: ['assigned', 'closed'],
    assigned: ['in_progress', 'resolved', 'closed'],
    in_progress: ['resolved', 'closed'],
    resolved: ['closed'],
    closed: [],
};

/**
 * Human escalation ticket. Created whenever the pipeline cannot answer
 * safely (complaint, refund, low confidence, missing data, AI outage...).
 * Tickets `open` for longer than TICKET_SLA_MINUTES are flagged `overdue`
 * in the metrics API (derived, not stored).
 */
const ticketSchema = new mongoose.Schema(
    {
        ticketId: { type: String, required: true, unique: true },
        conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', default: null },
        customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Customer', default: null },
        reason: { type: String, enum: TICKET_REASONS, required: true },
        priority: { type: String, enum: TICKET_PRIORITIES, default: 'normal' },
        status: { type: String, enum: TICKET_STATUSES, default: 'open' },
        assignee: { type: String, default: null },
        summary: { type: String, required: true },
        notificationStatus: {
            type: String,
            enum: TICKET_NOTIFICATION_STATUSES,
            default: 'pending',
        },
        resolutionNote: { type: String, default: null },
        firstResponseAt: { type: Date, default: null },
        resolvedAt: { type: Date, default: null },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);

ticketSchema.index({ status: 1, createdAt: -1 });

// Guard against OverwriteModelError when the module is re-imported (tests).
export const Ticket = mongoose.models.Ticket || mongoose.model('Ticket', ticketSchema);
