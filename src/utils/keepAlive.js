import { waitUntil as vercelWaitUntil } from '@vercel/functions';

/**
 * Extends a serverless invocation until the given promise settles.
 *
 * On Vercel a function instance may be frozen the moment its response is
 * sent, which would cut off post-response work. The webhook pipeline is the
 * one such case: the 200 ack goes out first by design and processing
 * continues afterwards, so it runs inside keepAlive.
 *
 * Outside a Vercel function context (local server, tests) there is nothing
 * to extend - a long-running process keeps the promise alive by itself - so
 * any failure here is deliberately swallowed.
 */
export function keepAlive(promise) {
    try {
        Promise.resolve(vercelWaitUntil(promise)).catch(() => {});
    } catch {
        // Not inside a Vercel function: safe to ignore.
    }
}
