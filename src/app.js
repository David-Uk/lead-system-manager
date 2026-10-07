import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { correlationId } from './middleware/correlationId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';

/**
 * Builds the Express application. Kept separate from server.js so tests can
 * create an app without binding a port.
 */
export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1); // one reverse proxy in production (nginx/ALB)

  app.use(correlationId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => req.id,
      autoLogging: { ignore: (req) => req.url === '/health' },
      customLogLevel: (req, res, err) => {
        if (err || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      serializers: {
        req: (req) => ({ method: req.method, url: req.url, id: req.id }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
    }),
  );

  app.use(helmet());

  // JSON body parsing. The raw buffer is kept for HMAC signature
  // verification of the WhatsApp webhook (T-004).
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // Coarse abuse protection. Skipped in tests; the webhook has provider
  // retries, so the limit stays generous.
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    handler: (req, res) => {
      res.status(429).json({
        error: { code: 'RATE_LIMITED', message: 'Too many requests', details: [] },
        correlationId: req.id,
      });
    },
  });
  app.use(limiter);

  app.use(routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
