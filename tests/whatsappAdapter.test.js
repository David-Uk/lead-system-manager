import './helpers/setup-env.mjs';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { OUTBOUND_LOG_FILE, sendText } from '../src/services/whatsapp.adapter.js';

// No database needed: the adapter is a pure service.

const execFileAsync = promisify(execFile);
const scenarioScript = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'helpers',
    'run-adapter-scenario.mjs',
);

/**
 * Runs the adapter in a child process with a modified environment and/or
 * fetch mock, then returns the { result, fetchCalls } JSON it prints.
 */
async function runScenario(scenario, env = {}) {
    const { stdout } = await execFileAsync(process.execPath, [scenarioScript, scenario], {
        env: { ...process.env, ...env },
        timeout: 30_000,
    });
    const lines = stdout.trim().split(/\r?\n/);
    return JSON.parse(lines.at(-1));
}

describe('whatsapp adapter - simulated mode', () => {
    test('returns ok, a simulated provider id, and appends to the outbound log', async () => {
        const text = `adapter-test ${randomUUID()}`;

        const result = await sendText('+2348012345678', text);

        assert.equal(result.ok, true);
        assert.equal(result.mode, 'simulated');
        assert.match(result.providerMessageId, /^sim-out-/);
        assert.equal(result.error, null);

        const log = await readFile(OUTBOUND_LOG_FILE, 'utf8');
        const line = log.split('\n').find((entry) => entry.includes(text));
        assert.ok(line, 'outbound log should contain the simulated message');

        const parsed = JSON.parse(line);
        assert.equal(parsed.to, '+2348012345678');
        assert.equal(parsed.text, text);
        assert.equal(parsed.mode, 'simulated');
    });

    test('never throws on invalid arguments', async () => {
        const result = await sendText('', 'hello');

        assert.equal(result.ok, false);
        assert.equal(result.error, 'invalid_argument');
    });
});

describe('whatsapp adapter - failure and cloud modes', () => {
    test('WHATSAPP_FORCE_SEND_FAILURE=true produces a failed result (workplan T10 hook)', async () => {
        const { result } = await runScenario('forced', { WHATSAPP_FORCE_SEND_FAILURE: 'true' });

        assert.equal(result.ok, false);
        assert.equal(result.error, 'forced_send_failure');
        assert.equal(result.mode, 'simulated');
    });

    test('cloud mode posts to the Graph API and returns the provider message id', async () => {
        const { result, fetchCalls } = await runScenario('cloud-ok', {
            WHATSAPP_MODE: 'cloud',
            WHATSAPP_ACCESS_TOKEN: 'test-token',
            WHATSAPP_PHONE_NUMBER_ID: '1234567890',
        });

        assert.deepEqual(result, {
            ok: true,
            mode: 'cloud',
            providerMessageId: 'wamid.CLOUD1',
            error: null,
        });

        assert.equal(fetchCalls.length, 1);
        const [{ url, init }] = fetchCalls;
        assert.ok(url.includes('/1234567890/messages'));
        assert.equal(init.headers.Authorization, 'Bearer test-token');

        const parsedBody = JSON.parse(init.body);
        assert.equal(parsedBody.to, '2348012345678'); // wa_id format (no +)
        assert.equal(parsedBody.text.body, 'hello');
    });

    test('cloud mode maps provider errors to ok:false without throwing', async () => {
        const { result } = await runScenario('cloud-http-error', {
            WHATSAPP_MODE: 'cloud',
            WHATSAPP_ACCESS_TOKEN: 'bad-token',
            WHATSAPP_PHONE_NUMBER_ID: '1234567890',
        });

        assert.equal(result.ok, false);
        assert.equal(result.mode, 'cloud');
        assert.equal(result.error, 'Invalid OAuth access token');
    });

    test('cloud mode maps network failures to ok:false without throwing', async () => {
        const { result } = await runScenario('cloud-network-error', {
            WHATSAPP_MODE: 'cloud',
            WHATSAPP_ACCESS_TOKEN: 'test-token',
            WHATSAPP_PHONE_NUMBER_ID: '1234567890',
        });

        assert.equal(result.ok, false);
        assert.equal(result.error, 'network unreachable');
    });
});
