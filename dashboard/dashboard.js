/**
 * Operations dashboard client (workplan 8.17, T-015).
 *
 * Static page over three staff APIs, refreshed every 10 seconds:
 *   /api/metrics           tiles + charts
 *   /api/tickets?status=open   open ticket queue (SLA + notification flags)
 *   /api/audit?limit=20    recent audit trail
 *
 * The APIs sit behind the shared x-api-key; the operator pastes the key
 * once and it is kept in sessionStorage only. All rendering uses
 * textContent - audit details and summaries are never injected as HTML.
 */
(() => {
  const REFRESH_MS = 10_000;
  const KEY_STORAGE = 'lfm.staffApiKey';

  const $ = (id) => document.getElementById(id);

  let apiKey = sessionStorage.getItem(KEY_STORAGE) ?? '';
  let intentChart = null;
  let classifierChart = null;
  let inFlight = false;

  const chartsAvailable = () => typeof window.Chart !== 'undefined';

  /* ---------- fetch ---------- */

  class ApiError extends Error {
    constructor(status, message) {
      super(message);
      this.status = status;
    }
  }

  async function fetchJson(path) {
    const res = await fetch(path, { headers: { 'x-api-key': apiKey } });

    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        message = body?.error?.message ?? message;
      } catch {
        /* keep the status message */
      }
      throw new ApiError(res.status, message);
    }

    return res.json();
  }

  /* ---------- formatting ---------- */

  const fmtInt = (value) => new Intl.NumberFormat('en-NG').format(value ?? 0);
  const fmtRate = (rate) => `${Math.round((rate ?? 0) * 100)}%`;
  const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms ?? 0} ms`);
  const prettyKey = (key) => String(key).replace(/_/g, ' ');

  function relativeTime(iso) {
    if (!iso) return '-';
    const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  function describeDetail(detail) {
    if (!detail || typeof detail !== 'object') return '';
    return Object.entries(detail)
      .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
      .slice(0, 4)
      .map(([key, value]) => `${key}=${value}`)
      .join('  ');
  }

  /* ---------- small DOM builders ---------- */

  function cell(text, className = null) {
    const td = document.createElement('td');
    td.textContent = text;
    if (className) td.className = className;
    return td;
  }

  function badgeCell(text, kind) {
    const td = document.createElement('td');
    const span = document.createElement('span');
    span.className = `badge ${kind}`;
    span.textContent = text;
    td.append(span);
    return td;
  }

  function emptyRow(colspan, text) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = colspan;
    td.className = 'empty';
    td.textContent = text;
    tr.append(td);
    return tr;
  }

  const notificationBadge = (status) => {
    if (status === 'sent') return ['sent', 'ok'];
    if (status === 'failed') return ['failed', 'danger'];
    return [status ?? 'pending', 'neutral'];
  };

  /* ---------- renderers ---------- */

  function renderTiles(metrics, tickets) {
    const entries = [
      { label: 'Messages (window)', value: fmtInt(metrics.totalMessages) },
      { label: 'Conversations (window)', value: fmtInt(metrics.totalConversations) },
      { label: 'Orders created', value: fmtInt(metrics.ordersCreated) },
      { label: 'Escalation rate', value: fmtRate(metrics.escalationRate) },
      { label: 'Avg auto-response', value: fmtMs(metrics.avgAutoResponseMs) },
      { label: 'Avg first human response', value: `${metrics.avgFirstHumanResponseMin} min` },
      { label: 'Open tickets', value: fmtInt(tickets.total) },
      {
        label: 'Overdue tickets',
        value: fmtInt(metrics.tickets.overdue),
        alert: metrics.tickets.overdue > 0,
      },
      { label: 'Unresolved conversations', value: fmtInt(metrics.unresolvedConversations) },
      {
        label: 'Notification failures',
        value: fmtInt(metrics.failures.notificationFailures),
        alert: metrics.failures.notificationFailures > 0,
      },
      { label: 'LLM failures (fallbacks)', value: fmtInt(metrics.failures.llmFailures) },
      { label: 'Resolved tickets', value: fmtInt(metrics.tickets.resolved) },
    ];

    const tiles = entries.map(({ label, value, alert }) => {
      const tile = document.createElement('article');
      tile.className = alert ? 'tile alert' : 'tile';

      const valueEl = document.createElement('p');
      valueEl.className = 'value';
      valueEl.textContent = value;

      const labelEl = document.createElement('p');
      labelEl.className = 'label';
      labelEl.textContent = label;

      tile.append(valueEl, labelEl);
      return tile;
    });

    $('tiles').replaceChildren(...tiles);
  }

  function renderCharts(metrics) {
    if (!chartsAvailable()) return;

    const intentLabels = Object.keys(metrics.intentBreakdown).map(prettyKey);
    const intentValues = Object.values(metrics.intentBreakdown);

    if (!intentChart) {
      intentChart = new window.Chart($('intent-chart'), {
        type: 'bar',
        data: {
          labels: intentLabels,
          datasets: [{ label: 'Messages', data: intentValues, backgroundColor: '#2f855a' }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
        },
      });
    } else {
      intentChart.data.labels = intentLabels;
      intentChart.data.datasets[0].data = intentValues;
      intentChart.update();
    }

    const mixValues = [
      metrics.classifier.rules,
      metrics.classifier.llm,
      metrics.classifier.fallback,
    ];

    if (!classifierChart) {
      classifierChart = new window.Chart($('classifier-chart'), {
        type: 'doughnut',
        data: {
          labels: ['Rules', 'LLM', 'Fallback'],
          datasets: [
            {
              data: mixValues,
              backgroundColor: ['#2f855a', '#2b6cb0', '#b7791f'],
              borderWidth: 1,
            },
          ],
        },
        options: { responsive: true, maintainAspectRatio: false, cutout: '62%' },
      });
    } else {
      classifierChart.data.datasets[0].data = mixValues;
      classifierChart.update();
    }
  }

  function renderTickets(payload) {
    $('tickets-total').textContent = `${payload.total} total`;
    const tbody = $('tickets-body');

    if (payload.data.length === 0) {
      tbody.replaceChildren(emptyRow(7, 'No open tickets.'));
      return;
    }

    const rows = payload.data.map((ticket) => {
      const tr = document.createElement('tr');
      const [notifiedText, notifiedKind] = notificationBadge(ticket.notificationStatus);

      tr.append(
        cell(ticket.ticketId),
        cell(prettyKey(ticket.reason)),
        cell(ticket.priority),
        cell(ticket.assignee ?? '-'),
        badgeCell(notifiedText, notifiedKind),
        ticket.overdue ? badgeCell('overdue', 'danger') : cell('ok'),
        cell(relativeTime(ticket.createdAt)),
      );
      return tr;
    });

    tbody.replaceChildren(...rows);
  }

  function renderAudit(payload) {
    const tbody = $('audit-body');

    if (payload.data.length === 0) {
      tbody.replaceChildren(emptyRow(5, 'No audit events yet.'));
      return;
    }

    const rows = payload.data.map((event) => {
      const tr = document.createElement('tr');
      const entity = event.entityId ? `${event.entityType}: ${event.entityId}` : event.entityType;

      tr.append(
        cell(new Date(event.createdAt).toLocaleTimeString([], { hour12: false })),
        cell(event.type),
        cell(entity, 'detail'),
        cell(describeDetail(event.detail), 'detail'),
        cell(String(event.correlationId ?? '').slice(0, 8)),
      );
      return tr;
    });

    tbody.replaceChildren(...rows);
  }

  /* ---------- notice + status ---------- */

  function showNotice(text, kind) {
    const notice = $('notice');
    notice.textContent = text;
    notice.className = `notice ${kind}`;
  }

  function hideNotice() {
    $('notice').className = 'notice hidden';
  }

  function setStatus(text) {
    $('status').textContent = text;
  }

  /* ---------- refresh loop ---------- */

  async function refresh() {
    if (!apiKey) {
      showNotice('Enter the staff API key (x-api-key) to load live data.', 'warn');
      setStatus('no API key set');
      return;
    }
    if (inFlight) return;
    inFlight = true;

    try {
      const [metrics, tickets, audit] = await Promise.all([
        fetchJson('/api/metrics'),
        fetchJson('/api/tickets?status=open&limit=20'),
        fetchJson('/api/audit?limit=20'),
      ]);

      hideNotice();
      renderTiles(metrics, tickets);
      renderCharts(metrics);
      renderTickets(tickets);
      renderAudit(audit);

      const suffix = chartsAvailable() ? '' : ' - charts unavailable (CDN blocked)';
      setStatus(`updated ${new Date().toLocaleTimeString()}${suffix}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        showNotice('API key missing or invalid. Paste the STAFF_API_KEY value.', 'danger');
        setStatus('unauthorised');
      } else {
        showNotice(`Could not load data: ${err.message}`, 'danger');
        setStatus('load failed');
      }
    } finally {
      inFlight = false;
    }
  }

  /* ---------- wiring ---------- */

  $('api-key').value = apiKey;
  $('api-key').addEventListener('change', () => {
    apiKey = $('api-key').value.trim();
    sessionStorage.setItem(KEY_STORAGE, apiKey);
    refresh();
  });
  $('refresh').addEventListener('click', refresh);

  setInterval(() => {
    if (!document.hidden) refresh();
  }, REFRESH_MS);

  refresh();
})();
