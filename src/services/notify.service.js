import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';
import { maskPhone } from '../utils/phone.js';
import * as templates from '../utils/templates.js';
import * as audit from './audit.service.js';
import * as ticketService from './ticket.service.js';
import { sendText } from './whatsapp.adapter.js';

/**
 * Staff notifier (workplan failure 4, T-014).
 *
 * Staff alerts go through the WhatsApp adapter (docs/DECISIONS.md: "Telegram"
 * means "WhatsApp staff notification" - there is no Telegram integration).
 * A new ticket is delivered to STAFF_WHATSAPP_NUMBER, in simulated mode that
 * means stdout plus logs/whatsapp-outbound.log.
 *
 * Delivery is best-effort and never throws: the ticket already exists when
 * this runs, and a notification failure must not change that. Up to
 * MAX_ATTEMPTS attempts with exponential backoff; the outcome is stored on
 * the ticket (`notificationStatus` sent/failed) and audited so the dashboard
 * can flag tickets nobody was alerted about.
 */

export const MAX_ATTEMPTS = 3;

/** Waits between attempt 1-2 and 2-3; tests inject shorter delays. */
export const RETRY_DELAYS_MS = [250, 500];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Notifies staff about a new ticket through the channel adapter.
 *
 * @param {object} args
 * @param {object} args.ticket - the created ticket document (status is updated in place)
 * @param {string} args.correlationId
 * @param {string|null} [args.customerPhone] - included in the alert for call-backs
 * @param {(to: string, text: string) => Promise<object>} [args.send] - injectable for tests
 * @param {number[]} [args.retryDelaysMs]
 * @param {object} [args.log]
 * @returns {Promise<{ok: boolean, attempts: number, error: string|null}>}
 */
export async function notifyStaffOfTicket({
    ticket,
    correlationId,
    customerPhone = null,
    send = sendText,
    retryDelaysMs = RETRY_DELAYS_MS,
    log = logger,
}) {
    const to = env.STAFF_WHATSAPP_NUMBER;
    const text = templates.staffTicketAlert(ticket, { customerPhone });

    let lastError = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        const result = await send(to, text);

        if (result.ok) {
            await ticketService.setNotificationStatus(ticket, 'sent');
            await audit.recordNotificationSent({
                correlationId,
                ticketId: ticket.ticketId,
                channel: 'whatsapp',
                to: maskPhone(to),
                attempts: attempt,
            });
            log.info({ ticketId: ticket.ticketId, attempts: attempt }, 'staff notification sent');
            return { ok: true, attempts: attempt, error: null };
        }

        lastError = result.error;
        log.warn(
            { ticketId: ticket.ticketId, attempt, error: result.error },
            'staff notification attempt failed',
        );

        const delay = retryDelaysMs[attempt - 1];
        if (attempt < MAX_ATTEMPTS && delay) await sleep(delay);
    }

    // Failure 4: retries exhausted - the ticket is flagged for the dashboard.
    await ticketService.setNotificationStatus(ticket, 'failed');
    await audit.recordNotificationFailed({
        correlationId,
        ticketId: ticket.ticketId,
        channel: 'whatsapp',
        to: maskPhone(to),
        attempts: MAX_ATTEMPTS,
        error: lastError,
    });
    log.error(
        { ticketId: ticket.ticketId, attempts: MAX_ATTEMPTS, error: lastError },
        'staff notification failed after all attempts',
    );
    return { ok: false, attempts: MAX_ATTEMPTS, error: lastError };
}
