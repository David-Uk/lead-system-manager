import { randomUUID } from 'node:crypto';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { maskPhone, toWaId } from '../utils/phone.js';

/**
 * WhatsApp channel adapter (workplan section 6 + docs/DECISIONS.md).
 *
 * Modes:
 *  - "simulated" (default): messages are logged to stdout and appended as
 *    JSON lines to logs/whatsapp-outbound.log instead of being sent. This is
 *    the demo/reviewer mode - no Meta account needed.
 *  - "cloud": real sends through the Meta WhatsApp Cloud API (Graph API).
 *
 * The same adapter is used for customer replies and staff notifications
 * (DECISIONS.md: staff alerts go through WhatsApp, not Telegram).
 *
 * Contract: sendText never throws. It resolves to
 *   { ok, mode, providerMessageId, error }
 * so callers implement retry/failure handling (workplan failure #3).
 */

const SEND_TIMEOUT_MS = 10_000;

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Path of the simulated outbound log (also used by tests). */
export const OUTBOUND_LOG_FILE = path.join(projectRoot, 'logs', 'whatsapp-outbound.log');

async function appendOutboundLog(entry) {
  try {
    await mkdir(path.dirname(OUTBOUND_LOG_FILE), { recursive: true });
    await appendFile(OUTBOUND_LOG_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (err) {
    // The log file is an observability convenience; never fail a send for it.
    logger.warn({ err }, 'could not append to simulated outbound log');
  }
}

function forcedFailure() {
  return env.WHATSAPP_FORCE_SEND_FAILURE;
}

async function simulateSend(to, text) {
  const providerMessageId = `sim-out-${randomUUID()}`;
  const at = new Date().toISOString();

  logger.info(
    { to: maskPhone(to), chars: text.length, providerMessageId },
    'whatsapp message (simulated send)',
  );
  await appendOutboundLog({ at, mode: 'simulated', to, text, providerMessageId });

  return { ok: true, mode: 'simulated', providerMessageId, error: null };
}

async function cloudSend(to, text) {
  const url = `https://graph.facebook.com/${env.WHATSAPP_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: toWaId(to),
        type: 'text',
        text: { preview_url: false, body: text },
      }),
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = payload?.error?.message ?? `HTTP ${response.status}`;
      logger.error({ status: response.status, error }, 'whatsapp cloud send failed');
      return { ok: false, mode: 'cloud', providerMessageId: null, error };
    }

    return {
      ok: true,
      mode: 'cloud',
      providerMessageId: payload?.messages?.[0]?.id ?? null,
      error: null,
    };
  } catch (err) {
    const error = err.name === 'AbortError' ? `timeout after ${SEND_TIMEOUT_MS}ms` : err.message;
    logger.error({ error }, 'whatsapp cloud send failed');
    return { ok: false, mode: 'cloud', providerMessageId: null, error };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends a text message to a customer or staff number.
 *
 * @param {string} to - E.164 phone number (e.g. +2348012345678)
 * @param {string} text - message body
 * @returns {Promise<{ok: boolean, mode: 'simulated'|'cloud', providerMessageId: string|null, error: string|null}>}
 */
export async function sendText(to, text) {
  if (typeof to !== 'string' || typeof text !== 'string' || !to || !text) {
    return {
      ok: false,
      mode: env.WHATSAPP_MODE,
      providerMessageId: null,
      error: 'invalid_argument',
    };
  }

  // Test hook for the notification-failure path (workplan failure #3/T10).
  if (forcedFailure()) {
    logger.warn({ to: maskPhone(to) }, 'whatsapp send forced to fail (WHATSAPP_FORCE_SEND_FAILURE)');
    return {
      ok: false,
      mode: env.WHATSAPP_MODE,
      providerMessageId: null,
      error: 'forced_send_failure',
    };
  }

  return env.WHATSAPP_MODE === 'cloud' ? cloudSend(to, text) : simulateSend(to, text);
}
