import { createRequire } from 'node:module';
import { env } from '../config/env.js';
import { getDbState } from '../config/db.js';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

/**
 * GET /health (workplan 8.16).
 *
 *  - mongo down            -> 503 "down"
 *  - LLM or notifier down  -> 200 "degraded" (core still works)
 *  - everything up         -> 200 "ok"
 *
 * The LLM check is a configuration check for now (provider selected + key
 * present); deliberately not a live provider probe, which would spend a
 * request per health poll. The notifier check reflects the WhatsApp adapter:
 * simulated mode is operational by design.
 */
export function health(req, res) {
  const mongo = getDbState();

  let llm = 'disabled';
  if (env.LLM_PROVIDER !== 'none') {
    if (env.LLM_PROVIDER === 'ollama') {
      llm = env.OLLAMA_API_KEY ? 'up' : 'down'; // Ollama Cloud is keyed
    } else {
      llm = env.LLM_API_KEY ? 'up' : 'down';
    }
  }

  let notifier = 'disabled';
  if (env.WHATSAPP_MODE === 'simulated') {
    notifier = 'up';
  } else {
    notifier = env.WHATSAPP_ACCESS_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID ? 'up' : 'down';
  }

  let status = 'ok';
  if (mongo !== 'up') status = 'down';
  else if (llm === 'down' || notifier === 'down') status = 'degraded';

  const statusCode = status === 'down' ? 503 : 200;

  res.status(statusCode).json({
    status,
    uptimeSec: Math.round(process.uptime()),
    checks: { mongo, llm, notifier },
    version,
  });
}
