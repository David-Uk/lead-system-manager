/**
 * Runs the WhatsApp adapter in a child process with a controlled environment
 * and/or fetch implementation, then prints the outcome as one JSON line on
 * stdout (the last line - callers may see stray log output before it).
 *
 * Usage: node run-adapter-scenario.mjs <forced|cloud-ok|cloud-http-error|cloud-network-error>
 *
 * Environment variables (WHATSAPP_MODE, WHATSAPP_ACCESS_TOKEN,
 * WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_FORCE_SEND_FAILURE, ...) are supplied by
 * the parent process - see tests/whatsappAdapter.test.js.
 */
const scenario = process.argv[2];

const fetchCalls = [];

if (scenario === 'cloud-ok') {
    globalThis.fetch = async (url, init) => {
        fetchCalls.push({ url, init });
        return new Response(JSON.stringify({ messages: [{ id: 'wamid.CLOUD1' }] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    };
} else if (scenario === 'cloud-http-error') {
    globalThis.fetch = async (url, init) => {
        fetchCalls.push({ url, init });
        return new Response(JSON.stringify({ error: { message: 'Invalid OAuth access token' } }), {
            status: 401,
            headers: { 'content-type': 'application/json' },
        });
    };
} else if (scenario === 'cloud-network-error') {
    globalThis.fetch = async (url, init) => {
        fetchCalls.push({ url, init });
        throw new Error('network unreachable');
    };
}

const { sendText } = await import('../../src/services/whatsapp.adapter.js');

const result = await sendText('+2348012345678', 'hello');

console.log(JSON.stringify({ result, fetchCalls }));
