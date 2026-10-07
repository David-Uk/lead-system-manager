import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { env } from '../config/env.js';

/**
 * Home GUI pages.
 *
 * GET / is content-negotiated: browsers (Accept: text/html) get the service
 * home (navigation + quick simulation), while API clients, curl and the test
 * suite (no Accept header) keep receiving the JSON signpost from
 * routes/index.js. GET /simulate serves the dedicated simulation workbench:
 * chat the pipeline, watch each stage, explore the data it creates.
 *
 * Both pages drive the existing /simulate/message and /simulate/keys
 * endpoints, so they add no API surface. Their JS/CSS are plain files under
 * home/ because the app-wide CSP (script-src 'self', no inline scripts)
 * allows nothing else.
 */

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

const homeDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../home',
);
const STYLE_FILE = path.join(homeDir, 'style.css');
const APP_FILE = path.join(homeDir, 'app.js');
const SIMULATE_JS_FILE = path.join(homeDir, 'simulate.js');

const navCards = [
    {
        href: '/simulate',
        title: 'Simulation workbench',
        path: '/simulate',
        description: 'Dedicated page for the entire workflow: chat as a customer, watch every pipeline stage, explore the data it creates.',
    },
    {
        href: '/dashboard/',
        title: 'Operations dashboard',
        path: '/dashboard',
        description: 'Metrics tiles, charts, open tickets and recent audit events - paste the staff key to load data.',
    },
    {
        href: '/docs',
        title: 'API reference',
        path: '/docs',
        description: 'RapiDoc rendering of the OpenAPI document, with try-it-out and auth.',
    },
    {
        href: '/openapi.json',
        title: 'OpenAPI document',
        path: '/openapi.json',
        description: 'The API spec that /docs consumes - feeds API tooling and the drift-guard test.',
    },
    {
        href: '/health',
        title: 'Health probe',
        path: '/health',
        description: '200 ok/degraded, 503 when MongoDB is down; live mongo / llm / notifier states.',
    },
    {
        href: '/api/orders',
        title: 'Orders API',
        path: '/api/orders',
        description: 'Staff order list created by the slot-filling flow (x-api-key).',
    },
    {
        href: '/api/tickets',
        title: 'Tickets API',
        path: '/api/tickets',
        description: 'Escalation queue with SLA and staff-notification flags (x-api-key).',
    },
    {
        href: '/api/metrics',
        title: 'Metrics API',
        path: '/api/metrics',
        description: 'Window figures plus a live backlog snapshot (x-api-key).',
    },
    {
        href: '/api/audit',
        title: 'Audit trail API',
        path: '/api/audit',
        description: 'Every pipeline event, keyset-paginated; filter with ?correlationId=... (x-api-key).',
    },
];

const navCardsHtml = navCards
    .map(
        (card) => `        <a class="card" href="${card.href}">
          <strong>${card.title}</strong>
          <span class="path">${card.path}</span>
          <p>${card.description}</p>
        </a>`,
    )
    .join('\n');

const webhookCardHtml = `        <div class="card static">
          <strong>Inbound webhook</strong>
          <span class="path">GET + POST /webhook</span>
          <p>Meta-signed customer traffic (handshake + messages). Not browser-driven - use the simulation panel instead.</p>
        </div>`;

const productionNotice =
    env.NODE_ENV === 'production'
        ? `      <div class="notice warn" role="note">
        <strong>Production deployment.</strong> The live staff key cannot run
        <code>POST /simulate/message</code> here (404 by design, workplan 8.3). Click
        <strong>Generate sandbox key</strong> below instead: sandbox keys run the full
        simulation - the same pipeline, tickets, audit and metrics APIs - against an isolated
        demo dataset and never read or write live data.
      </div>
`
        : '';

const scenarios = [
    ['Price check', 'How much is 5kg rice?'],
    ['Product enquiry', 'Do you have fresh tomatoes?'],
    ['Order flow - step 1', 'I want to order 2 bags of rice'],
    ['Order status', 'Where is my order?'],
    ['Complaint / refund', 'My last order arrived damaged, I want a refund.'],
];

const scenariosHtml = scenarios
    .map(
        ([label, text]) =>
            `<button type="button" class="scenario" data-text="${text}">${label}</button>`,
    )
    .join('\n            ');

const workbenchScenarios = [
    ['Price check', 'How much is 5kg rice?'],
    ['Milo price (demo product)', 'How much is a tin of Milo?'],
    ['Product enquiry', 'Do you have fresh tomatoes?'],
    ['Indomie stock (demo product)', 'Do you sell Indomie?'],
    ['Start an order', 'I want to order 2 crates of eggs'],
    ['Order status', 'Where is my order?'],
    ['Complaint / refund', 'My last order arrived damaged, I want a refund.'],
    ['Human handoff', 'I want to speak to a human'],
];

const workbenchScenariosHtml = workbenchScenarios
    .map(
        ([label, text]) =>
            `<button type="button" class="scenario" data-text="${text}">${label}</button>`,
    )
    .join('\n            ');

const homePage = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lead System Manager - home</title>
    <link rel="stylesheet" href="/ui/style.css" />
    <script src="/ui/app.js" defer></script>
  </head>
  <body data-env="${env.NODE_ENV}" data-version="${version}">
    <header class="topbar">
      <div class="brand">
        <h1>Lead System Manager</h1>
        <p class="subtitle">WhatsApp retail automation API - service home</p>
      </div>
      <div class="meta">
        <span class="chip">v${version}</span>
        <span class="chip ${env.NODE_ENV}">${env.NODE_ENV}</span>
        <span id="health-chips" class="chips" aria-live="polite">
          <span class="chip">health: checking...</span>
        </span>
      </div>
    </header>

    <main>
${productionNotice}      <section class="panel">
        <h2>Explore the service</h2>
        <div class="cards">
${navCardsHtml}
${webhookCardHtml}
        </div>
      </section>

      <section class="panel">
        <h2>Simulation <span class="muted">POST /simulate/message</span></h2>
        <p class="muted">
          Drives the full pipeline without WhatsApp - dedupe, persistence, classification, replies,
          order slot filling, tickets and audit. Works with the staff key, or click
          <strong>Generate sandbox key</strong> to mint a key scoped to isolated demo data: it runs
          the identical API and never touches live data. Every response carries a correlationId:
          replay it via GET /api/audit?correlationId=...
        </p>
        <form id="sim-form">
          <div class="row">
            <label>API key
              <input id="api-key" type="password" placeholder="staff key or sandbox key" autocomplete="off" />
            </label>
            <button
              id="generate-key"
              type="button"
              title="POST /simulate/keys - mints a sandbox key that runs the full API against isolated demo data"
            >
              Generate sandbox key
            </button>
            <label>From
              <input id="from" value="+2348012345678" spellcheck="false" />
            </label>
            <label>Name
              <input id="name" placeholder="optional" autocomplete="off" />
            </label>
          </div>
          <label class="block">Message
            <textarea id="text" rows="3" placeholder="e.g. How much is 5kg rice?"></textarea>
          </label>
          <div class="scenarios">
            <span class="muted">Scenarios:</span>
            ${scenariosHtml}
          </div>
          <div class="row actions">
            <label class="check">
              <input id="force-llm-failure" type="checkbox" />
              forceLlmFailure (demo failure #1: AI outage)
            </label>
            <button id="send" type="submit">Send simulated message</button>
            <button
              id="resend"
              type="button"
              disabled
              title="Re-sends the last message with the same messageId to exercise the dedupe path"
            >
              Resend as duplicate
            </button>
          </div>
        </form>
        <div id="notice" class="notice hidden" role="alert"></div>
        <div id="result" class="result hidden">
          <h3>Response <span class="muted" id="result-status"></span></h3>
          <div id="result-summary" class="summary"></div>
          <pre id="result-json"></pre>
        </div>
        <div class="scenarios">
          <span class="muted">Explore API data with this key:</span>
          <button type="button" class="scenario explore" data-endpoint="/api/orders">Orders</button>
          <button type="button" class="scenario explore" data-endpoint="/api/tickets">Tickets</button>
          <button type="button" class="scenario explore" data-endpoint="/api/metrics">Metrics</button>
          <button type="button" class="scenario explore" data-endpoint="/api/audit">Audit</button>
        </div>
        <div id="viewer" class="result hidden">
          <h3>API viewer <span class="muted" id="viewer-status"></span></h3>
          <pre id="viewer-json"></pre>
        </div>
      </section>
    </main>

    <footer>
      <span>Order flow demo: send the scenario, then answer with a delivery address and <code>YES</code> when the reply asks.</span>
      <span class="muted">Staff endpoints expect the <code>x-api-key</code> header.</span>
    </footer>
  </body>
</html>
`;

const simulatePage = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Lead System Manager - simulation workbench</title>
    <link rel="stylesheet" href="/ui/style.css" />
    <script src="/ui/simulate.js" defer></script>
  </head>
  <body data-env="${env.NODE_ENV}" data-version="${version}">
    <header class="topbar">
      <div class="brand">
        <h1>Simulation workbench</h1>
        <p class="subtitle">Run the entire workflow as a simulation - chat the pipeline, inspect every stage, explore what it creates</p>
      </div>
      <div class="meta">
        <span class="chip">v${version}</span>
        <span class="chip ${env.NODE_ENV}">${env.NODE_ENV}</span>
        <span id="health-chips" class="chips" aria-live="polite">
          <span class="chip">health: checking...</span>
        </span>
        <a class="chip" href="/">home GUI</a>
      </div>
    </header>

    <main class="workbench">
${productionNotice}      <section class="panel">
        <h2>1. Customer simulator <span class="muted">POST /simulate/message</span></h2>
        <p class="muted">
          Everything below runs the real pipeline against the key's dataset. Keep the same
          <code>From</code> phone to carry one conversation through the multi-turn order flow;
          use <strong>New customer</strong> to start fresh.
        </p>
        <div class="row">
          <label>API key
            <input id="api-key" type="password" placeholder="sandbox key or staff key" autocomplete="off" />
          </label>
          <button
            id="generate-key"
            type="button"
            title="POST /simulate/keys - mints a sandbox key that runs the full API against isolated demo data"
          >
            Generate sandbox key
          </button>
          <button id="new-customer" type="button" title="New phone number: starts a fresh conversation">
            New customer
          </button>
        </div>
        <div class="row">
          <label>From
            <input id="from" value="+2348012345678" spellcheck="false" />
          </label>
          <label>Name
            <input id="name" placeholder="optional" autocomplete="off" />
          </label>
        </div>
        <div id="chat" class="chat" aria-live="polite">
          <p class="muted chat-hint">Send a message or pick a scenario. The workflow runs dedupe, classification, intent handling and slot filling, and escalates to tickets when it cannot answer safely.</p>
        </div>
        <div class="scenarios">
          <span class="muted">Scenarios:</span>
          ${workbenchScenariosHtml}
        </div>
        <label class="block">Message
          <textarea id="text" rows="2" placeholder="e.g. How much is a tin of Milo?"></textarea>
        </label>
        <div class="row actions">
          <label class="check">
            <input id="force-llm-failure" type="checkbox" />
            forceLlmFailure (demo failure #1: AI outage)
          </label>
          <button id="send" type="button">Send message</button>
          <button
            id="resend"
            type="button"
            disabled
            title="Re-sends the last message with the same messageId to exercise the dedupe path"
          >
            Resend as duplicate
          </button>
        </div>
        <div id="notice" class="notice hidden" role="alert"></div>
      </section>

      <section class="panel">
        <h2>2. Workflow inspector <span class="muted">last message</span></h2>
        <div id="pipeline" class="stages">
          <p class="muted">Send a message - each pipeline stage is traced here.</p>
        </div>
        <div id="result-summary" class="summary"></div>
        <h3>Audit trail <span class="muted" id="audit-status">-</span></h3>
        <div id="audit-timeline" class="timeline">
          <p class="muted">The audit trail for the last message loads here automatically.</p>
        </div>
        <h3>Data viewer <span class="muted" id="viewer-status">-</span></h3>
        <pre id="viewer-json">Use the actions above - or the explore buttons below - to pull tickets, orders, metrics and audit into this viewer.</pre>
        <div class="scenarios">
          <span class="muted">Explore this key's data:</span>
          <button type="button" class="scenario explore" data-endpoint="/api/orders">Orders</button>
          <button type="button" class="scenario explore" data-endpoint="/api/tickets">Tickets</button>
          <button type="button" class="scenario explore" data-endpoint="/api/metrics">Metrics</button>
          <button type="button" class="scenario explore" data-endpoint="/api/audit">Audit</button>
        </div>
      </section>
    </main>

    <footer class="wide">
      <span>Order flow: send "I want to order 2 crates of eggs", answer the address question, then reply <code>YES</code> to confirm.</span>
      <span class="muted">Demo products the AI can track: Milo, Indomie, Golden Morn, sardines, stockfish, egusi, honey, sugar, tea, flour and more.</span>
    </footer>
  </body>
</html>
`;

const router = Router();

// Browsers ask for text/html; everything else falls through to the JSON
// signpost registered after this router in src/routes/index.js.
router.get('/', (req, res, next) => {
    if (!req.headers.accept?.includes('text/html')) {
        return next();
    }
    return res.type('html').send(homePage());
});

router.get('/ui/style.css', (req, res) => {
    res.sendFile(STYLE_FILE);
});

router.get('/ui/app.js', (req, res) => {
    res.sendFile(APP_FILE);
});

// Dedicated simulation workbench (browsers only; the /simulate API surface is
// POST-only, so non-HTML clients fall through to the 404 handler).
router.get('/simulate', (req, res, next) => {
    if (!req.headers.accept?.includes('text/html')) {
        return next();
    }
    return res.type('html').send(simulatePage());
});

router.get('/ui/simulate.js', (req, res) => {
    res.sendFile(SIMULATE_JS_FILE);
});

export default router;
