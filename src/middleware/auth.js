import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';
import { runInSandbox } from '../utils/sandboxContext.js';
import {
  resolveSandboxKey,
  sandboxDataExpiry,
  touchSandboxKey,
} from '../services/sandboxKey.service.js';

function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/**
 * Staff authentication via a shared API key (workplan: `x-api-key` header).
 * Constant-time comparison; v1 single key, JWT/RBAC planned in the 90-day
 * plan (workplan 17).
 *
 * A generated sandbox key is also accepted (T-021). It authenticates the
 * same endpoints but runs the request inside an isolated sandbox scope that
 * never reads or writes live data; `req.auth.mode` records which credential
 * was used, and downstream middleware gates on it.
 */
export async function requireApiKey(req, res, next) {
  const provided = req.get('x-api-key');

  try {
    if (provided && safeEqual(provided, env.STAFF_API_KEY)) {
      req.auth = { mode: 'live' };
      return next();
    }

    const sandboxKey = provided ? await resolveSandboxKey(provided) : null;
    if (!sandboxKey) {
      return next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid x-api-key'));
    }

    req.auth = {
      mode: 'sandbox',
      sandboxId: sandboxKey.sandboxId,
      keyPrefix: sandboxKey.keyPrefix,
    };
    // Usage telemetry is best effort - never blocks the request.
    await touchSandboxKey(sandboxKey).catch(() => {});

    // Everything downstream - and every async continuation it starts - runs
    // inside the sandbox scope that the models' scoping plugin reads.
    return runInSandbox(
      { sandboxId: sandboxKey.sandboxId, expiresAt: sandboxDataExpiry(sandboxKey) },
      () => next(),
    );
  } catch (err) {
    return next(err);
  }
}
