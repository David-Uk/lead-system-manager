import './helpers/setup-env.mjs';
import { createHmac } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/auditEvent.model.js';
import { Message } from '../src/models/message.model.js';
import { clearDb, startTestDb, stopTestDb } from './helpers/testDb.js';

const app = createApp();
const VERIFY_TOKEN = 'test-verify-token';
const APP_SECRET = 'test-app-secret';

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

function sign(body, secret = APP_SECRET) {
    return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/** Polls until `check` passes; webhook processing is fire-and-forget after the 200. */
async function waitFor(check, { timeoutMs = 8000, intervalMs = 25 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await check()) return true;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return false;
}

function samplePayload({ id = 'wamid.TEST0001', text = 'How much is a bag of rice?' } = {}) {
    return {
        object: 'whatsapp_business_account',
        entry: [
            {
                id: 'WABA_ID',
                changes: [
                    {
                        field: 'messages',
                        value: {
                            messaging_product: 'whatsapp',
                            contacts: [{ profile: { name: 'Test Customer' }, wa_id: '2348012345678' }],
                            messages: [
                                {
                                    from: '2348012345678',
                                    id,
                                    timestamp: '1791360000',
                                    type: 'text',
                                    text: { body: text },
                                },
                            ],
                        },
                    },
                ],
            },
        ],
    };
}

describe('GET /webhook handshake (workplan 8.1)', () => {
    test('echoes the challenge when the verify token matches', async () => {
        const res = await request(app).get('/webhook').query({
            'hub.mode': 'subscribe',
            'hub.verify_token': VERIFY_TOKEN,
            'hub.challenge': 'abc123',
        });

        assert.equal(res.status, 200);
        assert.equal(res.text, 'abc123');
    });

    test('returns 403 when the verify token is wrong', async () => {
        const res = await request(app).get('/webhook').query({
            'hub.mode': 'subscribe',
            'hub.verify_token': 'not-the-token',
            'hub.challenge': 'abc123',
        });

        assert.equal(res.status, 403);
        assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });
});

describe('POST /webhook (workplan 8.2)', () => {
    test('accepts a valid signed payload, answers 200 and processes it (T-006..T-008)', async () => {
        const body = JSON.stringify(samplePayload());

        const res = await request(app)
            .post('/webhook')
            .set('content-type', 'application/json')
            .set('x-hub-signature-256', sign(body))
            .send(body);

        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { status: 'received' });

        // Processing continues after the 200; REPLY_SENT is the last DB
        // write of the pipeline, so waiting for it drains the background job.
        const processed = await waitFor(async () =>
            (await AuditEvent.countDocuments({ type: 'REPLY_SENT' })) === 1);
        assert.ok(processed, 'expected the background pipeline to send a reply');

        const received = await AuditEvent.findOne({ type: 'MESSAGE_RECEIVED' });
        assert.ok(received);
        assert.equal(received.entityId, 'wamid.TEST0001');
        assert.equal(received.actor, 'customer');
        assert.equal(received.correlationId, res.headers['x-correlation-id']);

        const classified = await AuditEvent.findOne({ type: 'CLASSIFIED' });
        assert.equal(classified.detail.intent, 'price_check');
        assert.equal(classified.detail.source, 'rules');
    });

    test('a non-text message gets a polite text-only reply (workplan 8.2)', async () => {
        const payload = samplePayload();
        const message = payload.entry[0].changes[0].value.messages[0];
        delete message.text;
        message.type = 'image';
        message.image = { id: 'media-1', mime_type: 'image/jpeg' };
        const body = JSON.stringify(payload);

        const res = await request(app)
            .post('/webhook')
            .set('content-type', 'application/json')
            .set('x-hub-signature-256', sign(body))
            .send(body);

        assert.equal(res.status, 200);

        const processed = await waitFor(async () =>
            (await AuditEvent.countDocuments({ type: 'REPLY_SENT' })) === 1);
        assert.ok(processed, 'expected the text-only reply to be sent');

        const reply = await AuditEvent.findOne({ type: 'REPLY_SENT' });
        assert.equal(reply.detail.intent, null);

        const outbound = await Message.findOne({ direction: 'outbound' });
        assert.match(outbound.text, /only read text messages/);
    });

    test('rejects a wrong signature with 401 and audits WEBHOOK_REJECTED (T9)', async () => {
        const body = JSON.stringify(samplePayload());

        const res = await request(app)
            .post('/webhook')
            .set('content-type', 'application/json')
            .set('x-hub-signature-256', sign(body, 'wrong-secret'))
            .send(body);

        assert.equal(res.status, 401);
        assert.equal(res.body.error.code, 'UNAUTHORIZED');

        const audit = await AuditEvent.findOne({ type: 'WEBHOOK_REJECTED' });
        assert.ok(audit);
        assert.equal(audit.correlationId, res.body.correlationId);
        assert.equal(audit.detail.reason, 'invalid_signature');
    });

    test('rejects a missing signature header with 401', async () => {
        const body = JSON.stringify(samplePayload());

        const res = await request(app)
            .post('/webhook')
            .set('content-type', 'application/json')
            .send(body);

        assert.equal(res.status, 401);

        const audit = await AuditEvent.findOne({ type: 'WEBHOOK_REJECTED' });
        assert.ok(audit);
        assert.equal(audit.detail.reason, 'missing_signature_header');
    });

    test('rejects an invalid payload shape with 400 and audits PAYLOAD_INVALID', async () => {
        const body = JSON.stringify({ object: 'page', entry: [] });

        const res = await request(app)
            .post('/webhook')
            .set('content-type', 'application/json')
            .set('x-hub-signature-256', sign(body))
            .send(body);

        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
        assert.ok(res.body.error.details.length > 0);

        const audit = await AuditEvent.findOne({ type: 'PAYLOAD_INVALID' });
        assert.ok(audit);
        assert.equal(audit.correlationId, res.body.correlationId);
    });

    test('accepts status-only callbacks (delivery receipts) with 200', async () => {
        const payload = samplePayload();
        const value = payload.entry[0].changes[0].value;
        delete value.messages;
        value.statuses = [{ id: 'wamid.TEST0001', status: 'delivered' }];
        const body = JSON.stringify(payload);

        const res = await request(app)
            .post('/webhook')
            .set('content-type', 'application/json')
            .set('x-hub-signature-256', sign(body))
            .send(body);

        assert.equal(res.status, 200);
        assert.deepEqual(res.body, { status: 'received' });
        assert.equal(await AuditEvent.countDocuments(), 0);
    });
});
