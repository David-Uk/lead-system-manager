import './helpers/setup-env.mjs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/auditEvent.model.js';
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

/** Seeds one audit event, optionally back-dated to make ordering deterministic. */
async function seedEvent({
    type,
    correlationId = 'corr-audit-1',
    entityType = 'system',
    entityId = null,
    detail = {},
    minutesAgo: ageMinutes = 0,
}) {
    const event = await AuditEvent.create({ type, correlationId, entityType, entityId, detail });
    if (ageMinutes > 0) {
        await AuditEvent.collection.updateOne(
            { _id: event._id },
            { $set: { createdAt: new Date(Date.now() - ageMinutes * 60_000) } },
        );
    }
    return event;
}

async function getAudit(query = '') {
    const res = await request(app).get(`/api/audit${query}`).set('x-api-key', API_KEY);
    assert.equal(res.status, 200, res.text);
    return res.body;
}

describe('GET /api/audit (workplan 8.14, T-015)', () => {
    test('requires the staff api key', async () => {
        const res = await request(app).get('/api/audit');

        assert.equal(res.status, 401);
        assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    test('pages newest-first with an opaque keyset cursor', async () => {
        await seedEvent({ type: 'MESSAGE_RECEIVED', minutesAgo: 5 });
        await seedEvent({ type: 'CLASSIFIED', minutesAgo: 4 });
        await seedEvent({ type: 'REPLY_SENT', minutesAgo: 3 });
        await seedEvent({
            type: 'TICKET_CREATED',
            entityType: 'ticket',
            entityId: 'TKT-0001',
            minutesAgo: 2,
        });
        await seedEvent({
            type: 'NOTIFICATION_SENT',
            entityType: 'ticket',
            entityId: 'TKT-0001',
            minutesAgo: 1,
        });

        const page1 = await getAudit('?limit=3');

        assert.equal(page1.data.length, 3);
        assert.deepEqual(
            page1.data.map((event) => event.type),
            ['NOTIFICATION_SENT', 'TICKET_CREATED', 'REPLY_SENT'],
        );
        assert.ok(page1.nextCursor);
        assert.deepEqual(Object.keys(page1.data[0]).sort(), [
            'actor',
            'correlationId',
            'createdAt',
            'detail',
            'entityId',
            'entityType',
            'type',
        ]);

        const page2 = await getAudit(`?limit=3&cursor=${encodeURIComponent(page1.nextCursor)}`);

        assert.equal(page2.data.length, 2);
        assert.deepEqual(
            page2.data.map((event) => event.type),
            ['CLASSIFIED', 'MESSAGE_RECEIVED'],
        );
        assert.equal(page2.nextCursor, null);
    });

    test('filters by type, entity and correlation id', async () => {
        await seedEvent({ type: 'MESSAGE_RECEIVED', correlationId: 'corr-a' });
        await seedEvent({
            type: 'TICKET_CREATED',
            correlationId: 'corr-a',
            entityType: 'ticket',
            entityId: 'TKT-0001',
            detail: { reason: 'complaint', priority: 'high' },
        });
        await seedEvent({
            type: 'TICKET_UPDATED',
            correlationId: 'corr-b',
            entityType: 'ticket',
            entityId: 'TKT-0001',
        });
        await seedEvent({
            type: 'ORDER_CREATED',
            correlationId: 'corr-c',
            entityType: 'order',
            entityId: 'ORD-1',
        });

        const byType = await getAudit('?type=TICKET_CREATED');
        assert.equal(byType.data.length, 1);
        assert.equal(byType.data[0].correlationId, 'corr-a');

        const byEntityId = await getAudit('?entityId=TKT-0001');
        assert.equal(byEntityId.data.length, 2);

        const byEntityType = await getAudit('?entityType=order');
        assert.equal(byEntityType.data.length, 1);
        assert.equal(byEntityType.data[0].entityId, 'ORD-1');

        const byCorrelation = await getAudit('?correlationId=corr-a');
        assert.equal(byCorrelation.data.length, 2);

        const combined = await getAudit('?type=TICKET_CREATED&correlationId=corr-a');
        assert.equal(combined.data.length, 1);

        const empty = await getAudit('?type=WEBHOOK_REJECTED');
        assert.deepEqual(empty.data, []);
        assert.equal(empty.nextCursor, null);
    });

    test('bounds the trail with from/to', async () => {
        await seedEvent({ type: 'MESSAGE_RECEIVED', minutesAgo: 60 });
        await seedEvent({ type: 'REPLY_SENT', minutesAgo: 10 });

        const from = new Date(Date.now() - 30 * 60_000).toISOString();
        const bounded = await getAudit(`?from=${encodeURIComponent(from)}`);

        assert.deepEqual(
            bounded.data.map((event) => event.type),
            ['REPLY_SENT'],
        );
    });

    test('validates query parameters and cursors', async () => {
        const cases = [
            '?type=NOPE',
            '?limit=201',
            '?limit=0',
            '?cursor=not-a-cursor',
            '?from=2030-01-02&to=2030-01-01',
        ];

        for (const query of cases) {
            const res = await request(app).get(`/api/audit${query}`).set('x-api-key', API_KEY);

            assert.equal(res.status, 400, query);
            assert.equal(res.body.error.code, 'VALIDATION_ERROR');
        }
    });
});
