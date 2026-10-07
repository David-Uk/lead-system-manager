import './helpers/setup-env.mjs';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Product } from '../src/models/product.model.js';
import { seedProducts } from '../scripts/seed.js';
import { startTestDb, stopTestDb } from './helpers/testDb.js';

let mongod;

before(async () => {
    mongod = await startTestDb();
});

after(async () => {
    await stopTestDb(mongod);
});

describe('seed script (T-002)', () => {
    test('upserts the 42-product catalogue and is idempotent', async () => {
        const first = await seedProducts();
        assert.equal(first.total, 42);
        assert.equal(first.inserted, 42);
        assert.equal(await Product.countDocuments(), 42);

        const second = await seedProducts();
        assert.equal(second.inserted, 0);
        assert.equal(second.updated, 42);
        assert.equal(await Product.countDocuments(), 42);

        const rice = await Product.findOne({ sku: 'RICE-5KG' });
        assert.ok(rice);
        assert.equal(rice.priceNGN, 8500);
        assert.ok(rice.aliases.includes('bag of rice'));

        // Demo picks feed the workbench scenarios (e.g. "How much is a tin of Milo?").
        const milo = await Product.findOne({ sku: 'MILO-500G' });
        assert.ok(milo);
        assert.equal(milo.priceNGN, 3800);
        assert.ok(milo.aliases.includes('milo'));
    });

    test('reset clears stray products first', async () => {
        await Product.create({
            sku: 'STRAY-1',
            name: 'Stray item',
            category: 'Test',
            priceNGN: 1,
            stock: 1,
        });

        await seedProducts({ reset: true });

        assert.equal(await Product.countDocuments({ sku: 'STRAY-1' }), 0);
        assert.equal(await Product.countDocuments(), 42);
    });
});
