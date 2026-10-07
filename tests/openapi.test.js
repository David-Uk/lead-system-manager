import './helpers/setup-env.mjs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

// No database needed: the OpenAPI document and the RapiDoc bundle are static.
describe('API documentation (T-016)', () => {
    test('serves a valid OpenAPI 3.0 document with the staff auth scheme', async () => {
        const res = await request(app).get('/openapi.json');

        assert.equal(res.status, 200);
        assert.equal(res.body.openapi, '3.0.3');
        assert.equal(res.body.info.title, 'Lead System Manager API');
        assert.ok(res.body.info.version);

        const apiKeyAuth = res.body.components.securitySchemes.ApiKeyAuth;
        assert.equal(apiKeyAuth.type, 'apiKey');
        assert.equal(apiKeyAuth.in, 'header');
        assert.equal(apiKeyAuth.name, 'x-api-key');

        assert.deepEqual(Object.keys(res.body.paths).sort(), [
            '/',
            '/api/audit',
            '/api/metrics',
            '/api/orders',
            '/api/orders/{orderId}',
            '/api/tickets',
            '/api/tickets/{ticketId}',
            '/health',
            '/simulate/keys',
            '/simulate/message',
            '/webhook',
        ]);
    });

    test('every documented operation carries a summary and responses', async () => {
        const res = await request(app).get('/openapi.json');
        const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];

        for (const [path, pathItem] of Object.entries(res.body.paths)) {
            const operations = Object.entries(pathItem).filter(([key]) =>
                methods.includes(key),
            );
            assert.ok(operations.length > 0, `${path} has no operations`);

            for (const [method, operation] of operations) {
                assert.ok(operation.summary, `${method.toUpperCase()} ${path} is missing a summary`);
                assert.ok(
                    operation.responses && Object.keys(operation.responses).length > 0,
                    `${method.toUpperCase()} ${path} is missing responses`,
                );
            }
        }
    });

    test('serves the RapiDoc page pointing at the document', async () => {
        const res = await request(app).get('/docs');

        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /text\/html/);
        assert.match(res.text, /<rapi-doc/);
        assert.match(res.text, /spec-url="\/openapi\.json"/);
        assert.match(res.text, /\/docs\/vendor\/rapidoc-min\.js/);
    });

    test('serves the self-hosted RapiDoc bundle', async () => {
        const res = await request(app).get('/docs/vendor/rapidoc-min.js');

        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /javascript/);
        assert.ok(Number(res.headers['content-length']) > 1000);
    });
});
