import './helpers/setup-env.mjs';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../src/app.js';

const app = createApp();

describe('home GUI (index page for browsers)', () => {
    test('serves the GUI HTML when the client accepts text/html', async () => {
        const res = await request(app).get('/').set('Accept', 'text/html');

        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /text\/html/);
        assert.match(res.text, /Lead System Manager/);
        assert.match(res.text, /\/simulate\/message/);
        assert.match(res.text, /\/simulate\/keys/);
        assert.match(res.text, /id="generate-key"/);
        assert.match(res.text, /Explore API data/);
        assert.match(res.text, /href="\/simulate"/);
        assert.match(res.text, /\/dashboard/);
        assert.match(res.text, /\/ui\/app\.js/);
        assert.match(res.text, /data-env="test"/);
        assert.match(res.text, /Is there anything for breakfast\?/);
        assert.match(res.text, /Abeg I need something to cook jollof/);
    });

    test('answers with the JSON signpost when HTML is not requested', async () => {
        const res = await request(app).get('/');

        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /application\/json/);
        assert.equal(res.body.name, 'Lead System Manager API');
    });

    test('serves the GUI assets with the right content types', async () => {
        const js = await request(app).get('/ui/app.js');
        assert.equal(js.status, 200);
        assert.match(js.headers['content-type'], /javascript/);

        const css = await request(app).get('/ui/style.css');
        assert.equal(css.status, 200);
        assert.match(css.headers['content-type'], /text\/css/);
    });
});

describe('simulation workbench (GET /simulate)', () => {
    test('serves the workbench HTML when the client accepts text/html', async () => {
        const res = await request(app).get('/simulate').set('Accept', 'text/html');

        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /text\/html/);
        assert.match(res.text, /Simulation workbench/);
        assert.match(res.text, /\/ui\/simulate\.js/);
        assert.match(res.text, /id="generate-key"/);
        assert.match(res.text, /id="new-customer"/);
        assert.match(res.text, /id="pipeline"/);
        assert.match(res.text, /id="audit-timeline"/);
        assert.match(res.text, /data-env="test"/);
        assert.match(res.text, /Is there anything for breakfast\?/);
        assert.match(res.text, /Abeg I need something to cook jollof/);
    });

    test('falls through to 404 for non-HTML clients (the API surface is POST-only)', async () => {
        const res = await request(app).get('/simulate');

        assert.equal(res.status, 404);
        assert.equal(res.body.error.code, 'NOT_FOUND');
    });

    test('serves the workbench script asset', async () => {
        const res = await request(app).get('/ui/simulate.js');

        assert.equal(res.status, 200);
        assert.match(res.headers['content-type'], /javascript/);
    });
});
