import { Router } from 'express';
import { env } from '../config/env.js';
import { requireApiKey } from '../middleware/auth.js';
import { HttpError } from '../utils/httpError.js';
import { validateSimulateRequest } from '../validators/simulate.validator.js';
import { sendSimulatedMessage } from '../controllers/simulate.controller.js';

const router = Router();

/** The simulate harness is disabled in production (workplan 8.3). */
function simulateEnabled(req, res, next) {
  if (env.NODE_ENV === 'production') {
    return next(new HttpError(404, 'NOT_FOUND', 'Not found'));
  }
  return next();
}

router.post('/message', simulateEnabled, requireApiKey, validateSimulateRequest, sendSimulatedMessage);

export default router;
