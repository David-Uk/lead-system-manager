import './helpers/setup-env.mjs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';

const execFileAsync = promisify(execFile);
const prodChildScript = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'helpers',
    'run-simulate-prod.mjs',
);

const app = createApp();
const API_KEY = 'test-staff-key';

let mongod;

before(async () => {
    mongod = await startTestDb();
});

after(async () => {
    await stopTestDb(mongod);
});

const validRequest = {
    from: '+2348012345678',
    name: 'Test Customer',
    text: 'I want to buy 2 bags of rice',
    messageId: 'sim-0001',
};

describe('POST /simulate/message (workplan 8.3)', () => {
    test('requires the staff api key', async () => {
        const res = await request(app).post('/simulate/message').send(validRequest);

        assert.equal(res.status, 401);
        assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    test('rejects a non-Nigerian phone number with 400 details', async () => {
        const res = await request(app)
            .post('/simulate/message')
            .set('x-api-key', API_KEY)
            .send({ ...validRequest, from: '+447700900123' });

        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
        assert.equal(res.body.error.details[0].path, 'from');
    });

    test('rejects empty text with 400', async () => {
        const res = await request(app)
            .post('/simulate/message')
            .set('x-api-key', API_KEY)
            .send({ ...validRequest, text: '' });

        assert.equal(res.status, 400);
        assert.ok(res.body.error.details.some((detail) => detail.path === 'text'));
    });

    test('returns the pipeline result shape with a valid request', async () => {
        const res = await request(app)
            .post('/simulate/message')
            .set('x-api-key', API_KEY)
            .send(validRequest);

        assert.equal(res.status, 200);
        assert.equal(typeof res.body.correlationId, 'string');
        assert.equal(res.headers['x-correlation-id'], res.body.correlationId);

        // T-006..T-012 walk the message end to end: rules classify the
        // purchase intent and the slot-filling machine starts collecting
        // (no catalogue is seeded here, so it asks for the product).
        assert.deepEqual(Object.keys(res.body).sort(), [
            'classifierSource',
            'confidence',
            'conversation',
            'correlationId',
            'duplicate',
            'intent',
            'orderId',
            'replies',
            'ticketId',
        ]);
        assert.equal(res.body.duplicate, false);
        assert.equal(res.body.intent, 'place_order');
        assert.equal(res.body.classifierSource, 'rules');
        assert.ok(res.body.confidence >= 0.7);
        assert.equal(res.body.replies.length, 1);
        assert.match(res.body.replies[0], /Great! Which product would you like/);
        assert.equal(typeof res.body.conversation.id, 'string');
        assert.equal(res.body.conversation.state, 'COLLECT_ITEM');
        assert.equal(res.body.conversation.status, 'active');
        assert.equal(res.body.ticketId, null);
        assert.equal(res.body.orderId, null);
    });

    test('auto-generates a messageId when omitted', async () => {
        const { messageId: _unused, ...withoutId } = validRequest;

        const res = await request(app)
            .post('/simulate/message')
            .set('x-api-key', API_KEY)
            .send(withoutId);

        assert.equal(res.status, 200);
    });

    test('is disabled in production', async () => {
        const { stdout } = await execFileAsync(process.execPath, [prodChildScript], {
            env: {
                ...process.env,
                NODE_ENV: 'production',
                STAFF_API_KEY: 'prod-test-staff-key',
                WHATSAPP_VERIFY_TOKEN: 'prod-test-verify-token',
                WHATSAPP_APP_SECRET: 'prod-test-app-secret',
            },
            timeout: 30_000,
        });

        const lines = stdout.trim().split(/\r?\n/);
        const { status, body } = JSON.parse(lines.at(-1));

        assert.equal(status, 404);
        assert.equal(body.error.code, 'NOT_FOUND');
    });
});
