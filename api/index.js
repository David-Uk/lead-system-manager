import express from 'express';
import { createApp } from '../src/app.js';
import { connectDb, getDbState } from '../src/config/db.js';

/**
 * Vercel serverless entry point. All traffic is rewritten here (see
 * vercel.json); the Express app itself is built exactly as server.js builds
 * it, so routes, middleware and error handling stay in one place.
 *
 * The only serverless-specific concern is MongoDB: function instances are
 * recycled, so the connection is opened lazily on the first request and
 * cached for the life of the instance. A failed attempt is not cached, so the
 * next request retries - and a request is never held longer than the
 * driver's 5s server selection timeout, which keeps /health able to report
 * `mongo: down` instead of hanging when the cluster is unreachable.
 */
const app = createApp();

let connectPromise = null;

function ensureDb() {
  if (getDbState() === 'up') return Promise.resolve(true);
  if (!connectPromise) {
    connectPromise = connectDb()
      .then((ok) => {
        if (!ok) connectPromise = null; // let the next request try again
        return ok;
      })
      .catch((err) => {
        connectPromise = null;
        throw err;
      });
  }
  return connectPromise;
}

const handler = express();

handler.use((req, res, next) => {
  // Never block a response on a dead database: /health still answers 503
  // with `mongo: down`, and data routes fail per request as designed.
  ensureDb().then(
    () => next(),
    () => next(),
  );
});

handler.use(app);

export default handler;
