import './helpers/setup-env.mjs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

// No database needed: the dashboard is a static bundle, and the APIs it
// polls are covered by the tickets/metrics/audit suites.
describe('staff dashboard (workplan 8.17, T-015)', () => {
    test('redirects the bare path and serves the dashboard page with a Chart.js-friendly CSP', async () => {
        const redirect = await request(app).get('/dashboard');
        assert.equal(redirect.status, 301);
        assert.equal(redirect.headers.location, '/dashboard/');

        const res = await request(app).get('/dashboard/');

        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /text\/html/);
        assert.match(res.text, /Lagos Fresh Mart/);
        assert.match(res.text, /\/dashboard\/dashboard\.js/);
        assert.match(res.text, /cdn\.jsdelivr\.net/);

        const csp = res.headers['content-security-policy'];
        assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
        assert.match(csp, /frame-ancestors 'none'/);
    });

    test('serves the dashboard script and stylesheet', async () => {
        const js = await request(app).get('/dashboard/dashboard.js');
        assert.equal(js.status, 200);
        assert.match(js.headers['content-type'], /javascript/);

        const css = await request(app).get('/dashboard/dashboard.css');
        assert.equal(css.status, 200);
        assert.match(css.headers['content-type'], /text\/css/);
    });

    test('does not expose the APIs it polls without the staff key', async () => {
        const metrics = await request(app).get('/api/metrics');
        assert.equal(metrics.status, 401);
        assert.equal(metrics.body.error.code, 'UNAUTHORIZED');
    });
});
