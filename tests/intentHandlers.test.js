import './helpers/setup-env.mjs';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/auditEvent.model.js';
import { Conversation } from '../src/models/conversation.model.js';
import { Order } from '../src/models/order.model.js';
import { Product } from '../src/models/product.model.js';
import { Ticket } from '../src/models/ticket.model.js';
import { clearDb, startTestDb, stopTestDb } from './helpers/testDb.js';

const app = createApp();
const API_KEY = 'test-staff-key';
const PHONE = '+2348012345678';

let mongod;

before(async () => {
    mongod = await startTestDb();
});

after(async () => {
    await stopTestDb(mongod);
});

beforeEach(async () => {
    await clearDb();
    await Product.create([
        {
            sku: 'RICE-5KG',
            name: 'Rice 5kg',
            aliases: ['rice', 'bag of rice', 'ofada rice'],
            category: 'Grains',
            priceNGN: 8500,
            stock: 40,
            active: true,
        },
        {
            sku: 'BEANS-1KG',
            name: 'Beans 1kg',
            aliases: ['beans', 'oloyin beans'],
            category: 'Grains',
            priceNGN: 2500,
            stock: 25,
            active: true,
        },
        {
            sku: 'PALM-OIL-1L',
            name: 'Palm Oil 1L',
            aliases: ['palm oil', 'red oil'],
            category: 'Cooking',
            priceNGN: 3000,
            stock: 0,
            active: true,
        },
    ]);
});

function postMessage({ from = PHONE, text, ...rest }) {
    return request(app)
        .post('/simulate/message')
        .set('x-api-key', API_KEY)
        .send({ from, text, messageId: `sim-${randomUUID()}`, ...rest });
}

async function seedOrder(overrides = {}) {
    return Order.create({
        orderId: 'ORD-20261007-0001',
        customerId: new mongoose.Types.ObjectId(),
        items: [{ sku: 'RICE-5KG', name: 'Rice 5kg', quantity: 2, unitPriceNGN: 8500 }],
        totalNGN: 17000,
        deliveryAddress: '12 Example Street, Yaba, Lagos',
        contactPhone: PHONE,
        status: 'pending_confirmation',
        ...overrides,
    });
}

describe('product_enquiry and price_check handlers (T-010, T1/T2)', () => {
    test('"Do you have rice?" answers from the catalogue', async () => {
        const res = await postMessage({ text: 'Do you have rice?' });

        assert.equal(res.status, 200);
        assert.equal(res.body.intent, 'product_enquiry');
        assert.equal(res.body.classifierSource, 'rules');
        assert.equal(res.body.replies.length, 1);
        assert.match(res.body.replies[0], /Yes, we have Rice 5kg at/);
        assert.match(res.body.replies[0], /8,500/);
        assert.match(res.body.replies[0], /in stock/);
    });

    test('an out-of-stock product is called out', async () => {
        const res = await postMessage({ text: 'Do you have palm oil?' });

        assert.equal(res.body.intent, 'product_enquiry');
        assert.match(res.body.replies[0], /Palm Oil 1L/);
        assert.match(res.body.replies[0], /currently out of stock/);
    });

    test('two equally-good matches get a list to choose from', async () => {
        const res = await postMessage({ text: 'Do you have rice or beans?' });

        assert.equal(res.body.intent, 'product_enquiry');
        assert.match(res.body.replies[0], /Here is what I found/);
        assert.match(res.body.replies[0], /Rice 5kg/);
        assert.match(res.body.replies[0], /Beans 1kg/);
    });

    test('a product we do not sell gets an honest not-found reply', async () => {
        const res = await postMessage({ text: 'How much is your shawarma?' });

        assert.equal(res.body.intent, 'price_check');
        assert.match(res.body.replies[0], /could not find/);
    });

    test('"How much is 5kg rice?" answers with the price (T2)', async () => {
        const res = await postMessage({ text: 'How much is 5kg rice?' });

        assert.equal(res.status, 200);
        assert.equal(res.body.intent, 'price_check');
        assert.equal(res.body.replies.length, 1);
        assert.match(res.body.replies[0], /Rice 5kg costs/);
        assert.match(res.body.replies[0], /8,500/);
    });
});

describe('order_status handler (T-010, T4)', () => {
    test('an order reference is looked up and answered with its status', async () => {
        await seedOrder();

        const res = await postMessage({ text: 'Where is my order ORD-20261007-0001?' });

        assert.equal(res.body.intent, 'order_status');
        assert.equal(res.body.orderId, 'ORD-20261007-0001');
        assert.match(res.body.replies[0], /Order ORD-20261007-0001 is pending confirmation/);
        assert.match(res.body.replies[0], /17,000/);
    });

    test('without a reference, the latest order on this number is used', async () => {
        await seedOrder();

        const res = await postMessage({ text: 'where is my delivery?' });

        assert.equal(res.body.intent, 'order_status');
        assert.equal(res.body.orderId, 'ORD-20261007-0001');
        assert.match(res.body.replies[0], /Order ORD-20261007-0001 is/);
    });

    test('an unknown reference gets an honest not-found reply', async () => {
        const res = await postMessage({ text: 'Where is my order ORD-20261007-9999?' });

        assert.equal(res.body.intent, 'order_status');
        assert.equal(res.body.orderId, null);
        assert.match(res.body.replies[0], /could not find an order with reference ORD-20261007-9999/);
    });

    test('a number with no orders says so', async () => {
        const res = await postMessage({
            from: '+2348099999999',
            text: 'where is my order?',
        });

        assert.equal(res.body.intent, 'order_status');
        assert.match(res.body.replies[0], /cannot see any recent orders/);
    });
});

describe('place_order slot-filling start and complaint_or_refund escalation (T-011 / T-013)', () => {
    test('a purchase intent seeds the slots and asks the next question (T-011)', async () => {
        const res = await postMessage({ text: 'I want to buy 2 bags of rice' });

        assert.equal(res.body.intent, 'place_order');
        assert.equal(res.body.replies.length, 1);
        // Item (rice) and quantity (2) came from the classifier entities,
        // so the machine only needs the delivery address.
        assert.match(res.body.replies[0], /What is the delivery address/);

        const conversation = await Conversation.findById(res.body.conversation.id);
        assert.equal(conversation.currentIntent, 'place_order');
        assert.equal(conversation.state, 'COLLECT_ADDRESS');
        assert.equal(conversation.slots.sku, 'RICE-5KG');
        assert.equal(conversation.slots.quantity, 2);
    });

    test('a complaint creates a ticket, notifies staff and hands off (T5, failure 4)', async () => {
        const res = await postMessage({ text: 'My item came damaged, I want a refund' });

        assert.equal(res.body.intent, 'complaint_or_refund');
        assert.match(res.body.ticketId, /^TKT-\d{4}$/);
        assert.match(res.body.replies[0], /logged it for our team as TKT-/);

        // Escalation closes the conversation and hands it to a human.
        const conversation = await Conversation.findById(res.body.conversation.id);
        assert.equal(conversation.state, 'ESCALATED');
        assert.equal(conversation.status, 'escalated');

        const ticket = await Ticket.findOne({ ticketId: res.body.ticketId });
        assert.ok(ticket);
        assert.equal(ticket.reason, 'refund'); // the text says "refund"
        assert.equal(ticket.priority, 'high');
        assert.equal(ticket.status, 'open');
        assert.equal(ticket.summary, 'My item came damaged, I want a refund');
        assert.equal(ticket.notificationStatus, 'sent'); // simulated staff alert

        const created = await AuditEvent.findOne({ type: 'TICKET_CREATED' });
        assert.ok(created, 'TICKET_CREATED audit event written');
        assert.equal(created.entityId, res.body.ticketId);
        assert.equal(created.detail.reason, 'refund');
        assert.equal(created.correlationId, res.body.correlationId);

        const notified = await AuditEvent.findOne({ type: 'NOTIFICATION_SENT' });
        assert.ok(notified, 'NOTIFICATION_SENT audit event written');
        assert.equal(notified.entityId, res.body.ticketId);
        assert.equal(notified.detail.channel, 'whatsapp');
    });
});

describe('unknown intent clarify-once flow (T-010, workplan 5.1 step 8)', () => {
    test('the first miss asks a clarifying question and counts the attempt', async () => {
        const res = await postMessage({ text: 'hmm okay then' });

        assert.equal(res.body.intent, 'unknown');
        assert.equal(res.body.classifierSource, 'fallback');
        assert.match(res.body.replies[0], /did not quite understand/);

        const conversation = await Conversation.findById(res.body.conversation.id);
        assert.equal(conversation.clarifyAttempts, 1);
    });

    test('the second miss escalates with a ticket and a classifier-failure reason (T8)', async () => {
        await postMessage({ text: 'hmm okay then' });
        const res = await postMessage({ text: 'still not sure what you mean' });

        assert.equal(res.body.intent, 'unknown');
        assert.match(res.body.ticketId, /^TKT-\d{4}$/);
        assert.match(res.body.replies[0], /your reference is TKT-/);

        const conversation = await Conversation.findById(res.body.conversation.id);
        assert.equal(conversation.clarifyAttempts, 2);
        assert.equal(conversation.status, 'escalated');

        // LLM_PROVIDER=none degrades the classifier, so the reason recorded
        // on the ticket is the failure reason, not a generic unknown_intent.
        const ticket = await Ticket.findOne({ ticketId: res.body.ticketId });
        assert.equal(ticket.reason, 'ai_unavailable');
        assert.equal(ticket.status, 'open');
        assert.equal(ticket.notificationStatus, 'sent');

        const created = await AuditEvent.findOne({ type: 'TICKET_CREATED' });
        assert.equal(created.detail.reason, 'ai_unavailable');
    });

    test('a clear intent resets the clarify counter', async () => {
        await postMessage({ text: 'hmm okay then' });
        const clear = await postMessage({ text: 'How much is 5kg rice?' });

        const conversation = await Conversation.findById(clear.body.conversation.id);
        assert.equal(conversation.clarifyAttempts, 0);
        assert.equal(conversation.currentIntent, 'price_check');
    });
});
