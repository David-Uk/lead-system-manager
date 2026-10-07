import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Product } from '../src/models/product.model.js';
import { logger } from '../src/utils/logger.js';
import { products } from './data/products.js';

/**
 * Upserts the synthetic catalogue by SKU (idempotent: safe to run repeatedly).
 *
 * @param {object} [options]
 * @param {boolean} [options.reset] - delete all products first
 * @param {object}  [options.log]   - logger to use (injected in tests)
 * @returns {Promise<{total: number, inserted: number, updated: number}>}
 */
export async function seedProducts({ reset = false, log = logger } = {}) {
    if (reset) {
        const deleted = await Product.deleteMany({});
        log.warn({ deleted: deleted.deletedCount }, 'products collection cleared (--reset)');
    }

    let inserted = 0;
    let updated = 0;

    for (const product of products) {
        const result = await Product.updateOne(
            { sku: product.sku },
            { $set: product },
            { upsert: true },
        );
        if (result.upsertedCount > 0) inserted += 1;
        else updated += 1;
    }

    return { total: products.length, inserted, updated };
}

async function main() {
    const reset = process.argv.includes('--reset');
    try {
        await connectDb({ retry: false });
        const summary = await seedProducts({ reset });
        logger.info(summary, 'catalogue seeded');
    } catch (err) {
        logger.error(
            { err: err.message },
            'seed failed - is MongoDB running? (docker compose up -d mongo)',
        );
        process.exitCode = 1;
    } finally {
        await disconnectDb();
    }
}

// Only run when executed directly (not when imported by tests).
const isDirectRun =
    process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
    main();
}
