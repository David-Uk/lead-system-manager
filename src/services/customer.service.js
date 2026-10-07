import { Customer } from '../models/customer.model.js';

/**
 * Customer persistence (workplan 7, pipeline step 5).
 *
 * One customer per normalised E.164 phone number. Upsert is the only write
 * path; consent is recorded once at creation (NDPA 2023 data-minimisation
 * story) and `lastSeenAt` is refreshed on every inbound message.
 */

/**
 * Finds the customer by phone or creates one, refreshing `lastSeenAt`.
 * A WhatsApp profile name is only ever written when the caller supplies
 * one, so a nameless payload can never blank a stored name.
 *
 * @param {{phone: string, name?: string|null}} args
 * @returns {Promise<object|null>} the customer document, or null without a usable phone
 */
export async function upsertCustomer({ phone, name = null }) {
    if (!phone) return null;

    const now = new Date();

    const update = {
        $set: { lastSeenAt: now },
        $setOnInsert: {
            consent: { given: true, at: now, purpose: 'order_processing' },
        },
    };
    if (name) update.$set.name = name;

    try {
        return await Customer.findOneAndUpdate({ phone }, update, {
            new: true,
            upsert: true,
            setDefaultsOnInsert: true,
        });
    } catch (err) {
        // Two concurrent first-messages from the same customer can race the
        // upsert insert; the loser retries as a plain update.
        if (err?.code === 11000) {
            return Customer.findOneAndUpdate({ phone }, update, { new: true });
        }
        throw err;
    }
}

/** @returns {Promise<object|null>} the customer with this normalised phone, if any */
export async function findCustomerByPhone(phone) {
    if (!phone) return null;
    return Customer.findOne({ phone });
}

/** @returns {Promise<object|null>} the customer with this id, if any */
export async function findCustomerById(customerId) {
    if (!customerId) return null;
    return Customer.findById(customerId);
}
