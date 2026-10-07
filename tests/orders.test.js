import './helpers/setup-env.mjs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/auditEvent.model.js';
import { Order } from '../src/models/order.model.js';
import { clearDb, startTestDb, stopTestDb } from './helpers/testDb.js';

/**
 * Staff order API (T-012, workplan 8.6-8.8): listing with filters and
 * pagination, single lookup, and the enforced status transition table.
 */

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

function seedOrder(overrides = {}) {
    return Order.create({
        orderId: 'ORD-20261001-0001',
        customerId: new mongoose.Types.ObjectId(),
        items: [{ sku: 'RICE-5KG', name: 'Rice 5kg', quantity: 2, unitPriceNGN: 8500 }],
        totalNGN: 17000,
        deliveryAddress: '12 Example Street, Yaba, Lagos',
        contactPhone: '+2348012345678',
        status: 'pending_confirmation',
        createdAt: new Date('2026-10-01T08:00:00Z'),
        updatedAt: new Date('2026-10-01T08:00:00Z'),
        ...overrides,
    });
}

const get = (path) => request(app).get(path).set('x-api-key', API_KEY);
const patch = (path, body) => request(app).patch(path).set('x-api-key', API_KEY).send(body);

describe('GET /api/orders (workplan 8.6)', () => {
    test('requires the staff api key', async () => {
        const res = await request(app).get('/api/orders');

        assert.equal(res.status, 401);
        assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    test('lists orders newest first with pagination metadata', async () => {
        await seedOrder({ orderId: 'ORD-20261001-0001' });
        await seedOrder({
            orderId: 'ORD-20261002-0001',
            status: 'confirmed',
            contactPhone: '+2348099999999',
            createdAt: new Date('2026-10-02T08:00:00Z'),
        });

        const res = await get('/api/orders?limit=1');

        assert.equal(res.status, 200);
        assert.equal(typeof res.headers['x-correlation-id'], 'string');
        assert.equal(res.body.total, 2);
        assert.equal(res.body.page, 1);
        assert.equal(res.body.limit, 1);
        assert.equal(res.body.data.length, 1);
        assert.equal(res.body.data[0].orderId, 'ORD-20261002-0001');
        assert.deepEqual(res.body.data[0].items[0], {
            sku: 'RICE-5KG',
            name: 'Rice 5kg',
            quantity: 2,
            unitPriceNGN: 8500,
        });

        const page2 = await get('/api/orders?limit=1&page=2');
        assert.equal(page2.body.data[0].orderId, 'ORD-20261001-0001');
    });

    test('filters by status, normalised phone and date range', async () => {
        await seedOrder({ orderId: 'ORD-20261001-0001' }); // pending, 2026-10-01
        await seedOrder({
            orderId: 'ORD-20261002-0001',
            status: 'confirmed',
            contactPhone: '+2348099999999',
            createdAt: new Date('2026-10-02T08:00:00Z'),
        });

        const byStatus = await get('/api/orders?status=confirmed');
        assert.equal(byStatus.body.total, 1);
        assert.equal(byStatus.body.data[0].orderId, 'ORD-20261002-0001');

        const byPhone = await get('/api/orders?phone=08012345678');
        assert.equal(byPhone.body.total, 1);
        assert.equal(byPhone.body.data[0].orderId, 'ORD-20261001-0001');

        const byDate = await get('/api/orders?from=2026-10-02T00:00:00Z');
        assert.equal(byDate.body.total, 1);
        assert.equal(byDate.body.data[0].orderId, 'ORD-20261002-0001');
    });

    test('rejects an unknown status filter with validation details', async () => {
        const res = await get('/api/orders?status=flying');

        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
        assert.equal(res.body.error.details[0].path, 'status');
    });
});

describe('GET and PATCH /api/orders/:orderId (workplan 8.7-8.8)', () => {
    test('fetches a single order by reference, case-insensitively', async () => {
        await seedOrder();

        const res = await get('/api/orders/ord-20261001-0001');

        assert.equal(res.status, 200);
        assert.equal(res.body.orderId, 'ORD-20261001-0001');
        assert.equal(res.body.status, 'pending_confirmation');
        assert.equal(res.body.deliveryAddress, '12 Example Street, Yaba, Lagos');
    });

    test('unknown reference returns 404', async () => {
        const res = await get('/api/orders/ORD-20261001-9999');

        assert.equal(res.status, 404);
        assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    test('walks a legal transition and writes the ORDER_UPDATED audit', async () => {
        await seedOrder();

        const res = await patch('/api/orders/ORD-20261001-0001', {
            status: 'confirmed',
            note: 'Called the customer to confirm',
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'confirmed');

        const stored = await Order.findOne({ orderId: 'ORD-20261001-0001' });
        assert.equal(stored.status, 'confirmed');

        const event = await AuditEvent.findOne({
            type: 'ORDER_UPDATED',
            entityId: 'ORD-20261001-0001',
        });
        assert.ok(event, 'ORDER_UPDATED audit event written');
        assert.equal(event.detail.from, 'pending_confirmation');
        assert.equal(event.detail.to, 'confirmed');
        assert.equal(event.detail.note, 'Called the customer to confirm');
        assert.equal(event.detail.via, 'staff_api');
        assert.equal(event.correlationId, res.headers['x-correlation-id']);
    });

    test('rejects a transition the lifecycle does not allow', async () => {
        await seedOrder({ status: 'delivered' });

        const res = await patch('/api/orders/ORD-20261001-0001', { status: 'pending_confirmation' });

        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
        assert.match(res.body.error.message, /delivered to pending_confirmation/);

        const stored = await Order.findOne({ orderId: 'ORD-20261001-0001' });
        assert.equal(stored.status, 'delivered');
    });

    test('a repeated status is an idempotent no-op without an audit event', async () => {
        await seedOrder({ status: 'confirmed' });

        const res = await patch('/api/orders/ORD-20261001-0001', { status: 'confirmed' });

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'confirmed');
        assert.equal(await AuditEvent.countDocuments({ type: 'ORDER_UPDATED' }), 0);
    });

    test('validates the request body', async () => {
        await seedOrder();

        const badStatus = await patch('/api/orders/ORD-20261001-0001', { status: 'flying' });
        assert.equal(badStatus.status, 400);
        assert.equal(badStatus.body.error.details[0].path, 'status');

        const empty = await patch('/api/orders/ORD-20261001-0001', {});
        assert.equal(empty.status, 400);
    });
});
