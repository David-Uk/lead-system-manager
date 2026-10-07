import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

const MAX_RETRY_DELAY_MS = 30_000;
const BASE_RETRY_DELAY_MS = 1_000;

let retryTimer = null;
let stopped = false;

mongoose.connection.on('connected', () => logger.info('mongodb connected'));
mongoose.connection.on('disconnected', () => logger.warn('mongodb disconnected'));
mongoose.connection.on('error', (err) => logger.debug({ err }, 'mongodb connection error'));

/** Returns 'up' when the driver has an established connection. */
export function getDbState() {
    return mongoose.connection.readyState === 1 ? 'up' : 'down';
}

function clearRetryTimer() {
    if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
    }
}

/**
 * Connects to MongoDB.
 *
 * With `retry: true` (default, used by the server) a failed first attempt does
 * not throw: the server keeps listening, /health reports `down`, and a
 * background retry loop with exponential backoff keeps trying. With
 * `retry: false` (used by the seed CLI) the first failure throws.
 *
 * @returns {Promise<boolean>} true when connected on this first attempt.
 */
export async function connectDb({ retry = true } = {}) {
    stopped = false;
    try {
        await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
        return true;
    } catch (err) {
        if (!retry) throw err;
        logger.warn({ err: err.message }, 'mongodb connection failed, will retry in background');
        scheduleRetry(1);
        return false;
    }
}

function scheduleRetry(attempt) {
    clearRetryTimer();
    const delay = Math.min(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1), MAX_RETRY_DELAY_MS);
    retryTimer = setTimeout(async () => {
        if (stopped) return;
        try {
            await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5_000 });
        } catch (err) {
            logger.warn(
                { attempt, delayMs: delay, err: err.message },
                'mongodb retry failed, will retry again',
            );
            scheduleRetry(attempt + 1);
        }
    }, delay);
    // Do not keep the event loop (and test processes) alive just for retries.
    retryTimer.unref?.();
}

/** Stops retries and closes the connection (graceful shutdown). */
export async function disconnectDb() {
    stopped = true;
    clearRetryTimer();
    if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
    }
}
