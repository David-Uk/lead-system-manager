import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const app = createApp();

const server = app.listen(env.PORT, () => {
  logger.info(
    {
      port: env.PORT,
      env: env.NODE_ENV,
      whatsappMode: env.WHATSAPP_MODE,
      llmProvider: env.LLM_PROVIDER,
    },
    `lead-system-manager listening on http://localhost:${env.PORT} (health: /health)`,
  );
});

// Start listening first, then connect: when MongoDB is down the server
// stays up, /health reports 503/degraded and the connection retries in the
// background instead of crash-looping.
const connected = await connectDb();
if (!connected) {
  logger.warn('started without MongoDB - /health will report down until it recovers');
}

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutdown requested');

  // Hard exit if connections refuse to drain in time.
  const forceExit = setTimeout(() => {
    logger.error('graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async () => {
    await disconnectDb();
    logger.info('shutdown complete');
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
