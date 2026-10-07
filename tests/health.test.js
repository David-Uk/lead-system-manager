import './helpers/setup-env.mjs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../src/app.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';

const app = createApp();
let mongod;

before(async () => {
    mongod = await startTestDb();
});

after(async () => {
    await stopTestDb(mongod);
});

describe('GET /health (workplan 8.16)', () => {
    test('returns 200 ok with mongo up', async () => {
        const res = await request(app).get('/health');

        assert.equal(res.status, 200);
        assert.equal(res.body.status, 'ok');
        assert.equal(res.body.checks.mongo, 'up');
        assert.equal(res.body.checks.llm, 'disabled'); // LLM_PROVIDER=none in tests
        assert.equal(res.body.checks.notifier, 'up'); // simulated WhatsApp mode
        assert.equal(res.body.version, '1.0.0');
        assert.equal(typeof res.body.uptimeSec, 'number');
        assert.ok(res.headers['x-correlation-id']);
    });

    test('returns 503 down when mongo is disconnected', async () => {
        await mongoose.disconnect();

        const res = await request(app).get('/health');

        assert.equal(res.status, 503);
        assert.equal(res.body.status, 'down');
        assert.equal(res.body.checks.mongo, 'down');
    });
});
