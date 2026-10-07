/**
 * Reconciles MongoDB indexes with the current schemas.
 *
 * The sandbox-era index changes (compound unique { sandbox, ... } keys and
 * sandbox TTL indexes) replace older single-field unique indexes. Mongoose
 * autoIndex only builds missing indexes - it never drops stale ones - so any
 * database with existing data (including Atlas) needs this one-off run.
 *
 * Usage: node scripts/sync-indexes.js
 */
import mongoose from 'mongoose';
import { env } from '../src/config/env.js';
// Importing the models entry point registers every schema.
import * as models from '../src/models/index.js';

const NAMES = [
    'Customer',
    'Conversation',
    'Message',
    'Order',
    'Ticket',
    'AuditEvent',
    'Product',
    'SandboxKey',
];

async function main() {
    await mongoose.connect(env.MONGODB_URI);
    console.log(`Connected to ${env.MONGODB_URI.replace(/\/\/[^@]*@/, '//***@')}`);

    for (const name of NAMES) {
        const model = models[name] ?? mongoose.models[name];
        if (!model) {
            console.warn(`${name}: model not registered, skipped`);
            continue;
        }

        const dropped = await model.syncIndexes();
        const detail = dropped.length > 0 ? ` (dropped: ${dropped.join(', ')})` : '';
        console.log(`${name}: indexes synced${detail}`);
    }

    await mongoose.disconnect();
    console.log('Done.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
