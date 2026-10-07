/**
 * Home GUI client (index page).
 *
 * Three jobs:
 *   1. health chips - one GET /health on load.
 *   2. simulation panel - posts to /simulate/message with the staff or
 *      sandbox key and renders the response (intent, replies, ticket/order,
 *      correlationId).
 *   3. sandbox keys - POST /simulate/keys mints a key that runs the full API
 *      against isolated demo data; the explore buttons and result links load
 *      staff endpoints inline with whichever key is in the input.
 *
 * The page is server-rendered; this script only enhances it. All rendering
 * uses textContent - API data is never injected as HTML. The staff key is
 * kept in sessionStorage under the same key as the dashboard, so entering
 * it once works on both pages.
 */
(() => {
  const KEY_STORAGE = 'lfm.staffApiKey';

  const $ = (id) => document.getElementById(id);

  let lastPayload = null; // last body sent, reused by "Resend as duplicate"

  /* ---------- helpers ---------- */

  function randomId() {
    return window.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function chip(label, kind = 'neutral') {
    const span = document.createElement('span');
    span.className = `chip ${kind}`;
    span.textContent = label;
    return span;
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

  /* ---------- simulation ---------- */

  function buildPayload({ reuseLast }) {
    if (reuseLast && lastPayload) {
      return { ...lastPayload, forceLlmFailure: $('force-llm-failure').checked };
    }

    const text = $('text').value.trim();
    const from = $('from').value.trim();
    const name = $('name').value.trim();

    if (!text) throw new Error('Enter a message first (or pick a scenario).');
    if (!from) throw new Error('Enter a sender phone number, e.g. +2348012345678.');

    const payload = { from, text, messageId: `sim-gui-${randomId()}` };
    if (name) payload.name = name;
    if ($('force-llm-failure').checked) payload.forceLlmFailure = true;
    return payload;
  }

  function renderJson(body) {
    $('result-json').textContent = JSON.stringify(body, null, 2);
    $('result').classList.remove('hidden');
  }

  function renderResult(body, status) {
    $('result-status').textContent = `- HTTP ${status}`;

    const summary = $('result-summary');
    summary.replaceChildren();

    const badges = document.createElement('div');
    badges.className = 'badges';
    if (body.duplicate) badges.append(chip('duplicate ignored', 'warn'));
    badges.append(chip(`intent: ${body.intent ?? 'none'}`, body.intent ? 'ok' : 'neutral'));
    if (body.classifierSource) badges.append(chip(`classifier: ${body.classifierSource}`));
    if (typeof body.confidence === 'number') {
      badges.append(chip(`confidence: ${Math.round(body.confidence * 100)}%`));
    }
    if (body.conversation) badges.append(chip(`conversation: ${body.conversation.state}`));
    summary.append(badges);

    const replies = Array.isArray(body.replies) ? body.replies : [];
    if (replies.length > 0) {
      const list = document.createElement('ul');
      list.className = 'replies';
      for (const text of replies) {
        const li = document.createElement('li');
        li.textContent = text;
        list.append(li);
      }
      summary.append(list);
    }

    const links = document.createElement('div');
    links.className = 'links';
    const addViewerLink = (label, href) => {
      const view = document.createElement('button');
      view.type = 'button';
      view.className = 'view-link';
      view.textContent = `view ${label}`;
      view.addEventListener('click', () => loadIntoViewer(href, label));
      links.append(view);

      const raw = document.createElement('a');
      raw.textContent = `${label} raw`;
      raw.href = href;
      raw.target = '_blank';
      raw.rel = 'noopener';
      links.append(raw);
    };
    if (body.ticketId) addViewerLink(`ticket ${body.ticketId}`, `/api/tickets/${body.ticketId}`);
    if (body.orderId) addViewerLink(`order ${body.orderId}`, `/api/orders/${body.orderId}`);
    if (body.correlationId) {
      addViewerLink(
        'audit trail for this message',
        `/api/audit?correlationId=${encodeURIComponent(body.correlationId)}`,
      );
    }
    if (links.childElementCount > 0) summary.append(links);

    renderJson(body);
  }

  async function sendSimulatedMessage({ reuseLast = false } = {}) {
    clearNotice();

    const apiKey = $('api-key').value.trim();
    if (!apiKey) {
      showNotice('Enter an API key first, or click "Generate sandbox key" to mint one.');
      return;
    }
    sessionStorage.setItem(KEY_STORAGE, apiKey);

    let payload;
    try {
      payload = buildPayload({ reuseLast });
    } catch (err) {
      showNotice(err.message);
      return;
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
        renderJson(body);
        return;
      }

      lastPayload = payload;
      $('resend').disabled = false;
      renderResult(body, res.status);
    } catch (err) {
      showNotice(`Request failed: ${err.message}`, 'danger');
    } finally {
      $('send').disabled = false;
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
        `Sandbox key created and filled in above (${body.keyPrefix}...). It is shown only this ` +
          'once. Requests with it run the full API against isolated demo data - nothing here ' +
          `touches live data. Valid until ${until}.`,
        'ok',
      );
      // The plaintext key is never retrievable again: show the full payload once.
      renderJson(body);
    } catch (err) {
      showNotice(`Key generation failed: ${err.message}`, 'danger');
    } finally {
      button.disabled = false;
    }
  }

  /* ---------- API viewer ---------- */

  let viewerRequest = 0;

  async function loadIntoViewer(endpoint, label = endpoint) {
    clearNotice();
    const apiKey = $('api-key').value.trim();
    if (!apiKey) {
      showNotice('Enter or generate an API key first - these endpoints expect x-api-key.');
      return;
    }

    const viewer = $('viewer');
    viewer.classList.remove('hidden');
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

  /* ---------- boot ---------- */

  function wire() {
    $('api-key').value = sessionStorage.getItem(KEY_STORAGE) ?? '';

    $('sim-form').addEventListener('submit', (event) => {
      event.preventDefault();
      sendSimulatedMessage();
    });
    $('resend').addEventListener('click', () => sendSimulatedMessage({ reuseLast: true }));
    $('generate-key').addEventListener('click', generateKey);

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
