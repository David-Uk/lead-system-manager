import './helpers/setup-env.mjs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditEvent } from '../src/models/auditEvent.model.js';
import { Message } from '../src/models/message.model.js';
import { processInboundMessage } from '../src/services/pipeline.service.js';
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

function inbound(messageId, text = 'I want to buy 2 bags of rice') {
    return {
        providerMessageId: messageId,
        phoneRaw: '2348012345678',
        phone: '+2348012345678',
        name: 'Test Customer',
        type: 'text',
        text,
        timestamp: null,
    };
}

describe('dedupe and message persistence (T-007, failure 2)', () => {
    test('stores inbound + outbound messages and annotates the classification', async () => {
        const result = await processInboundMessage({
            message: inbound('sim-persist-1', 'How much is 5kg rice?'),
            correlationId: 'corr-persist-1',
            source: 'simulate',
        });

        assert.equal(result.duplicate, false);
        assert.equal(result.intent, 'price_check');
        assert.equal(result.classifierSource, 'rules');
        assert.equal(result.replies.length, 1);

        const stored = await Message.findOne({ providerMessageId: 'sim-persist-1' });
        assert.ok(stored);
        assert.equal(stored.direction, 'inbound');
        assert.equal(stored.text, 'How much is 5kg rice?');
        assert.equal(stored.intent, 'price_check');
        assert.equal(stored.classifierSource, 'rules');
        assert.ok(stored.confidence >= 0.7);
        assert.equal(String(stored.conversationId), result.conversation.id);

        const outbound = await Message.findOne({ direction: 'outbound' });
        assert.ok(outbound);
        assert.equal(outbound.text, result.replies[0]);
        assert.equal(outbound.intent, 'price_check');
        assert.ok(outbound.providerMessageId.startsWith('sim-out-'));
    });

    test('a repeat delivery is ignored: one stored message, no second reply (T6)', async () => {
        const first = await processInboundMessage({
            message: inbound('sim-dup-1'),
            correlationId: 'corr-dup-1',
            source: 'simulate',
        });
        assert.equal(first.duplicate, false);

        const second = await processInboundMessage({
            message: inbound('sim-dup-1'),
            correlationId: 'corr-dup-2',
            source: 'simulate',
        });

        assert.equal(second.duplicate, true);
        assert.deepEqual(second.replies, []);
        assert.equal(second.intent, null);
        assert.equal(second.conversation.id, first.conversation.id);

        assert.equal(await Message.countDocuments({ direction: 'inbound' }), 1);
        assert.equal(await Message.countDocuments({ direction: 'outbound' }), 1);
        assert.equal(await AuditEvent.countDocuments({ type: 'REPLY_SENT' }), 1);

        const audit = await AuditEvent.findOne({ type: 'DUPLICATE_IGNORED' });
        assert.ok(audit);
        assert.equal(audit.entityId, 'sim-dup-1');
        assert.equal(audit.correlationId, 'corr-dup-2');
    });

    test('concurrent deliveries of the same id store exactly one message', async () => {
        // Make sure the unique index exists before racing the inserts.
        await Message.init();

        const [a, b] = await Promise.all([
            processInboundMessage({
                message: inbound('sim-race-1'),
                correlationId: 'corr-race-a',
                source: 'simulate',
            }),
            processInboundMessage({
                message: inbound('sim-race-1'),
                correlationId: 'corr-race-b',
                source: 'simulate',
            }),
        ]);

        const results = [a, b];
        assert.equal(results.filter((r) => r.duplicate).length, 1);
        assert.equal(results.filter((r) => !r.duplicate).length, 1);
        assert.equal(await Message.countDocuments({ providerMessageId: 'sim-race-1' }), 1);
        assert.equal(await AuditEvent.countDocuments({ type: 'DUPLICATE_IGNORED' }), 1);
    });
});
