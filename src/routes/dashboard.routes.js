import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
import helmet from 'helmet';

/**
 * Static operations dashboard (workplan 8.17, T-015).
 *
 * Serves dashboard/index.html plus its JS/CSS. The page is public, but the
 * APIs it polls sit behind the staff x-api-key, which the page prompts for.
 *
 * The route re-applies helmet with its own CSP because the app-wide default
 * blocks the Chart.js CDN: scripts are limited to this origin and
 * cdn.jsdelivr.net, and there is no inline script or style anywhere.
 */

const dashboardDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../dashboard',
);

const dashboardCsp = helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
            styleSrc: ["'self'"],
            imgSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            fontSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
            formAction: ["'self'"],
        },
    },
});

const router = Router();

router.use(dashboardCsp);
router.use(express.static(dashboardDir));

export default router;
