import mongoose from 'mongoose';

/**
 * WhatsApp customer, keyed by normalised E.164 phone number.
 * Consent is recorded explicitly (NDPA 2023 data-minimisation story).
 */
const customerSchema = new mongoose.Schema(
    {
        phone: {
            type: String,
            required: true,
            unique: true,
            match: [/^\+[1-9]\d{6,14}$/, 'must be a valid E.164 phone number'],
        },
        name: { type: String, default: null, trim: true },
        consent: {
            given: { type: Boolean, default: true },
            at: { type: Date, default: Date.now },
            purpose: { type: String, default: 'order_processing' },
        },
        lastSeenAt: { type: Date, default: Date.now },
    },
    { timestamps: { createdAt: true, updatedAt: false } },
);

// Guard against OverwriteModelError when the module is re-imported (tests).
export const Customer = mongoose.models.Customer || mongoose.model('Customer', customerSchema);
