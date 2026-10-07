import { timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { HttpError } from '../utils/httpError.js';

function safeEqual(a, b) {
  const bufferA = Buffer.from(String(a));
  const bufferB = Buffer.from(String(b));
  return bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB);
}

/**
 * Staff authentication via a shared API key (workplan: `x-api-key` header).
 * Constant-time comparison; v1 single key, JWT/RBAC planned in the 90-day
 * plan (workplan 17).
 */
export function requireApiKey(req, res, next) {
  const provided = req.get('x-api-key');
  if (!provided || !safeEqual(provided, env.STAFF_API_KEY)) {
    return next(new HttpError(401, 'UNAUTHORIZED', 'Missing or invalid x-api-key'));
  }
  return next();
}
