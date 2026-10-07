import './helpers/setup-env.mjs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Customer } from '../src/models/customer.model.js';
import { Order } from '../src/models/order.model.js';
import { Ticket } from '../src/models/ticket.model.js';
import { processInboundMessage } from '../src/services/pipeline.service.js';
import { clearDb, startTestDb, stopTestDb } from './helpers/testDb.js';

const app = createApp();
const API_KEY = 'test-staff-key';

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

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000);

function inbound(messageId, phone, text) {
    return {
        providerMessageId: messageId,
        phoneRaw: phone,
        phone,
        name: 'Test Customer',
        type: 'text',
        text,
        timestamp: null,
    };
}

async function getMetrics(query = '') {
    const res = await request(app).get(`/api/metrics${query}`).set('x-api-key', API_KEY);
    assert.equal(res.status, 200, res.text);
    return res.body;
}

describe('GET /api/metrics (workplan 8.15, T-015)', () => {
    test('requires the staff api key', async () => {
        const res = await request(app).get('/api/metrics');

        assert.equal(res.status, 401);
        assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    test('reports window figures computed from real pipeline activity', async () => {
        // One complaint (escalates: ticket + staff notification) and one clean
        // price question -> 2 conversations, 4 stored messages (2 in, 2 out).
        await processInboundMessage({
            message: inbound(
                'sim-metrics-1',
                '+2348011111111',
                'The rice I bought was stale, I want a refund',
            ),
            correlationId: 'corr-metrics-1',
            source: 'simulate',
        });
        await processInboundMessage({
            message: inbound('sim-metrics-2', '+2348022222222', 'How much is 5kg rice?'),
            correlationId: 'corr-metrics-2',
            source: 'simulate',
        });

        const customer = await Customer.findOne({ phone: '+2348022222222' });
        await Order.create({
            orderId: 'ORD-20261007-0001',
            customerId: customer._id,
            items: [{ sku: 'RICE-5KG', name: 'Rice 5kg', quantity: 1, unitPriceNGN: 8500 }],
            totalNGN: 8500,
            deliveryAddress: '12 Example Street, Yaba',
            contactPhone: '+2348022222222',
        });

        const body = await getMetrics();

        assert.equal(body.totalMessages, 4);
        assert.equal(body.totalConversations, 2);
        assert.deepEqual(Object.keys(body.intentBreakdown).sort(), [
            'complaint_or_refund',
            'order_status',
            'place_order',
            'price_check',
            'product_enquiry',
            'unknown',
        ]);
        assert.equal(body.intentBreakdown.price_check, 1);
        assert.equal(body.intentBreakdown.complaint_or_refund, 1);
        assert.equal(body.intentBreakdown.place_order, 0);
        assert.equal(body.intentBreakdown.product_enquiry, 0);
        assert.equal(body.intentBreakdown.order_status, 0);
        assert.equal(body.intentBreakdown.unknown, 0);
        assert.equal(body.classifier.rules, 2);
        assert.equal(body.classifier.llm, 0);
        assert.equal(body.classifier.fallback, body.failures.llmFailures);
        assert.equal(body.ordersCreated, 1);
        assert.equal(body.escalationRate, 0.5);
        assert.deepEqual(body.tickets, {
            open: 1,
            assigned: 0,
            in_progress: 0,
            resolved: 0,
            closed: 0,
            overdue: 0,
        });
        assert.equal(body.unresolvedConversations, 1);
        assert.ok(Number.isInteger(body.avgAutoResponseMs));
        assert.ok(body.avgAutoResponseMs >= 0);
        assert.equal(body.avgFirstHumanResponseMin, 0);
        assert.deepEqual(Object.keys(body.failures).sort(), [
            'duplicatesIgnored',
            'llmFailures',
            'notificationFailures',
            'validationRetries',
        ]);
        assert.ok(body.failures.notificationFailures === 0); // staff alert went out
        assert.ok(body.period.from);
        assert.ok(body.period.to);
    });

    test('derives the SLA backlog and the first human response average (T-015)', async () => {
        const overdue = await Ticket.create({
            ticketId: 'TKT-0001',
            reason: 'complaint',
            summary: 'past the SLA',
        });
        await Ticket.collection.updateOne(
            { _id: overdue._id },
            { $set: { createdAt: minutesAgo(30) } },
        );

        const answered = await Ticket.create({
            ticketId: 'TKT-0002',
            reason: 'ai_unavailable',
            status: 'assigned',
            summary: 'answered',
        });
        await Ticket.collection.updateOne(
            { _id: answered._id },
            { $set: { createdAt: minutesAgo(25), firstResponseAt: minutesAgo(10) } },
        );

        await Ticket.create({ ticketId: 'TKT-0003', reason: 'unknown_intent', summary: 'fresh' });

        const body = await getMetrics();

        assert.equal(body.tickets.open, 2); // TKT-0001 + TKT-0003
        assert.equal(body.tickets.assigned, 1);
        assert.equal(body.tickets.overdue, 1); // only TKT-0001, past the 15 min SLA
        assert.equal(body.avgFirstHumanResponseMin, 15); // -25 min -> -10 min
        assert.equal(body.escalationRate, 0); // no conversations in the window
    });

    test('scopes windowed figures to from/to but keeps the backlog snapshot live', async () => {
        await processInboundMessage({
            message: inbound('sim-metrics-3', '+2348033333333', 'How much is 5kg rice?'),
            correlationId: 'corr-metrics-3',
            source: 'simulate',
        });
        await Ticket.create({ ticketId: 'TKT-0001', reason: 'complaint', summary: 'backlog' });

        const body = await getMetrics(
            '?from=2030-01-01T00:00:00.000Z&to=2030-01-02T00:00:00.000Z',
        );

        assert.equal(body.totalMessages, 0);
        assert.equal(body.totalConversations, 0);
        assert.equal(body.ordersCreated, 0);
        assert.equal(body.escalationRate, 0);
        assert.equal(body.tickets.open, 1); // live snapshot, not windowed
        assert.equal(body.unresolvedConversations, 1);
    });

    test('validates the period query', async () => {
        const backwards = await request(app)
            .get('/api/metrics?from=2030-01-02&to=2030-01-01')
            .set('x-api-key', API_KEY);
        assert.equal(backwards.status, 400);
        assert.equal(backwards.body.error.code, 'VALIDATION_ERROR');

        const garbage = await request(app)
            .get('/api/metrics?from=not-a-date')
            .set('x-api-key', API_KEY);
        assert.equal(garbage.status, 400);
        assert.equal(garbage.body.error.code, 'VALIDATION_ERROR');
    });
});
