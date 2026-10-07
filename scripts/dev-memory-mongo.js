import { MongoMemoryServer } from 'mongodb-memory-server';
import { logger } from '../src/utils/logger.js';

/**
 * Development convenience: starts a throwaway MongoDB on port 27017 so the
 * API and seed script run **without Docker or Atlas**.
 *
 * Data lives in memory and disappears when this process stops - use it for
 * demos and quick experiments, not for anything you want to keep.
 *
 * Usage (leave running in its own terminal):
 *   npm run dev:mongo
 */
const mongod = await MongoMemoryServer.create({
  instance: { port: 27017, dbName: 'lead_system_manager' },
});

logger.info(
  { uri: mongod.getUri('lead_system_manager') },
  'in-memory MongoDB running on port 27017 (data resets on exit, Ctrl+C to stop)',
);

async function stop(signal) {
  logger.info({ signal }, 'stopping in-memory MongoDB');
  await mongod.stop();
  process.exit(0);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));
