import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/**
 * Starts an in-memory MongoDB for the current test file and connects
 * Mongoose to it. No live database needed to run the suite.
 */
export async function startTestDb() {
  const mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('lead_system_manager_test'));
  return mongod;
}

/** Disconnects Mongoose and stops the in-memory server. */
export async function stopTestDb(mongod) {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (mongod) {
    await mongod.stop();
  }
}

/** Empties every collection between tests. */
export async function clearDb() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((collection) => collection.deleteMany({})));
}
