import './helpers/setup-env.mjs';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classify } from '../src/services/classifier/index.js';
import {
    LLM_INTENTS,
    buildFewShotExamples,
    buildSystemPrompt,
} from '../src/services/classifier/llm.js';
import { classifyWithRules } from '../src/services/classifier/rules.js';

const execFileAsync = promisify(execFile);
const scenarioScript = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    'helpers',
    'run-classifier-llm.mjs',
);

/** Mirrors the seeded catalogue entries the rules need for alias matching. */
const CATALOGUE = [
    {
        sku: 'RICE-5KG',
        name: 'Rice 5kg',
        aliases: ['rice', 'bag of rice', 'ofada rice'],
        priceNGN: 8500,
        stock: 40,
        active: true,
    },
    {
        sku: 'BEANS-1KG',
        name: 'Beans 1kg',
        aliases: ['beans', 'oloyin beans'],
        priceNGN: 2500,
        stock: 25,
        active: true,
    },
];

describe('rules classifier (workplan 4, step 1)', () => {
    test('T1: "Do you have rice?" -> product_enquiry via rules', async () => {
        const result = await classify('Do you have rice?', { products: CATALOGUE });

        assert.equal(result.intent, 'product_enquiry');
        assert.equal(result.source, 'rules');
        assert.ok(result.confidence >= 0.7);
        assert.equal(result.entities.productQuery, 'Rice 5kg');
    });

    test('T2: "How much is 5kg rice?" -> price_check with the product resolved', async () => {
        const result = await classify('How much is 5kg rice?', { products: CATALOGUE });

        assert.equal(result.intent, 'price_check');
        assert.equal(result.source, 'rules');
        assert.equal(result.entities.productQuery, 'Rice 5kg');
    });

    test('T3: "I want to order 2 bags of rice" -> place_order with quantity 2', async () => {
        const result = await classify('I want to order 2 bags of rice', { products: CATALOGUE });

        assert.equal(result.intent, 'place_order');
        assert.equal(result.source, 'rules');
        assert.equal(result.entities.quantity, 2);
        assert.equal(result.entities.productQuery, 'Rice 5kg');
    });

    test('T4: "Where is my order ORD-...?" -> order_status with the orderId entity', async () => {
        const result = await classify('Where is my order ORD-20261007-0001?', {
            products: CATALOGUE,
        });

        assert.equal(result.intent, 'order_status');
        assert.equal(result.source, 'rules');
        assert.equal(result.entities.orderId, 'ORD-20261007-0001');
    });

    test('T5: "My item came damaged, I want a refund" -> complaint_or_refund', async () => {
        const result = await classify('My item came damaged, I want a refund', {
            products: CATALOGUE,
        });

        assert.equal(result.intent, 'complaint_or_refund');
        assert.equal(result.source, 'rules');
        assert.ok(result.confidence >= 0.7);
    });

    test('pidgin price question also routes to price_check', async () => {
        const result = await classify('na how much be your rice?', { products: CATALOGUE });

        assert.equal(result.intent, 'price_check');
        assert.equal(result.source, 'rules');
    });

    test('ambiguous text without signals -> unknown fallback when the LLM is off', async () => {
        const result = await classify('hmm okay then', { products: CATALOGUE });

        assert.equal(result.intent, 'unknown');
        assert.equal(result.source, 'fallback');
        assert.equal(result.confidence, 0);
        assert.equal(result.failure, 'ai_unavailable');
    });

    test('forceLlmFailure behaves like an outage (T8 shape)', async () => {
        const result = await classify('hmm okay then', {
            products: CATALOGUE,
            forceLlmFailure: true,
        });

        assert.equal(result.intent, 'unknown');
        assert.equal(result.source, 'fallback');
        assert.equal(result.failure, 'ai_unavailable');
    });

    test('a weak rules signal survives an LLM outage (degraded but answered)', async () => {
        // "available" alone is a weak product_enquiry signal (0.675 < 0.7),
        // so the LLM would normally be consulted - with it out, rules decide.
        const result = await classify('amala available?', {
            products: CATALOGUE,
            forceLlmFailure: true,
        });

        assert.equal(result.intent, 'product_enquiry');
        assert.equal(result.source, 'rules');
        assert.ok(result.confidence < 0.7);
        assert.equal(result.failure, 'ai_unavailable');
    });

    test('multiple equally-strong products leave productQuery open for the handler', () => {
        const result = classifyWithRules('Do you have rice or beans?', CATALOGUE);

        assert.equal(result.intent, 'product_enquiry');
        assert.equal(result.entities.productQuery, null);
    });

    test('"What are the products available?" -> catalog_listing, not a product guess', async () => {
        const result = await classify('What are the products available?', { products: CATALOGUE });

        assert.equal(result.intent, 'catalog_listing');
        assert.equal(result.source, 'rules');
        assert.ok(result.confidence >= 0.7);
        assert.equal(result.entities.productQuery, null);
    });

    test('"What do you sell?" and its pidgin form both list the catalogue', () => {
        assert.equal(classifyWithRules('What do you sell?', CATALOGUE).intent, 'catalog_listing');
        assert.equal(classifyWithRules('wetin una dey sell?', CATALOGUE).intent, 'catalog_listing');
    });

    test('a named product demotes a listing phrase back to product_enquiry', () => {
        const result = classifyWithRules('what products do you have in rice?', CATALOGUE);

        assert.equal(result.intent, 'product_enquiry');
        assert.equal(result.entities.productQuery, 'Rice 5kg');
    });
});

describe('LLM adapter scenarios (mocked fetch, Ollama Cloud shape)', () => {
    async function runScenario(scenario, envOverrides = {}) {
        const { stdout } = await execFileAsync(process.execPath, [scenarioScript, scenario], {
            env: {
                ...process.env,
                LLM_PROVIDER: 'ollama',
                LLM_API_KEY: 'test-llm-key',
                OLLAMA_API_KEY: 'test-ollama-key',
                OLLAMA_BASE_URL: 'http://ollama.mock',
                LLM_TIMEOUT_MS: '500',
                ...envOverrides,
            },
            timeout: 30_000,
        });

        const lines = stdout.trim().split(/\r?\n/);
        return JSON.parse(lines.at(-1));
    }

    test('a confident LLM answer is used and the request targets Ollama Cloud shape', async () => {
        const { result, fetchCalls } = await runScenario('llm-ok');

        assert.equal(result.intent, 'complaint_or_refund');
        assert.equal(result.source, 'llm');
        assert.equal(result.confidence, 0.91);
        assert.equal(result.failure, null);

        assert.equal(fetchCalls.length, 1);
        const call = fetchCalls[0];
        assert.equal(call.url, 'http://ollama.mock/api/chat');
        assert.equal(call.headers.Authorization, 'Bearer test-ollama-key');

        const body = JSON.parse(call.body);
        assert.equal(body.model, 'gpt-oss:120b'); // default cloud model
        assert.equal(body.stream, false);
        assert.equal(body.format, 'json');
        assert.equal(body.options.temperature, 0);
        assert.equal(body.messages.length, 2);
        assert.equal(body.messages[0].role, 'system');
        assert.equal(body.messages[1].role, 'user');
        assert.match(body.messages[1].content, /hmm okay then/);
        // The randomized few-shot prompt rides inside the single system
        // message, so the untrusted text stays isolated in the user message.
        assert.match(body.messages[0].content, /Deduce the intent from the meaning/);
        assert.match(body.messages[0].content, /-> catalog_listing/);
    });

    test('a low-confidence LLM answer degrades to unknown (low_confidence)', async () => {
        const { result } = await runScenario('llm-low-confidence');

        assert.equal(result.intent, 'unknown');
        assert.equal(result.source, 'fallback');
        assert.equal(result.failure, 'low_confidence');
    });

    test('non-JSON LLM output degrades to ai_unavailable', async () => {
        const { result } = await runScenario('llm-invalid-json');

        assert.equal(result.intent, 'unknown');
        assert.equal(result.source, 'fallback');
        assert.equal(result.failure, 'ai_unavailable');
    });

    test('an HTTP error from the provider degrades to ai_unavailable', async () => {
        const { result } = await runScenario('llm-error');

        assert.equal(result.intent, 'unknown');
        assert.equal(result.source, 'fallback');
        assert.equal(result.failure, 'ai_unavailable');
    });

    test('a hanging provider is aborted by LLM_TIMEOUT_MS -> ai_unavailable', async () => {
        const { result } = await runScenario('llm-timeout');

        assert.equal(result.intent, 'unknown');
        assert.equal(result.source, 'fallback');
        assert.equal(result.failure, 'ai_unavailable');
    });
});

describe('classifier prompt (randomized few-shot)', () => {
    test('samples one random variant per intent, reshuffled per request', () => {
        const low = buildFewShotExamples(() => 0);
        const high = buildFewShotExamples(() => 0.999);

        assert.equal(low.length, LLM_INTENTS.length);
        assert.deepEqual(
            [...new Set(low.map((example) => example.intent))].sort(),
            [...LLM_INTENTS].sort(),
        );
        // The RNG drives which variant is sampled, so the two draws differ
        // while both still cover every intent.
        assert.notDeepEqual(low, high);
    });

    test('the system prompt teaches deduction and embeds an example per intent', () => {
        const prompt = buildSystemPrompt(() => 0);

        assert.match(prompt, /Deduce the intent from the meaning/);
        assert.match(prompt, /never copy them from the examples/);
        for (const intent of LLM_INTENTS) {
            assert.match(prompt, new RegExp(`-> ${intent}\\b`));
        }
        assert.match(prompt, /"intent": string/);
    });
});
