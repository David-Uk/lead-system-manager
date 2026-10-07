import './helpers/setup-env.mjs';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/auditEvent.model.js';
import { Conversation } from '../src/models/conversation.model.js';
import { Message } from '../src/models/message.model.js';
import { Order } from '../src/models/order.model.js';
import { Product } from '../src/models/product.model.js';
import { Ticket } from '../src/models/ticket.model.js';
import { clearDb, startTestDb, stopTestDb } from './helpers/testDb.js';

/**
 * Order slot-filling state machine, end to end through POST /simulate
 * (workplan 5.2, T-011): start -> collect -> confirm -> order created, plus
 * the failure paths (failure 3 retries/escalation, cancel, human, expiry).
 */

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
            sku: 'RICE-10KG',
            name: 'Rice 10kg',
            aliases: ['rice 10kg', 'big bag of rice'],
            category: 'Grains',
            priceNGN: 16000,
            stock: 25,
            active: true,
        },
        {
            sku: 'RICE-25KG',
            name: 'Rice 25kg',
            aliases: ['rice 25kg', 'whole bag of rice'],
            category: 'Grains',
            priceNGN: 38500,
            stock: 12,
            active: true,
        },
        {
            sku: 'GARRI-5KG',
            name: 'Garri 5kg',
            aliases: ['garri', 'eba'],
            category: 'Grains',
            priceNGN: 2500,
            stock: 55,
            active: true,
        },
        {
            sku: 'PALMOIL-1L',
            name: 'Palm Oil 1L',
            aliases: ['palm oil', 'red oil'],
            category: 'Oils',
            priceNGN: 2800,
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

describe('slot-filling happy path (T-011, workplan 5.2 + test T3)', () => {
    test('"I want to order 2 bags of rice" walks COLLECT_ITEM -> CONFIRM -> order created', async () => {
        // Ambiguous item ("bags of rice" fits three SKUs): offer the choices.
        const start = await postMessage({ text: 'I want to order 2 bags of rice' });

        assert.equal(start.status, 200);
        assert.equal(start.body.intent, 'place_order');
        assert.equal(start.body.conversation.state, 'COLLECT_ITEM');
        assert.match(start.body.replies[0], /Here is what I found/);
        assert.match(start.body.replies[0], /Rice 10kg/);
        assert.match(start.body.replies[0], /Rice 25kg/);
        assert.match(start.body.replies[0], /Rice 5kg/);
        assert.match(start.body.replies[0], /Which one would you like/);

        // Picking the item resumes the machine - classification is skipped.
        const item = await postMessage({ text: 'Rice 5kg', messageId: 'sim-slot-item' });

        assert.equal(item.body.conversation.state, 'COLLECT_ADDRESS');
        assert.equal(item.body.intent, 'place_order');
        assert.equal(item.body.confidence, null);
        assert.equal(item.body.classifierSource, null);
        assert.match(item.body.replies[0], /delivery address/);

        const stored = await Message.findOne({ providerMessageId: 'sim-slot-item' });
        assert.equal(stored.intent, 'place_order');
        assert.equal(stored.classifierSource, null);
        assert.equal(stored.confidence, null);

        // Quantity (2) was already captured, so the address closes the slots.
        const address = await postMessage({ text: '12 Example Street, Yaba, Lagos' });

        assert.equal(address.body.conversation.state, 'CONFIRM');
        assert.match(address.body.replies[0], /2 x Rice 5kg/);
        assert.match(address.body.replies[0], /17,000/);
        assert.match(address.body.replies[0], /Reply YES to place the order or NO to cancel/);

        const confirm = await postMessage({ text: 'yes' });

        assert.equal(confirm.body.conversation.state, 'COMPLETED');
        assert.equal(confirm.body.conversation.status, 'completed');
        assert.match(confirm.body.orderId, /^ORD-\d{8}-\d{4}$/);
        assert.match(confirm.body.replies[0], /pending confirmation/);

        const order = await Order.findOne({ orderId: confirm.body.orderId });
        assert.equal(order.status, 'pending_confirmation');
        assert.equal(order.totalNGN, 17000);
        assert.equal(order.deliveryAddress, '12 Example Street, Yaba, Lagos');
        assert.equal(order.contactPhone, PHONE);
        assert.equal(order.items.length, 1);
        assert.equal(order.items[0].sku, 'RICE-5KG');
        assert.equal(order.items[0].quantity, 2);
        assert.equal(order.items[0].unitPriceNGN, 8500);

        const created = await AuditEvent.findOne({
            type: 'ORDER_CREATED',
            entityId: confirm.body.orderId,
        });
        assert.ok(created, 'ORDER_CREATED audit event written');
        assert.equal(created.correlationId, confirm.body.correlationId);
    });
});

describe('slot-filling failure paths (T-011, failure 3 + workplan 5.2)', () => {
    test('T7: quantity "abc" twice re-prompts, the third miss escalates invalid_data', async () => {
        const start = await postMessage({ text: 'I want to order garri' });

        assert.equal(start.body.conversation.state, 'COLLECT_QTY');
        assert.match(start.body.replies[0], /How many Garri 5kg/);

        const first = await postMessage({ text: 'abc' });
        assert.equal(first.body.conversation.state, 'COLLECT_QTY');
        assert.match(first.body.replies[0], /whole number between 1 and 50/);

        const second = await postMessage({ text: 'what?' });
        assert.equal(second.body.conversation.state, 'COLLECT_QTY');

        const third = await postMessage({ text: 'abc again' });
        assert.equal(third.body.conversation.state, 'ESCALATED');
        assert.equal(third.body.conversation.status, 'escalated');
        assert.match(third.body.replies[0], /passed it to our team as TKT-/);
        assert.match(third.body.ticketId, /^TKT-\d{4}$/);

        const conversation = await Conversation.findById(third.body.conversation.id);
        assert.equal(conversation.retries, 3);

        // Failure 3 escalation: ticket with reason invalid_data (T-013).
        const ticket = await Ticket.findOne({ ticketId: third.body.ticketId });
        assert.ok(ticket);
        assert.equal(ticket.reason, 'invalid_data');
        assert.equal(ticket.priority, 'normal');
        assert.match(ticket.summary, /stopped after 3 unusable answers \(quantity_invalid\)/);
        assert.equal(ticket.notificationStatus, 'sent');

        const failures = await AuditEvent.find({ type: 'VALIDATION_FAILED' }).sort({ createdAt: 1 });
        assert.equal(failures.length, 3);
        assert.equal(failures[0].detail.slot, 'COLLECT_QTY');
        assert.equal(failures[0].detail.reason, 'quantity_invalid');
        assert.equal(failures[2].detail.attempt, 3);
    });

    test('quantity above stock re-prompts with the available count', async () => {
        const start = await postMessage({ text: 'I want to order rice 25kg' });
        assert.equal(start.body.conversation.state, 'COLLECT_QTY');
        assert.match(start.body.replies[0], /How many Rice 25kg/);

        const over = await postMessage({ text: '50' });
        assert.equal(over.body.conversation.state, 'COLLECT_QTY');
        assert.match(over.body.replies[0], /We only have 12 Rice 25kg left/);

        const ok = await postMessage({ text: '12' });
        assert.equal(ok.body.conversation.state, 'COLLECT_ADDRESS');
    });

    test('address answers are validated (min length + area/street checks)', async () => {
        await postMessage({ text: 'I want to order garri' });
        await postMessage({ text: '2' });

        const bad = await postMessage({ text: 'my house' });
        assert.equal(bad.body.conversation.state, 'COLLECT_ADDRESS');
        assert.match(bad.body.replies[0], /does not look like a full delivery address/);

        // Street name + house number passes without an explicit area name.
        const good = await postMessage({ text: 'House 7, Admiralty Way' });
        assert.equal(good.body.conversation.state, 'CONFIRM');
        assert.match(good.body.replies[0], /2 x Garri 5kg/);
    });

    test('CANCEL at any state cancels the order request', async () => {
        await postMessage({ text: 'I want to order garri' });

        const cancelled = await postMessage({ text: 'cancel' });
        assert.equal(cancelled.body.conversation.state, 'CANCELLED');
        assert.equal(cancelled.body.conversation.status, 'completed');
        assert.match(cancelled.body.replies[0], /cancelled this order request/);
    });

    test('HUMAN/AGENT at any state hands off with a ticket', async () => {
        await postMessage({ text: 'I want to order garri' });

        const human = await postMessage({ text: 'can I talk to an agent please' });
        assert.equal(human.body.conversation.state, 'ESCALATED');
        assert.equal(human.body.conversation.status, 'escalated');
        assert.match(human.body.replies[0], /passed this order to our team/);
        assert.match(human.body.ticketId, /^TKT-\d{4}$/);

        const ticket = await Ticket.findOne({ ticketId: human.body.ticketId });
        assert.equal(ticket.reason, 'customer_requested');
        assert.equal(ticket.priority, 'high');
    });

    test('a product with no stock cannot be selected', async () => {
        const start = await postMessage({ text: 'I want to order palm oil' });

        assert.equal(start.body.conversation.state, 'COLLECT_ITEM');
        assert.match(start.body.replies[0], /Palm Oil 1L is currently out of stock/);

        const conversation = await Conversation.findById(start.body.conversation.id);
        assert.equal(conversation.slots.sku, null);
    });
});

describe('slot-filling lazy expiry (T-011, workplan 5.2)', () => {
    test('a conversation idle for 30+ minutes expires and the next message starts fresh', async () => {
        const start = await postMessage({ text: 'I want to order garri' });
        const staleId = start.body.conversation.id;

        await Conversation.findByIdAndUpdate(staleId, {
            lastMessageAt: new Date(Date.now() - 31 * 60 * 1000),
        });

        // The customer comes back after half an hour with a fresh message.
        const res = await postMessage({ text: 'hello again' });

        assert.notEqual(res.body.conversation.id, staleId);
        assert.equal(res.body.conversation.state, 'IDLE');
        assert.equal(res.body.conversation.status, 'active');

        const stale = await Conversation.findById(staleId);
        assert.equal(stale.state, 'EXPIRED');
        assert.equal(stale.status, 'expired');
    });
});
