import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { env } from '../config/env.js';
import { requireApiKey } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { validateSimulateRequest } from '../validators/simulate.validator.js';
import { createSandboxKey, sendSimulatedMessage } from '../controllers/simulate.controller.js';

const router = Router();

/** POST /simulate/keys is public; abuse protection is the hourly per-IP cap. */
const keyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: env.SANDBOX_KEY_MAX_PER_HOUR,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  handler: (req, res) => {
    res.status(429).json({
      error: { code: 'RATE_LIMITED', message: 'Too many sandbox keys requested', details: [] },
      correlationId: req.id,
    });
  },
});

/**
 * Production posture (workplan 8.3, refined by T-021): the simulate harness
 * stays 404 for the live staff key in production, but generated sandbox keys
 * may run it - they cannot touch live data.
 */
export function isSimulateBlocked({ nodeEnv, authMode }) {
  return nodeEnv === 'production' && authMode !== 'sandbox';
}

function simulateMode(req, res, next) {
  if (isSimulateBlocked({ nodeEnv: env.NODE_ENV, authMode: req.auth?.mode ?? null })) {
    return next(new HttpError(404, 'NOT_FOUND', 'Not found'));
  }
  return next();
}

router.post('/keys', keyLimiter, createSandboxKey);
router.post('/message', requireApiKey, simulateMode, validateSimulateRequest, sendSimulatedMessage);

export default router;
