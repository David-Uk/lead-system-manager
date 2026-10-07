import './helpers/setup-env.mjs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

// No database needed for these paths.
describe('standard error handling', () => {
    test('unknown routes return the standard 404 body with a correlation id', async () => {
        const res = await request(app).get('/no-such-route');

        assert.equal(res.status, 404);
        assert.equal(res.body.error.code, 'NOT_FOUND');
        assert.ok(res.body.error.message.includes('/no-such-route'));
        assert.deepEqual(res.body.error.details, []);
        assert.equal(res.headers['x-correlation-id'], res.body.correlationId);
        assert.match(
            res.body.correlationId,
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
    });

    test('the index route serves a service signpost, not a 404', async () => {
        const res = await request(app).get('/');

        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /application\/json/);
        assert.equal(res.body.name, 'Lead System Manager API');
        assert.ok(res.body.version);
        assert.equal(res.body.documentation, '/docs');
        assert.equal(res.body.dashboard, '/dashboard');
        assert.equal(res.body.simulation, '/simulate');
        assert.equal(res.body.health, '/health');
        assert.equal(res.body.openapi, '/openapi.json');
    });

    test('malformed JSON returns 400 with a standard error body', async () => {
        const res = await request(app)
            .post('/simulate/message')
            .set('content-type', 'application/json')
            .set('x-api-key', 'test-staff-key')
            .send('{"broken": ');

        assert.equal(res.status, 400);
        assert.equal(res.body.error.code, 'VALIDATION_ERROR');
        assert.ok(res.headers['x-correlation-id']);
    });
});
