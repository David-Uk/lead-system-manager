import { asyncHandler } from '../utils/asyncHandler.js';
import { getMetrics as computeMetrics } from '../services/metrics.service.js';

/**
 * Metrics API (workplan 8.15). The dashboard polls this endpoint; the
 * controller only shapes the request around the service.
 */

/** GET /api/metrics - period figures plus the live ticket/SLA snapshot. */
export const getMetrics = asyncHandler(async (req, res) => {
    const metrics = await computeMetrics(req.metricsQuery);
    res.status(200).json(metrics);
});
