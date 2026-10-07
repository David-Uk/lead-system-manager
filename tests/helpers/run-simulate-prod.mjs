/**
 * Boots the app in production mode (environment supplied by the parent
 * process) and calls POST /simulate/message, printing the outcome as one
 * JSON line on stdout.
 *
 * Used by tests/simulate.test.js to prove the endpoint is disabled in
 * production, with real environment isolation instead of module-reset tricks.
 */
const { createApp } = await import('../../src/app.js');

const app = createApp();
const server = app.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

try {
    const { port } = server.address();
    const res = await fetch(`http://127.0.0.1:${port}/simulate/message`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json',
            'x-api-key': process.env.STAFF_API_KEY,
        },
        body: JSON.stringify({ from: '+2348012345678', text: 'hello' }),
    });
    const body = await res.json().catch(() => ({}));
    console.log(JSON.stringify({ status: res.status, body }));
} finally {
    server.close();
}
