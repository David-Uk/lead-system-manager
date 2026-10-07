import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { env } from '../config/env.js';
import { SandboxKey } from '../models/sandboxKey.model.js';

/**
 * Sandbox key lifecycle (simulation without live data).
 *
 * A sandbox key is a self-service credential: anyone hitting the demo can
 * mint one and use it as `x-api-key`. It never touches live data - every
 * request it authenticates runs inside an isolated scope (see
 * src/models/plugins/sandboxScope.js).
 *
 * Storage is hash-only: a leaked database cannot leak usable keys. Keys
 * expire after SANDBOX_KEY_TTL_HOURS and are rate-limited at creation.
 */

export const SANDBOX_KEY_PREFIX = 'lfm_sim_';

/** Sandbox documents live this much longer than the key itself. */
const DATA_GRACE_MS = 24 * 60 * 60 * 1000;

/** @returns {boolean} whether a value even looks like a sandbox key (fast reject, no DB read) */
export function isSandboxKey(value) {
    return typeof value === 'string' && value.startsWith(SANDBOX_KEY_PREFIX);
}

function hashKey(value) {
    return createHash('sha256').update(String(value)).digest('hex');
}

/**
 * Mints a new sandbox key. The plaintext token is returned exactly once;
 * only its hash is persisted.
 *
 * @returns {Promise<{apiKey: string, keyPrefix: string, sandboxId: string, expiresAt: Date}>}
 */
export async function createSandboxKey({ ip = null } = {}) {
    const apiKey = `${SANDBOX_KEY_PREFIX}${randomBytes(24).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + env.SANDBOX_KEY_TTL_HOURS * 60 * 60 * 1000);

    const doc = await SandboxKey.create({
        keyHash: hashKey(apiKey),
        keyPrefix: apiKey.slice(0, SANDBOX_KEY_PREFIX.length + 8),
        sandboxId: randomUUID(),
        createdByIp: ip,
        expiresAt,
    });

    return {
        apiKey,
        keyPrefix: doc.keyPrefix,
        sandboxId: doc.sandboxId,
        expiresAt: doc.expiresAt,
    };
}

/** @returns {Promise<object|null>} the unexpired key document for this token, if any */
export async function resolveSandboxKey(apiKey) {
    if (!isSandboxKey(apiKey)) return null;
    return SandboxKey.findOne({
        keyHash: hashKey(apiKey),
        expiresAt: { $gt: new Date() },
    });
}

/** Usage telemetry - best effort, never breaks the request. */
export async function touchSandboxKey(key) {
    await SandboxKey.updateOne(
        { _id: key._id },
        { $set: { lastUsedAt: new Date() }, $inc: { uses: 1 } },
    );
}

/** Expiry stamped on every document the key's requests create. */
export function sandboxDataExpiry(key) {
    return new Date(key.expiresAt.getTime() + DATA_GRACE_MS);
}
