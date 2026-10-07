/**
 * Simulation workbench client (GET /simulate).
 *
 * Runs the entire workflow as a simulation against the existing
 * /simulate/message + /simulate/keys endpoints - no extra API surface:
 *   1. Customer simulator - every send appends the customer bubble, posts
 *      the message and appends the pipeline's replies as agent bubbles.
 *      "New customer" rotates the phone number so the multi-turn order
 *      flow can be started over; "Resend as duplicate" replays the last
 *      messageId to exercise dedupe.
 *   2. Workflow inspector - renders the pipeline stages derived from the
 *      response (received, dedupe, classification, routing, outcome),
 *      auto-loads the audit trail for the response correlationId, and can
 *      pull tickets/orders/metrics/audit into the data viewer.
 *
 * Same conventions as the home GUI (home/app.js): server-rendered page,
 * textContent only (API data is never injected as HTML), and the API key
 * is kept in sessionStorage under the same key as the home page and
 * dashboard so it only needs to be entered (or generated) once.
 */
(() => {
  const KEY_STORAGE = 'lfm.staffApiKey';

  // Conversation states that mean the order slot-filling machine is
  // waiting for the next customer reply (no fresh classification pass).
  const SLOT_FILLING_STATES = [
    'COLLECT_ITEM',
    'COLLECT_QTY',
    'COLLECT_ADDRESS',
    'COLLECT_PHONE',
    'CONFIRM',
  ];

  const $ = (id) => document.getElementById(id);

  let lastPayload = null; // last body sent, reused by "Resend as duplicate"

  /* ---------- helpers ---------- */

  function randomId() {
    return window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function randomPhone() {
    let digits = '80';
    for (let i = 0; i < 8; i += 1) digits += Math.floor(Math.random() * 10);
    return `+234${digits}`;
  }

  function chip(label, kind = 'neutral') {
    const span = document.createElement('span');
    span.className = `chip ${kind}`;
    span.textContent = label;
    return span;
  }

  function note(text, className = 'muted') {
    const p = document.createElement('p');
    p.className = className;
    p.textContent = text;
    return p;
  }

  function showNotice(text, kind = 'warn') {
    const el = $('notice');
    el.textContent = text;
    el.className = `notice ${kind}`;
  }

  function clearNotice() {
    const el = $('notice');
    el.className = 'notice hidden';
    el.textContent = '';
  }

  function appendBubble(kind, text) {
    const chat = $('chat');
    chat.querySelector('.chat-hint')?.remove();
    const bubble = document.createElement('div');
    bubble.className = `bubble ${kind}`;
    bubble.textContent = text;
    chat.append(bubble);
    chat.scrollTop = chat.scrollHeight;
  }

  /* ---------- health chips ---------- */

  async function loadHealth() {
    const el = $('health-chips');
    try {
      const res = await fetch('/health');
      const body = await res.json();
      const checks = body.checks ?? {};
      const rows = [
        [`status: ${body.status ?? 'unknown'}`, body.status === 'ok' ? 'ok' : 'danger'],
        [`mongo: ${checks.mongo ?? '?'}`, checks.mongo === 'up' ? 'ok' : 'danger'],
        [
          `llm: ${checks.llm ?? '?'}`,
          checks.llm === 'up' ? 'ok' : checks.llm === 'disabled' ? 'neutral' : 'danger',
        ],
        [`notifier: ${checks.notifier ?? '?'}`, checks.notifier === 'up' ? 'ok' : 'danger'],
      ];
      el.replaceChildren(...rows.map(([label, kind]) => chip(label, kind)));
    } catch {
      el.replaceChildren(chip('health: unreachable', 'danger'));
    }
  }

  /* ---------- pipeline stages ---------- */

  function stage(kind, title, detail) {
    const el = document.createElement('div');
    el.className = `stage ${kind}`;

    const dot = document.createElement('span');
    dot.className = 'dot';

    const body = document.createElement('div');
    const strong = document.createElement('strong');
    strong.textContent = title;
    body.append(strong, note(detail, ''));

    el.append(dot, body);
    return el;
  }

  function renderPipeline(body) {
    const stages = [];
    const replyCount = Array.isArray(body.replies) ? body.replies.length : 0;

    stages.push(
      stage(
        'ok',
        'Received',
        `POST /simulate/message accepted - correlationId ${body.correlationId ?? 'n/a'}.`,
      ),
    );

    stages.push(
      body.duplicate
        ? stage('warn', 'Dedupe', 'Same messageId seen before - delivery ignored, no repeated side effects.')
        : stage('ok', 'Dedupe', 'New messageId - persisted exactly once, safe to replay.'),
    );

    const midSlotFilling = SLOT_FILLING_STATES.includes(body.conversation?.state);
    if (body.intent && typeof body.confidence === 'number') {
      const pct = `${Math.round(body.confidence * 100)}%`;
      stages.push(
        stage(
          'ok',
          'Classified',
          `${body.intent} (${pct} confidence via ${body.classifierSource ?? 'unknown'}).`,
        ),
      );
    } else if (body.intent) {
      // Slot-filling resume: the pipeline carries the order intent forward and
      // skips classification entirely (null confidence/source, workplan 5.1 step 6).
      stages.push(
        stage(
          'info',
          'Classified',
          `${body.intent} carried over from slot filling - classification skipped, no fresh confidence.`,
        ),
      );
    } else if (midSlotFilling) {
      stages.push(
        stage('info', 'Classified', 'Skipped - this reply resumes the in-progress order slot filling.'),
      );
    } else {
      stages.push(
        stage('neutral', 'Classified', 'No intent matched; conversation state decided the next step.'),
      );
    }

    stages.push(
      body.conversation
        ? stage(
            'ok',
            'Routed',
            `conversation ${body.conversation.id} - state ${body.conversation.state} (${body.conversation.status}).`,
          )
        : stage('neutral', 'Routed', 'No conversation attached to this delivery.'),
    );

    if (body.duplicate) {
      stages.push(
        stage('neutral', 'Outcome', 'Nothing to do - the original delivery already ran every side effect.'),
      );
    } else if (body.ticketId) {
      stages.push(
        stage('warn', 'Outcome', `Ticket ${body.ticketId} created - staff notified over WhatsApp (see /api/tickets).`),
      );
    } else if (body.orderId) {
      stages.push(
        stage('ok', 'Outcome', `Order ${body.orderId} created or updated by slot filling - keep replying with the same From number.`),
      );
    } else if (replyCount > 0) {
      stages.push(
        stage('ok', 'Outcome', `Answered with ${replyCount} ${replyCount === 1 ? 'reply' : 'replies'} - no staff escalation needed.`),
      );
    } else {
      stages.push(stage('neutral', 'Outcome', 'No reply or escalation was produced.'));
    }

    $('pipeline').replaceChildren(...stages);
  }

  /* ---------- result summary ---------- */

  function renderSummary(body, status) {
    const summary = $('result-summary');
    summary.replaceChildren();

    const badges = document.createElement('div');
    badges.className = 'badges';
    badges.append(chip(`HTTP ${status}`, 'ok'));
    if (body.duplicate) badges.append(chip('duplicate ignored', 'warn'));
    badges.append(chip(`intent: ${body.intent ?? 'none'}`, body.intent ? 'ok' : 'neutral'));
    if (body.classifierSource) badges.append(chip(`classifier: ${body.classifierSource}`));
    if (typeof body.confidence === 'number') {
      badges.append(chip(`confidence: ${Math.round(body.confidence * 100)}%`));
    }
    if (body.conversation) badges.append(chip(`conversation: ${body.conversation.state}`));
    summary.append(badges);

    const links = document.createElement('div');
    links.className = 'links';
    const addViewerLink = (label, href) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'view-link';
      button.textContent = `view ${label}`;
      button.addEventListener('click', () => loadIntoViewer(href, label));
      links.append(button);
    };
    if (body.ticketId) {
      addViewerLink(`ticket ${body.ticketId}`, `/api/tickets/${encodeURIComponent(body.ticketId)}`);
    }
    if (body.orderId) {
      addViewerLink(`order ${body.orderId}`, `/api/orders/${encodeURIComponent(body.orderId)}`);
    }
    if (links.childElementCount > 0) summary.append(links);
  }

  /* ---------- audit trail ---------- */

  function eventRow(event) {
    const row = document.createElement('div');
    row.className = 'event';

    const type = document.createElement('span');
    type.className = 'type';
    type.textContent = event.type ?? 'event';

    const entity = event.entityType
      ? `${event.entityType}${event.entityId ? ` ${event.entityId}` : ''}`
      : '';
    const when = event.createdAt ? new Date(event.createdAt).toLocaleTimeString() : '';
    const metaText = [when, event.actor, entity].filter(Boolean).join(' | ');

    row.append(type);
    if (metaText) row.append(note(metaText, 'meta'));

    if (event.detail && Object.keys(event.detail).length > 0) {
      const detail = document.createElement('pre');
      detail.textContent = JSON.stringify(event.detail);
      row.append(detail);
    }
    return row;
  }

  async function loadAudit(correlationId) {
    const apiKey = $('api-key').value.trim();
    const timeline = $('audit-timeline');
    $('audit-status').textContent = '- loading...';

    try {
      const res = await fetch(
        `/api/audit?correlationId=${encodeURIComponent(correlationId)}&limit=50`,
        { headers: { 'x-api-key': apiKey } },
      );
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        $('audit-status').textContent = `- HTTP ${res.status}`;
        timeline.replaceChildren(note('Audit trail unavailable for this key/dataset.'));
        return;
      }

      // The API pages newest-first; a trail reads oldest-first.
      const events = [...(body.data ?? [])].reverse();
      $('audit-status').textContent = `- ${events.length} event${events.length === 1 ? '' : 's'}`;
      const rows =
        events.length > 0
          ? events.map((event) => eventRow(event))
          : [note('No audit events for this correlationId yet.')];
      timeline.replaceChildren(...rows);
    } catch (err) {
      $('audit-status').textContent = '- failed';
      timeline.replaceChildren(note(`Audit request failed: ${err.message}`));
    }
  }

  /* ---------- data viewer ---------- */

  let viewerRequest = 0;

  async function loadIntoViewer(endpoint, label = endpoint) {
    const apiKey = $('api-key').value.trim();
    if (!apiKey) {
      showNotice('Enter or generate an API key first - staff endpoints expect x-api-key.');
      return;
    }

    const requestId = ++viewerRequest;
    $('viewer-status').textContent = `- GET ${label} ...`;

    try {
      const res = await fetch(endpoint, { headers: { 'x-api-key': apiKey } });
      const body = await res.json().catch(() => ({}));
      if (requestId !== viewerRequest) return; // a newer request superseded this one

      $('viewer-status').textContent = `- GET ${label} (HTTP ${res.status})`;
      $('viewer-json').textContent = JSON.stringify(body, null, 2);

      if (res.status === 401) {
        showNotice(
          'The key was rejected (401). Generate a sandbox key above or check the staff key.',
          'danger',
        );
      }
    } catch (err) {
      if (requestId !== viewerRequest) return;
      $('viewer-status').textContent = `- GET ${label} failed`;
      showNotice(`Viewer request failed: ${err.message}`, 'danger');
    }
  }

  /* ---------- sandbox keys ---------- */

  async function generateKey() {
    clearNotice();
    const button = $('generate-key');
    button.disabled = true;
    try {
      const res = await fetch('/simulate/keys', { method: 'POST' });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        showNotice(body?.error?.message ?? `Key generation failed (HTTP ${res.status})`, 'danger');
        return;
      }

      $('api-key').value = body.apiKey;
      sessionStorage.setItem(KEY_STORAGE, body.apiKey);

      const until = new Date(body.expiresAt).toLocaleString();
      showNotice(
        `Sandbox key created and filled in above (${body.keyPrefix}...). Requests with it run the ` +
          'full API against isolated demo data - nothing here touches live data. ' +
          `Valid until ${until}.`,
        'ok',
      );
      // The plaintext key is never retrievable again: show the full payload once.
      $('viewer-status').textContent = '- POST /simulate/keys (HTTP 201)';
      $('viewer-json').textContent = JSON.stringify(body, null, 2);
    } catch (err) {
      showNotice(`Key generation failed: ${err.message}`, 'danger');
    } finally {
      button.disabled = false;
    }
  }

  /* ---------- customer simulator ---------- */

  function newCustomer() {
    clearNotice();
    $('from').value = randomPhone();
    $('name').value = '';
    lastPayload = null;
    $('resend').disabled = true;

    $('chat').replaceChildren(
      note('Fresh customer - the next message starts a new conversation thread.', 'muted chat-hint'),
    );
    $('pipeline').replaceChildren(note('Send a message - each pipeline stage is traced here.'));
    $('result-summary').replaceChildren();
    $('audit-status').textContent = '-';
    $('audit-timeline').replaceChildren(note('The audit trail for the last message loads here automatically.'));
    $('viewer-status').textContent = '-';
    $('viewer-json').textContent =
      'Use the actions above - or the explore buttons below - to pull tickets, orders, metrics and audit into this viewer.';
  }

  async function sendMessage({ reuseLast = false } = {}) {
    clearNotice();

    const apiKey = $('api-key').value.trim();
    if (!apiKey) {
      showNotice('Enter an API key first, or click "Generate sandbox key" to mint one.');
      return;
    }
    sessionStorage.setItem(KEY_STORAGE, apiKey);

    let payload;
    if (reuseLast && lastPayload) {
      payload = { ...lastPayload, forceLlmFailure: $('force-llm-failure').checked };
      appendBubble('system', `Replaying "${payload.text}" with the same messageId (dedupe demo).`);
    } else {
      const text = $('text').value.trim();
      const from = $('from').value.trim();
      const name = $('name').value.trim();

      if (!text) {
        showNotice('Type a message first - or click a scenario chip.');
        return;
      }
      if (!from) {
        showNotice('Enter the customer phone, e.g. +2348012345678.');
        return;
      }

      payload = { from, text, messageId: `sim-workbench-${randomId()}` };
      if (name) payload.name = name;
      if ($('force-llm-failure').checked) payload.forceLlmFailure = true;
      appendBubble('customer', text);
    }

    $('send').disabled = true;
    try {
      const res = await fetch('/simulate/message', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));

      if (res.status === 404) {
        showNotice(
          'HTTP 404 - the live staff key cannot run the simulation on a production ' +
            'deployment (disabled by design, workplan 8.3). Click "Generate sandbox key", ' +
            'then send again: sandbox keys run the identical API against isolated demo data.',
        );
        return;
      }
      if (res.status === 401) {
        showNotice('The staff API key was rejected (401). Check STAFF_API_KEY in the server .env.', 'danger');
        return;
      }
      if (!res.ok) {
        const details = (body?.error?.details ?? [])
          .map((detail) => `${detail.path}: ${detail.message}`)
          .join('; ');
        showNotice(
          `${body?.error?.message ?? `HTTP ${res.status}`}${details ? ` - ${details}` : ''}`,
          'danger',
        );
        return;
      }

      lastPayload = payload;
      $('resend').disabled = false;
      if (!reuseLast) $('text').value = '';

      if (body.duplicate) {
        appendBubble('system', 'Duplicate delivery - the pipeline ignored it, so nothing ran twice.');
      }
      const replies = Array.isArray(body.replies) ? body.replies : [];
      for (const text of replies) appendBubble('agent', text);
      if (replies.length === 0 && !body.duplicate) {
        appendBubble('system', 'No customer reply for this delivery - the inspector shows what happened.');
      }

      renderPipeline(body);
      renderSummary(body, res.status);
      if (body.correlationId) await loadAudit(body.correlationId);
    } catch (err) {
      showNotice(`Request failed: ${err.message}`, 'danger');
    } finally {
      $('send').disabled = false;
    }
  }

  /* ---------- boot ---------- */

  function wire() {
    $('api-key').value = sessionStorage.getItem(KEY_STORAGE) ?? '';

    $('send').addEventListener('click', () => sendMessage());
    $('text').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
      }
    });
    $('resend').addEventListener('click', () => sendMessage({ reuseLast: true }));
    $('generate-key').addEventListener('click', generateKey);
    $('new-customer').addEventListener('click', newCustomer);

    for (const button of document.querySelectorAll('.scenario:not(.explore)')) {
      button.addEventListener('click', () => {
        $('text').value = button.dataset.text ?? '';
        $('text').focus();
      });
    }

    for (const button of document.querySelectorAll('.explore')) {
      button.addEventListener('click', () =>
        loadIntoViewer(button.dataset.endpoint, button.dataset.endpoint),
      );
    }
  }

  wire();
  loadHealth();
})();
