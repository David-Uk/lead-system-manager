import './helpers/setup-env.mjs';
import { createHash } from 'node:crypto';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { Message } from '../src/models/message.model.js';
import { SandboxKey } from '../src/models/sandboxKey.model.js';
import { Ticket } from '../src/models/ticket.model.js';
import { isSimulateBlocked } from '../src/routes/simulate.routes.js';
import { clearDb, startTestDb, stopTestDb } from './helpers/testDb.js';

/**
 * Sandbox simulation (T-021): keys minted through POST /simulate/keys run
 * the full API - pipeline, tickets, audit, metrics - against an isolated
 * dataset that never mixes with live data.
 */

const app = createApp();
const STAFF_KEY = 'test-staff-key';

let mongod;

before(async () => {
    mongod = await startTestDb();
});

after(async () => {
    await stopTestDb(mongod);
});

beforeEach(clearDb);

/** Mints a fresh sandbox key through the public endpoint. */
async function mintKey() {
    const res = await request(app).post('/simulate/keys').send({});
    assert.equal(res.status, 201);
    return res.body;
}

const complaint = {
    from: '+2348011112222',
    name: 'Sandbox Customer',
    text: 'My last order arrived damaged, I want a refund',
    messageId: 'sandbox-complaint-1',
};

describe('POST /simulate/keys', () => {
    test('returns the key once and stores only its hash', async () => {
        const res = await request(app).post('/simulate/keys').send({});

        assert.equal(res.status, 201);
        const { apiKey, keyPrefix, sandboxId, expiresAt, note } = res.body;

        assert.match(apiKey, /^lfm_sim_[A-Za-z0-9_-]{32}$/);
        assert.ok(apiKey.startsWith(keyPrefix));
        assert.match(sandboxId, /^[0-9a-f-]{36}$/);
        assert.ok(new Date(expiresAt) > new Date());
        assert.equal(typeof note, 'string');

        const stored = await SandboxKey.findOne({ sandboxId }).lean();
        assert.equal(stored.keyHash, createHash('sha256').update(apiKey).digest('hex'));
        assert.notEqual(stored.keyHash, apiKey);
        assert.match(stored.keyHash, /^[0-9a-f]{64}$/);
        assert.equal(stored.keyPrefix, keyPrefix);
        assert.equal(stored.uses, 0);
    });
});

describe('a sandbox key drives the full API against isolated data', () => {
    test('complaints escalate to a sandbox ticket that live staff never sees', async () => {
        const key = await mintKey();

        const sim = await request(app)
            .post('/simulate/message')
            .set('x-api-key', key.apiKey)
            .send(complaint);

        assert.equal(sim.status, 200);
        assert.equal(sim.body.intent, 'complaint_or_refund');
        assert.match(sim.body.ticketId, /^TKT-\d{4}$/);

        // The sandbox reads its own ticket and list...
        const sandboxGet = await request(app)
            .get(`/api/tickets/${sim.body.ticketId}`)
            .set('x-api-key', key.apiKey);
        assert.equal(sandboxGet.status, 200);
        assert.equal(sandboxGet.body.ticketId, sim.body.ticketId);
        assert.equal(sandboxGet.body.reason, 'refund');
        assert.equal(sandboxGet.body.customer.phone, complaint.from);

        const sandboxList = await request(app).get('/api/tickets').set('x-api-key', key.apiKey);
        assert.equal(sandboxList.status, 200);
        assert.equal(sandboxList.body.total, 1);

        // ...while the live staff key sees none of it.
        const staffGet = await request(app)
            .get(`/api/tickets/${sim.body.ticketId}`)
            .set('x-api-key', STAFF_KEY);
        assert.equal(staffGet.status, 404);
        assert.equal(staffGet.body.error.code, 'NOT_FOUND');

        const staffList = await request(app).get('/api/tickets').set('x-api-key', STAFF_KEY);
        assert.equal(staffList.body.total, 0);

        // Audit trail follows the same scope.
        const sandboxAudit = await request(app)
            .get('/api/audit')
            .query({ correlationId: sim.body.correlationId })
            .set('x-api-key', key.apiKey);
        assert.equal(sandboxAudit.status, 200);
        assert.ok(sandboxAudit.body.data.length > 0);
        assert.ok(sandboxAudit.body.data.some((event) => event.type === 'TICKET_CREATED'));

        const staffAudit = await request(app)
            .get('/api/audit')
            .query({ correlationId: sim.body.correlationId })
            .set('x-api-key', STAFF_KEY);
        assert.equal(staffAudit.status, 200);
        assert.equal(staffAudit.body.data.length, 0);

        // Documents are tagged with the sandbox id and expire with the key
        // (plus grace), so live queries and TTL cleanup can tell them apart.
        const message = await Message.findOne({
            providerMessageId: complaint.messageId,
            sandbox: key.sandboxId,
        });
        assert.ok(message, 'sandbox message is tagged with the sandbox id');
        assert.ok(message.sandboxExpiresAt > new Date());
        assert.equal(await Message.findOne({ providerMessageId: complaint.messageId }), null);

        const ticket = await Ticket.findOne({ ticketId: sim.body.ticketId, sandbox: key.sandboxId });
        assert.ok(ticket, 'sandbox ticket is tagged with the sandbox id');

        // Usage telemetry is best effort but should be recorded.
        const used = await SandboxKey.findOne({ sandboxId: key.sandboxId }).lean();
        assert.ok(used.uses >= 1);
        assert.ok(used.lastUsedAt);
    });

    test('two sandboxes cannot see each other', async () => {
        const keyA = await mintKey();
        const keyB = await mintKey();

        const sim = await request(app)
            .post('/simulate/message')
            .set('x-api-key', keyA.apiKey)
            .send({ ...complaint, from: '+2348055556666', messageId: 'iso-a-1' });
        assert.equal(sim.status, 200);

        const listB = await request(app).get('/api/tickets').set('x-api-key', keyB.apiKey);
        assert.equal(listB.body.total, 0);

        const auditB = await request(app).get('/api/audit').set('x-api-key', keyB.apiKey);
        assert.equal(auditB.body.data.length, 0);

        const listA = await request(app).get('/api/tickets').set('x-api-key', keyA.apiKey);
        assert.equal(listA.body.total, 1);
    });

    test('the same messageId is deduped per scope only', async () => {
        const key = await mintKey();
        const payload = {
            from: '+2348077778888',
            text: 'I want to buy 2 bags of rice',
            messageId: 'shared-message-id',
        };

        const first = await request(app)
            .post('/simulate/message')
            .set('x-api-key', key.apiKey)
            .send(payload);
        assert.equal(first.status, 200);
        assert.equal(first.body.duplicate, false);

        const retry = await request(app)
            .post('/simulate/message')
            .set('x-api-key', key.apiKey)
            .send(payload);
        assert.equal(retry.body.duplicate, true);

        // The live scope has never seen this messageId...
        const live = await request(app)
            .post('/simulate/message')
            .set('x-api-key', STAFF_KEY)
            .send(payload);
        assert.equal(live.status, 200);
        assert.equal(live.body.duplicate, false);

        const liveRetry = await request(app)
            .post('/simulate/message')
            .set('x-api-key', STAFF_KEY)
            .send(payload);
        assert.equal(liveRetry.body.duplicate, true);

        // ...and neither retry disturbed the sandbox dedupe state.
        const sandboxRetry = await request(app)
            .post('/simulate/message')
            .set('x-api-key', key.apiKey)
            .send(payload);
        assert.equal(sandboxRetry.body.duplicate, true);
    });

    test('an expired sandbox key is rejected with 401', async () => {
        const key = await mintKey();
        await SandboxKey.updateOne(
            { sandboxId: key.sandboxId },
            { $set: { expiresAt: new Date(Date.now() - 60_000) } },
        );

        const res = await request(app)
            .post('/simulate/message')
            .set('x-api-key', key.apiKey)
            .send({ from: '+2348033334444', text: 'How much is rice?' });

        assert.equal(res.status, 401);
        assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    test('a sandbox key cannot read live documents', async () => {
        // Created outside any sandbox scope, exactly like real traffic would.
        await Ticket.create({
            ticketId: 'TKT-9001',
            reason: 'complaint',
            summary: 'live escalation',
        });

        const key = await mintKey();

        const sandboxGet = await request(app)
            .get('/api/tickets/TKT-9001')
            .set('x-api-key', key.apiKey);
        assert.equal(sandboxGet.status, 404);

        const staffGet = await request(app)
            .get('/api/tickets/TKT-9001')
            .set('x-api-key', STAFF_KEY);
        assert.equal(staffGet.status, 200);
        assert.equal(staffGet.body.ticketId, 'TKT-9001');
    });

    test('metrics reflect the calling scope only', async () => {
        const key = await mintKey();

        const sim = await request(app)
            .post('/simulate/message')
            .set('x-api-key', key.apiKey)
            .send({ from: '+2348099990000', text: 'How much is 5kg rice?', messageId: 'metrics-1' });
        assert.equal(sim.status, 200);
        assert.equal(sim.body.intent, 'price_check');

        const sandboxMetrics = await request(app).get('/api/metrics').set('x-api-key', key.apiKey);
        assert.equal(sandboxMetrics.status, 200);
        assert.ok(sandboxMetrics.body.totalMessages >= 2);
        assert.ok(sandboxMetrics.body.intentBreakdown.price_check >= 1);

        const liveMetrics = await request(app).get('/api/metrics').set('x-api-key', STAFF_KEY);
        assert.equal(liveMetrics.status, 200);
        assert.equal(liveMetrics.body.totalMessages, 0);
        assert.equal(liveMetrics.body.totalConversations, 0);
        assert.equal(liveMetrics.body.intentBreakdown.price_check, 0);
    });
});

describe('isSimulateBlocked (production posture)', () => {
    test('blocks the live key in production but lets sandbox keys through', () => {
        assert.equal(isSimulateBlocked({ nodeEnv: 'production', authMode: 'live' }), true);
        assert.equal(isSimulateBlocked({ nodeEnv: 'production', authMode: null }), true);
        assert.equal(isSimulateBlocked({ nodeEnv: 'production', authMode: 'sandbox' }), false);
        assert.equal(isSimulateBlocked({ nodeEnv: 'test', authMode: 'live' }), false);
        assert.equal(isSimulateBlocked({ nodeEnv: 'development', authMode: 'live' }), false);
    });
});
