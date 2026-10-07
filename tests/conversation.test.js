import './helpers/setup-env.mjs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Customer } from '../src/models/customer.model.js';
import {
    getOrCreateActiveConversation,
    updateConversation,
} from '../src/services/conversation.service.js';
import { upsertCustomer } from '../src/services/customer.service.js';
import { clearDb, startTestDb, stopTestDb } from './helpers/testDb.js';

let mongod;

before(async () => {
    mongod = await startTestDb();
});

after(async () => {
    await stopTestDb(mongod);
});

beforeEach(async () => {
    await clearDb();
});

describe('customer upsert (T-006)', () => {
    test('creates the customer once with consent recorded', async () => {
        const customer = await upsertCustomer({ phone: '+2348012345678', name: 'Ada' });

        assert.ok(customer._id);
        assert.equal(customer.phone, '+2348012345678');
        assert.equal(customer.name, 'Ada');
        assert.equal(customer.consent.given, true);
        assert.equal(customer.consent.purpose, 'order_processing');
        assert.ok(customer.lastSeenAt instanceof Date);
        assert.equal(await Customer.countDocuments(), 1);
    });

    test('repeat messages refresh lastSeenAt without duplicating or blanking the name', async () => {
        const first = await upsertCustomer({ phone: '+2348012345678', name: 'Ada' });
        await new Promise((resolve) => setTimeout(resolve, 5));

        // A nameless payload (no profile name on this update) keeps the name.
        const second = await upsertCustomer({ phone: '+2348012345678' });
        assert.equal(String(second._id), String(first._id));
        assert.equal(second.name, 'Ada');
        assert.ok(second.lastSeenAt.getTime() > first.lastSeenAt.getTime());
        assert.equal(await Customer.countDocuments(), 1);

        // The latest WhatsApp profile name wins.
        const third = await upsertCustomer({ phone: '+2348012345678', name: 'Ada Obi' });
        assert.equal(third.name, 'Ada Obi');
    });

    test('returns null when there is no usable phone', async () => {
        assert.equal(await upsertCustomer({ phone: null }), null);
        assert.equal(await Customer.countDocuments(), 0);
    });
});

describe('conversation resume/create (T-006)', () => {
    test('resumes the existing active conversation and starts in IDLE', async () => {
        const customer = await upsertCustomer({ phone: '+2348012345678' });

        const first = await getOrCreateActiveConversation(customer._id);
        const second = await getOrCreateActiveConversation(customer._id);

        assert.equal(String(second._id), String(first._id));
        assert.equal(first.status, 'active');
        assert.equal(first.state, 'IDLE');
        assert.equal(first.currentIntent, null);
        assert.equal(first.retries, 0);
        assert.equal(first.clarifyAttempts, 0);
    });

    test('a terminal conversation rolls over to a fresh one', async () => {
        const customer = await upsertCustomer({ phone: '+2348012345678' });
        const conversation = await getOrCreateActiveConversation(customer._id);

        await updateConversation(conversation._id, { state: 'COMPLETED', status: 'completed' });

        const next = await getOrCreateActiveConversation(customer._id);
        assert.notEqual(String(next._id), String(conversation._id));
        assert.equal(next.state, 'IDLE');
        assert.equal(next.status, 'active');
    });

    test('updateConversation applies patches and returns the fresh document', async () => {
        const customer = await upsertCustomer({ phone: '+2348012345678' });
        const conversation = await getOrCreateActiveConversation(customer._id);

        const updated = await updateConversation(conversation._id, {
            currentIntent: 'price_check',
            clarifyAttempts: 1,
        });

        assert.equal(updated.currentIntent, 'price_check');
        assert.equal(updated.clarifyAttempts, 1);
    });
});
