import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request sandbox context.
 *
 * Requests authenticated with a generated sandbox key run inside
 * `runInSandbox({ sandboxId, expiresAt }, ...)`; everything else (staff
 * requests, the webhook, tests, seed scripts) has no context - which
 * `currentSandbox()` reports as `null`, i.e. the live scope.
 *
 * The models' sandbox scoping plugin (src/models/plugins/sandboxScope.js)
 * is the only consumer.
 */
const storage = new AsyncLocalStorage();

/** Runs `fn` with the sandbox context visible to every async continuation. */
export function runInSandbox(context, fn) {
    return storage.run(context, fn);
}

/** @returns {{sandboxId: string, expiresAt: Date}|null} the active sandbox, if any */
export function currentSandbox() {
    return storage.getStore() ?? null;
}
