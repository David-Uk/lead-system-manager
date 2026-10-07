import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import path from 'node:path';
import { env, projectRoot } from '../src/config/env.js';

/**
 * Signs and POSTs a Meta-shaped webhook payload to the local API - the
 * missing link for testing POST /webhook by hand (Meta signs requests with
 * the app secret; this script reproduces that).
 *
 * Usage:
 *   node scripts/send-webhook.js
 *   node scripts/send-webhook.js --text "Do you have rice?" --id wamid.DEMO1
 *   node scripts/send-webhook.js --id wamid.DEMO1            # duplicate demo (failure #2)
 *   node scripts/send-webhook.js --bad-signature             # 401 demo (failure T9)
 *   node scripts/send-webhook.js my-payload.json --url http://localhost:3000/webhook --secret s3cret
 */

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i += 1;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file =
    typeof args._[0] === 'string'
      ? path.resolve(args._[0])
      : path.join(projectRoot, 'test_inputs', 'webhook-sample.json');
  const url = typeof args.url === 'string' ? args.url : 'http://localhost:3000/webhook';
  const secret = typeof args.secret === 'string' ? args.secret : env.WHATSAPP_APP_SECRET;

  const payload = JSON.parse(await readFile(file, 'utf8'));
  const message = payload?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

  if (message) {
    if (typeof args.from === 'string') message.from = args.from.replace(/^\+/, '');
    if (typeof args.id === 'string') message.id = args.id;
    if (typeof args.text === 'string') message.text = { body: args.text };
  }

  const body = JSON.stringify(payload);
  const signature = args['bad-signature']
    ? 'deadbeef'.repeat(8)
    : createHmac('sha256', secret).update(body).digest('hex');

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': `sha256=${signature}`,
    },
    body,
  });

  console.log(`POST ${url}`);
  console.log(`payload : ${file}`);
  console.log(`status  : ${response.status}`);
  console.log(`body    : ${await response.text()}`);

  process.exitCode = response.ok ? 0 : 1;
}

main().catch((err) => {
  console.error(`send-webhook failed: ${err.message}`);
  console.error('Is the server running? (npm run dev) Is --url correct?');
  process.exitCode = 1;
});
