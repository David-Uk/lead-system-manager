import './helpers/setup-env.mjs';
import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { AuditEvent } from '../src/models/auditEvent.model.js';
import { Conversation } from '../src/models/conversation.model.js';
import { Customer } from '../src/models/customer.model.js';
import { Message } from '../src/models/message.model.js';
import { Ticket } from '../src/models/ticket.model.js';
import { clearDb, startTestDb, stopTestDb } from './helpers/testDb.js';

const app = createApp();
const API_KEY = 'test-staff-key';

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

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60_000);

/** Minimal open ticket; createdAt is shifted via the raw driver when order matters. */
function createTicket(overrides = {}) {
    sequence += 1;
    return Ticket.create({
        ticketId: `TKT-${String(sequence).padStart(4, '0')}`,
        reason: 'complaint',
        summary: `Test ticket ${sequence}`,
        ...overrides,
    });
}

/** Bypasses mongoose timestamps so list ordering is deterministic in tests. */
function shiftTicketCreatedAt(ticket, date) {
    return Ticket.collection.updateOne({ _id: ticket._id }, { $set: { createdAt: date } });
}

describe('GET /api/tickets (workplan 8.9, T-013)', () => {
    test('requires the staff api key', async () => {
        const res = await request(app).get('/api/tickets');

        assert.equal(res.status, 401);
        assert.equal(res.body.error.code, 'UNAUTHORIZED');
    });

    test('lists tickets newest first with pagination metadata and the full shape', async () => {
        const first = await createTicket({ summary: 'first' });
        const second = await createTicket({ summary: 'second' });
        const third = await createTicket({ summary: 'third' });
        await shiftTicketCreatedAt(first, minutesAgo(30));
        await shiftTicketCreatedAt(second, minutesAgo(20));
        await shiftTicketCreatedAt(third, minutesAgo(10));

        const res = await request(app).get('/api/tickets').set('x-api-key', API_KEY);

        assert.equal(res.status, 200);
        assert.equal(res.body.total, 3);
        assert.equal(res.body.page, 1);
        assert.equal(res.body.limit, 20);
        assert.deepEqual(
            res.body.data.map((ticket) => ticket.summary),
            ['third', 'second', 'first'],
        );
        assert.deepEqual(Object.keys(res.body.data[0]).sort(), [
            'assignee',
            'conversationId',
            'createdAt',
            'customerId',
            'firstResponseAt',
            'notificationStatus',
            'overdue',
            'priority',
            'reason',
            'resolutionNote',
            'resolvedAt',
            'status',
            'summary',
            'ticketId',
        ]);
    });

    test('filters by status, priority and assignee', async () => {
        await createTicket({ status: 'assigned', priority: 'high', assignee: 'Amaka' });
        await createTicket({ status: 'open', priority: 'normal' });
        await createTicket({ status: 'resolved', priority: 'low' });

        const byStatus = await request(app)
            .get('/api/tickets?status=assigned')
            .set('x-api-key', API_KEY);
        assert.equal(byStatus.body.total, 1);
        assert.equal(byStatus.body.data[0].assignee, 'Amaka');

        const byPriority = await request(app)
            .get('/api/tickets?priority=low')
            .set('x-api-key', API_KEY);
        assert.equal(byPriority.body.total, 1);
        assert.equal(byPriority.body.data[0].status, 'resolved');

        const byAssignee = await request(app)
            .get('/api/tickets?assignee=Amaka')
            .set('x-api-key', API_KEY);
        assert.equal(byAssignee.body.total, 1);

        const combined = await request(app)
            .get('/api/tickets?status=assigned&priority=high')
            .set('x-api-key', API_KEY);
        assert.equal(combined.body.total, 1);
    });

    test('overdue=true returns only open tickets past the SLA (T-013 snapshot)', async () => {
        const overdue = await createTicket({ summary: 'past the SLA' });
        await shiftTicketCreatedAt(overdue, minutesAgo(30)); // SLA is 15 min in tests
        await createTicket({ summary: 'fresh' });

        const only = await request(app)
            .get('/api/tickets?overdue=true')
            .set('x-api-key', API_KEY);
        assert.equal(only.body.total, 1);
        assert.equal(only.body.data[0].summary, 'past the SLA');
        assert.equal(only.body.data[0].overdue, true);

        const inverse = await request(app)
            .get('/api/tickets?overdue=false')
            .set('x-api-key', API_KEY);
        assert.equal(inverse.body.total, 1);
        assert.equal(inverse.body.data[0].summary, 'fresh');
    });

    test('paginates with limit and page', async () => {
        for (const n of [1, 2, 3]) {
            const ticket = await createTicket({ summary: `t${n}` });
            await shiftTicketCreatedAt(ticket, minutesAgo(50 - n * 10));
        }

        const page2 = await request(app)
            .get('/api/tickets?limit=2&page=2')
            .set('x-api-key', API_KEY);

        assert.equal(page2.status, 200);
        assert.equal(page2.body.total, 3);
        assert.equal(page2.body.page, 2);
        assert.equal(page2.body.data.length, 1);
        assert.equal(page2.body.data[0].summary, 't1');
    });

    test('rejects an invalid query with 400 details', async () => {
        for (const query of ['limit=0', 'overdue=maybe', 'status=bogus', 'bogus=1']) {
            const res = await request(app).get(`/api/tickets?${query}`).set('x-api-key', API_KEY);

            assert.equal(res.status, 400, query);
            assert.equal(res.body.error.code, 'VALIDATION_ERROR');
            assert.ok(res.body.error.details.length > 0);
        }
    });
});

describe('GET /api/tickets/:ticketId (workplan 8.10, T-013)', () => {
    test('requires the staff api key', async () => {
        const res = await request(app).get('/api/tickets/TKT-0001');

        assert.equal(res.status, 401);
    });

    test('returns the ticket with customer and conversation messages (oldest first)', async () => {
        const customer = await Customer.create({ phone: '+2348012345678', name: 'Ada' });
        const conversation = await Conversation.create({ customerId: customer._id });

        const inbound = await Message.create({
            conversationId: conversation._id,
            direction: 'inbound',
            providerMessageId: 'sim-detail-1',
            text: 'The rice was stale',
            intent: 'complaint_or_refund',
            confidence: 0.9,
            classifierSource: 'rules',
        });
        const outbound = await Message.create({
            conversationId: conversation._id,
            direction: 'outbound',
            providerMessageId: 'sim-detail-2',
            text: 'Sorry about that experience.',
        });
        await Message.collection.updateOne(
            { _id: inbound._id },
            { $set: { createdAt: minutesAgo(2) } },
        );
        await Message.collection.updateOne(
            { _id: outbound._id },
            { $set: { createdAt: minutesAgo(1) } },
        );

        const ticket = await createTicket({
            conversationId: conversation._id,
            customerId: customer._id,
            summary: 'The rice was stale',
        });

        const res = await request(app)
            .get(`/api/tickets/${ticket.ticketId}`)
            .set('x-api-key', API_KEY);

        assert.equal(res.status, 200);
        assert.equal(res.body.ticketId, ticket.ticketId);
        assert.deepEqual(res.body.customer, { phone: '+2348012345678', name: 'Ada' });
        assert.equal(String(res.body.conversationId), String(conversation._id));
        assert.equal(res.body.conversation.length, 2);
        assert.deepEqual(
            res.body.conversation.map((message) => message.direction),
            ['inbound', 'outbound'],
        );
        assert.deepEqual(Object.keys(res.body.conversation[0]).sort(), [
            'classifierSource',
            'confidence',
            'createdAt',
            'direction',
            'intent',
            'text',
        ]);
        assert.equal(res.body.conversation[0].intent, 'complaint_or_refund');
        assert.equal(res.body.conversation[1].intent, null);
    });

    test('normalises the reference and 404s when the ticket is unknown', async () => {
        const created = await createTicket({});

        const lower = await request(app)
            .get(`/api/tickets/${created.ticketId.toLowerCase()}`)
            .set('x-api-key', API_KEY);
        assert.equal(lower.status, 200);

        const missing = await request(app)
            .get('/api/tickets/TKT-9999')
            .set('x-api-key', API_KEY);
        assert.equal(missing.status, 404);
        assert.equal(missing.body.error.code, 'NOT_FOUND');
    });
});

describe('PATCH /api/tickets/:ticketId (workplan 8.11, T-013)', () => {
    test('requires the staff api key', async () => {
        const res = await request(app)
            .patch('/api/tickets/TKT-0001')
            .send({ assignee: 'Amaka' });

        assert.equal(res.status, 401);
    });

    test('assigning a ticket sets firstResponseAt and audits the change', async () => {
        const created = await createTicket({});

        const res = await request(app)
            .patch(`/api/tickets/${created.ticketId}`)
            .set('x-api-key', API_KEY)
            .send({ assignee: 'Amaka' });

        assert.equal(res.status, 200);
        assert.equal(res.body.assignee, 'Amaka');
        assert.equal(res.body.status, 'open'); // assigning alone keeps the status
        assert.ok(res.body.firstResponseAt);

        const audit = await AuditEvent.findOne({ type: 'TICKET_UPDATED' });
        assert.ok(audit);
        assert.equal(audit.entityId, created.ticketId);
        assert.deepEqual(audit.detail, {
            from: 'open',
            to: 'open',
            assignee: 'Amaka',
            resolutionNote: null,
            via: 'staff_api',
        });
    });

    test('a repeated PATCH with the same values is an idempotent no-op', async () => {
        const created = await createTicket({ assignee: 'Amaka' });

        const res = await request(app)
            .patch(`/api/tickets/${created.ticketId}`)
            .set('x-api-key', API_KEY)
            .send({ assignee: 'Amaka' });

        assert.equal(res.status, 200);
        assert.equal(res.body.assignee, 'Amaka');
        assert.equal(await AuditEvent.countDocuments({ type: 'TICKET_UPDATED' }), 0);
    });

    test('moving open -> assigned records the transition', async () => {
        const created = await createTicket({});

        const res = await request(app)
            .patch(`/api/tickets/${created.ticketId}`)
            .set('x-api-key', API_KEY)
            .send({ status: 'assigned' });

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'assigned');
        assert.ok(res.body.firstResponseAt);

        const audit = await AuditEvent.findOne({ type: 'TICKET_UPDATED' });
        assert.equal(audit.detail.from, 'open');
        assert.equal(audit.detail.to, 'assigned');
        assert.equal(audit.detail.via, 'staff_api');
    });

    test('an illegal jump (open -> in_progress) is a 400 and changes nothing', async () => {
        const created = await createTicket({});

        const res = await request(app)
            .patch(`/api/tickets/${created.ticketId}`)
            .set('x-api-key', API_KEY)
            .send({ status: 'in_progress' });

        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
        assert.match(res.body.error.message, /Cannot move ticket/);
        assert.equal(await AuditEvent.countDocuments({ type: 'TICKET_UPDATED' }), 0);

        const stored = await Ticket.findById(created._id);
        assert.equal(stored.status, 'open');
    });

    test('resolving requires a resolution note', async () => {
        const created = await createTicket({ status: 'assigned' });

        const res = await request(app)
            .patch(`/api/tickets/${created.ticketId}`)
            .set('x-api-key', API_KEY)
            .send({ status: 'resolved' });

        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
        assert.ok(res.body.error.details.some((detail) => detail.path === 'resolutionNote'));
    });

    test('walks assigned -> in_progress -> resolved -> closed and rejects reopening', async () => {
        const created = await createTicket({});

        const assigned = await request(app)
            .patch(`/api/tickets/${created.ticketId}`)
            .set('x-api-key', API_KEY)
            .send({ status: 'assigned', assignee: 'Amaka' });
        assert.equal(assigned.body.status, 'assigned');

        const inProgress = await request(app)
            .patch(`/api/tickets/${created.ticketId}`)
            .set('x-api-key', API_KEY)
            .send({ status: 'in_progress' });
        assert.equal(inProgress.body.status, 'in_progress');

        const resolved = await request(app)
            .patch(`/api/tickets/${created.ticketId}`)
            .set('x-api-key', API_KEY)
            .send({ status: 'resolved', resolutionNote: 'Refund issued' });
        assert.equal(resolved.body.status, 'resolved');
        assert.equal(resolved.body.resolutionNote, 'Refund issued');
        assert.ok(resolved.body.resolvedAt);

        const closed = await request(app)
            .patch(`/api/tickets/${created.ticketId}`)
            .set('x-api-key', API_KEY)
            .send({ status: 'closed' });
        assert.equal(closed.body.status, 'closed');

        const reopen = await request(app)
            .patch(`/api/tickets/${created.ticketId}`)
            .set('x-api-key', API_KEY)
            .send({ status: 'in_progress' });
        assert.equal(reopen.status, 400);

        const events = await AuditEvent.find({ type: 'TICKET_UPDATED' }).sort({ _id: 1 });
        assert.deepEqual(
            events.map((event) => `${event.detail.from}->${event.detail.to}`),
            ['open->assigned', 'assigned->in_progress', 'in_progress->resolved', 'resolved->closed'],
        );
    });

    test('PATCH on an unknown ticket is a 404', async () => {
        const res = await request(app)
            .patch('/api/tickets/TKT-9999')
            .set('x-api-key', API_KEY)
            .send({ status: 'closed' });

        assert.equal(res.status, 404);
        assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    test('rejects invalid update bodies', async () => {
        const created = await createTicket({});

        const cases = [
            {}, // nothing to change
            { status: 'open' }, // initial state, not a staff transition
            { bogus: 'x' }, // strict schema
            { status: 'resolved', resolutionNote: '' }, // note required + min length
        ];

        for (const body of cases) {
            const res = await request(app)
                .patch(`/api/tickets/${created.ticketId}`)
                .set('x-api-key', API_KEY)
                .send(body);

            assert.equal(res.status, 400, JSON.stringify(body));
            assert.equal(res.body.error.code, 'VALIDATION_ERROR');
        }
    });
});
