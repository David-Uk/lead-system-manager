import './helpers/setup-env.mjs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { env } from '../src/config/env.js';
import { AuditEvent } from '../src/models/auditEvent.model.js';
import { Ticket } from '../src/models/ticket.model.js';
import { maskPhone } from '../src/utils/phone.js';
import {
    MAX_ATTEMPTS,
    RETRY_DELAYS_MS,
    notifyStaffOfTicket,
} from '../src/services/notify.service.js';
import { clearDb, startTestDb, stopTestDb } from './helpers/testDb.js';

let mongod;
let sequence = 0;

before(async () => {
    mongod = await startTestDb();
});

after(async () => {
    await stopTestDb(mongod);
});

beforeEach(async () => {
    await clearDb();
    sequence = 0;
});

function createTicket(overrides = {}) {
    sequence += 1;
    return Ticket.create({
        ticketId: `TKT-${String(sequence).padStart(4, '0')}`,
        reason: 'refund',
        priority: 'high',
        summary: 'Customer wants a refund for stale rice',
        ...overrides,
    });
}

describe('staff notifier (T-014, failure 4)', () => {
    test('sends the alert through the adapter and audits the delivery', async () => {
        const ticket = await createTicket({});
        const calls = [];
        const send = async (to, text) => {
            calls.push({ to, text });
            return { ok: true };
        };

        const result = await notifyStaffOfTicket({
            ticket,
            correlationId: 'corr-notify-1',
            customerPhone: '+2348012345678',
            send,
            retryDelaysMs: [1, 1],
        });

        assert.deepEqual(result, { ok: true, attempts: 1, error: null });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].to, env.STAFF_WHATSAPP_NUMBER);
        assert.match(calls[0].text, /New HIGH ticket TKT-\d{4} \(refund\)/);
        assert.match(calls[0].text, /Customer: \+2348012345678/);
        assert.match(calls[0].text, /Customer wants a refund for stale rice/);
        assert.match(calls[0].text, /Pick it up from the staff dashboard\./);

        const stored = await Ticket.findById(ticket._id);
        assert.equal(stored.notificationStatus, 'sent');

        const audit = await AuditEvent.findOne({ type: 'NOTIFICATION_SENT' });
        assert.ok(audit);
        assert.equal(audit.entityId, ticket.ticketId);
        assert.equal(audit.correlationId, 'corr-notify-1');
        assert.equal(audit.actor, 'system');
        assert.deepEqual(audit.detail, {
            channel: 'whatsapp',
            to: maskPhone(env.STAFF_WHATSAPP_NUMBER),
            attempts: 1,
        });
    });

    test('retries with backoff until an attempt succeeds', async () => {
        const ticket = await createTicket({});
        let attempts = 0;
        const send = async () => {
            attempts += 1;
            return attempts < 3 ? { ok: false, error: 'network down' } : { ok: true };
        };

        const result = await notifyStaffOfTicket({
            ticket,
            correlationId: 'corr-notify-2',
            send,
            retryDelaysMs: [1, 1],
        });

        assert.deepEqual(result, { ok: true, attempts: 3, error: null });
        assert.equal(attempts, 3);

        const stored = await Ticket.findById(ticket._id);
        assert.equal(stored.notificationStatus, 'sent');

        const audit = await AuditEvent.findOne({ type: 'NOTIFICATION_SENT' });
        assert.equal(audit.detail.attempts, 3);
    });

    test('flags the ticket failed and audits it when every attempt fails (failure 4)', async () => {
        const ticket = await createTicket({});
        let attempts = 0;
        const send = async () => {
            attempts += 1;
            return { ok: false, error: 'BOOM' };
        };

        const result = await notifyStaffOfTicket({
            ticket,
            correlationId: 'corr-notify-3',
            send,
            retryDelaysMs: [1, 1],
        });

        assert.deepEqual(result, { ok: false, attempts: MAX_ATTEMPTS, error: 'BOOM' });
        assert.equal(attempts, MAX_ATTEMPTS);

        const stored = await Ticket.findById(ticket._id);
        assert.equal(stored.notificationStatus, 'failed');

        const audit = await AuditEvent.findOne({ type: 'NOTIFICATION_FAILED' });
        assert.ok(audit);
        assert.equal(audit.entityId, ticket.ticketId);
        assert.deepEqual(audit.detail, {
            channel: 'whatsapp',
            to: maskPhone(env.STAFF_WHATSAPP_NUMBER),
            attempts: MAX_ATTEMPTS,
            error: 'BOOM',
        });
        assert.equal(await AuditEvent.countDocuments({ type: 'NOTIFICATION_SENT' }), 0);
    });

    test('exposes the retry policy the pipeline relies on', () => {
        assert.equal(MAX_ATTEMPTS, 3);
        assert.equal(RETRY_DELAYS_MS.length, MAX_ATTEMPTS - 1);
        assert.ok(RETRY_DELAYS_MS.every((delay) => delay >= 0));
    });
});
