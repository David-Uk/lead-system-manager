import './helpers/setup-env.mjs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/auditEvent.model.js';
import { Conversation } from '../src/models/conversation.model.js';
import { Message } from '../src/models/message.model.js';
import { Product } from '../src/models/product.model.js';
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
    await Product.create({
        sku: 'RICE-5KG',
        name: 'Rice 5kg',
        aliases: ['rice', 'bag of rice', 'ofada rice'],
        category: 'Grains',
        priceNGN: 8500,
        stock: 40,
        active: true,
    });
});

function postMessage(payload) {
    return request(app).post('/simulate/message').set('x-api-key', API_KEY).send(payload);
}

describe('pipeline lifecycle and audit trail (T-008)', () => {
    test('a price question walks steps 4-9 and leaves the full audit chain', async () => {
        const res = await postMessage({
            from: '+2348012345678',
            name: 'Ada',
            text: 'How much is 5kg rice?',
            messageId: 'sim-life-1',
        });

        assert.equal(res.status, 200);
        const body = res.body;
        assert.equal(body.duplicate, false);
        assert.equal(body.intent, 'price_check');
        assert.equal(body.classifierSource, 'rules');
        assert.ok(body.confidence >= 0.7);
        assert.equal(body.replies.length, 1);
        assert.match(body.replies[0], /Rice 5kg costs/);
        assert.match(body.replies[0], /8,500/);
        assert.equal(body.conversation.status, 'active');
        assert.equal(body.conversation.state, 'IDLE');
        assert.equal(body.ticketId, null);
        assert.equal(body.orderId, null);

        // Audit chain for this correlation id, in write order.
        const events = await AuditEvent.find({ correlationId: body.correlationId }).sort({
            createdAt: 1,
        });
        assert.deepEqual(
            events.map((event) => event.type),
            ['MESSAGE_RECEIVED', 'CLASSIFIED', 'REPLY_SENT'],
        );

        const [received, classified, replySent] = events;
        assert.equal(received.entityType, 'message');
        assert.equal(received.entityId, 'sim-life-1');
        assert.equal(received.actor, 'customer');
        assert.equal(received.detail.phone, '+234801***78'); // masked, never raw PII
        assert.equal(received.detail.channel, 'simulate');
        assert.equal(received.detail.conversationId, body.conversation.id);

        assert.equal(classified.detail.intent, 'price_check');
        assert.equal(classified.detail.source, 'rules');
        assert.deepEqual(classified.detail.entities, {
            productQuery: 'Rice 5kg',
            quantity: null,
            orderId: null,
        });

        assert.equal(replySent.detail.intent, 'price_check');
        assert.equal(replySent.detail.chars, body.replies[0].length);
        assert.ok(replySent.entityId.startsWith('sim-out-'));

        // Stored rows match the response.
        const conversation = await Conversation.findById(body.conversation.id);
        assert.equal(conversation.currentIntent, 'price_check');
        assert.equal(conversation.clarifyAttempts, 0);

        const inboundMessage = await Message.findOne({ providerMessageId: 'sim-life-1' });
        assert.equal(inboundMessage.direction, 'inbound');
        assert.equal(inboundMessage.intent, 'price_check');
        assert.equal(inboundMessage.classifierSource, 'rules');
        assert.ok(inboundMessage.confidence >= 0.7);

        const outboundMessage = await Message.findOne({ direction: 'outbound' });
        assert.equal(outboundMessage.text, body.replies[0]);
    });

    test('an AI outage is audited as CLASSIFIER_FALLBACK and the customer still gets a reply', async () => {
        const res = await postMessage({
            from: '+2348012345678',
            text: 'hmm okay then',
            messageId: 'sim-fallback-1',
            forceLlmFailure: true,
        });

        assert.equal(res.status, 200);
        assert.equal(res.body.intent, 'unknown');
        assert.equal(res.body.classifierSource, 'fallback');
        assert.match(res.body.replies[0], /did not quite understand/);

        const fallback = await AuditEvent.findOne({ type: 'CLASSIFIER_FALLBACK' });
        assert.ok(fallback);
        assert.equal(fallback.entityId, 'sim-fallback-1');
        assert.equal(fallback.detail.reason, 'ai_unavailable');

        const classified = await AuditEvent.findOne({ type: 'CLASSIFIED' });
        assert.equal(classified.detail.intent, 'unknown');
        assert.equal(classified.detail.source, 'fallback');
    });
});
