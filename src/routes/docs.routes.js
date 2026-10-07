import { createRequire } from 'node:module';
import { Router } from 'express';
import helmet from 'helmet';
import openApiDocument from '../openapi/document.js';

/**
 * API reference (workplan 8, T-016).
 *
 *   GET /openapi.json            the hand-authored OpenAPI 3.0 document
 *   GET /docs                    RapiDoc rendering of that document
 *   GET /docs/vendor/rapidoc-min.js   RapiDoc bundle served from node_modules
 *
 * The docs page is public (the document contains no secrets); staff
 * endpoints documented inside it still require the x-api-key.
 *
 * Both routes re-apply helmet with a docs-specific CSP: RapiDoc is a web
 * component that injects its own styles, which the app-wide default CSP
 * would reject as inline styles.
 */

const require = createRequire(import.meta.url);
const rapidocAsset = require.resolve('rapidoc/dist/rapidoc-min.js');

const docsCsp = helmet({
    contentSecurityPolicy: {
        useDefaults: false,
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'https:'],
            fontSrc: ["'self'", 'data:'],
            connectSrc: ["'self'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"],
        },
    },
});

const rapidocPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lead System Manager API - RapiDoc</title>
    <script type="module" src="/docs/vendor/rapidoc-min.js"></script>
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <rapi-doc
      spec-url="/openapi.json"
      render-style="read"
      schema-style="table"
      show-header="true"
      allow-try="true"
      allow-authentication="true"
      theme="light"
    ></rapi-doc>
  </body>
</html>
`;

const router = Router();

router.use(docsCsp);

router.get('/openapi.json', (req, res) => {
    res.status(200).json(openApiDocument);
});

router.get('/docs', (req, res) => {
    res.type('html').send(rapidocPage);
});

router.get('/docs/vendor/rapidoc-min.js', (req, res) => {
    res.sendFile(rapidocAsset);
});

export default router;
