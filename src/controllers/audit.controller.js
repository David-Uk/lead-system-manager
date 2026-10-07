import { asyncHandler } from '../utils/asyncHandler.js';
import { listEvents } from '../services/audit.service.js';

/**
 * Audit API (workplan 8.14). Read-only by design - the collection is
 * append-only and exposes no update or delete routes.
 */

/** GET /api/audit - cursor-paginated trail, newest first. */
export const getAuditEvents = asyncHandler(async (req, res) => {
    const { data, nextCursor } = await listEvents(req.auditQuery);
    res.status(200).json({ data, nextCursor });
});
