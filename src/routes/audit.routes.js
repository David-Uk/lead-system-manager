import { Router } from 'express';
import { requireApiKey } from '../middleware/auth.js';
import { validateAuditQuery } from '../validators/audit.validator.js';
import { getAuditEvents } from '../controllers/audit.controller.js';

/**
 * Audit trail API (workplan 8.14). Read-only; every staff endpoint is
 * behind the shared x-api-key.
 */
const router = Router();

router.use(requireApiKey);

router.get('/', validateAuditQuery, getAuditEvents);

export default router;
