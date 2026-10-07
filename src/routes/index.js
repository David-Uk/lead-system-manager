import { Router } from 'express';
import { createRequire } from 'node:module';
import healthRoutes from './health.routes.js';
import webhookRoutes from './webhook.routes.js';
import simulateRoutes from './simulate.routes.js';
import ordersRoutes from './orders.routes.js';
import ticketsRoutes from './tickets.routes.js';
import metricsRoutes from './metrics.routes.js';
import auditRoutes from './audit.routes.js';
import dashboardRoutes from './dashboard.routes.js';
import docsRoutes from './docs.routes.js';
import homeRoutes from './home.routes.js';

/**
 * Central route table. New route groups are mounted here as tasks land.
 */
const router = Router();

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

// Browser GUI for the index page (Accept: text/html); JSON clients fall
// through to the signpost below. Also serves the GUI's /ui/* assets.
router.use(homeRoutes);

/**
 * Root signpost: browsers and probes hitting / get the service name, version
 * and the human-facing entry points instead of the 404 fallback. Convenience
 * only - not part of the workplan API surface.
 */
router.get('/', (req, res) => {
    res.json({
        name: 'Lead System Manager API',
        version,
        documentation: '/docs',
        dashboard: '/dashboard',
        simulation: '/simulate',
        health: '/health',
        openapi: '/openapi.json',
    });
});

router.use('/health', healthRoutes);
router.use('/webhook', webhookRoutes);
router.use('/simulate', simulateRoutes);
router.use('/api/orders', ordersRoutes);
router.use('/api/tickets', ticketsRoutes);
router.use('/api/metrics', metricsRoutes);
router.use('/api/audit', auditRoutes);
router.use('/dashboard', dashboardRoutes);

// Docs live at fixed root paths (/docs, /openapi.json).
router.use(docsRoutes);

export default router;
