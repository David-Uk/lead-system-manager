import { Router } from 'express';
import { requireApiKey } from '../middleware/auth.js';
import { validateMetricsQuery } from '../validators/metrics.validator.js';
import { getMetrics } from '../controllers/metrics.controller.js';

/**
 * Metrics API (workplan 8.15). Behind the shared x-api-key like the other
 * staff endpoints; the dashboard prompts for the key.
 */
const router = Router();

router.use(requireApiKey);

router.get('/', validateMetricsQuery, getMetrics);

export default router;
