/**
 * Child-process harness for the LLM classifier scenarios in
 * tests/classifier.test.js. Mocks `fetch` before importing the classifier,
 * runs one classification of the same ambiguous text through every
 * scenario, and prints `{ result, fetchCalls }` as one JSON line so the
 * parent test can assert both behaviour and the outbound request shape.
 *
 * Environment is supplied by the parent (LLM_PROVIDER=ollama,
 * OLLAMA_BASE_URL=http://ollama.mock, ...).
 */
const scenario = process.argv[2];
const fetchCalls = [];

function respondJson(status, body) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });
}

globalThis.fetch = async (url, options = {}) => {
    fetchCalls.push({
        url: String(url),
        headers: options.headers ?? {},
        body: options.body ?? null,
    });

    switch (scenario) {
        case 'llm-ok':
            return respondJson(200, {
                model: 'gpt-oss:120b',
                message: {
                    role: 'assistant',
                    content: JSON.stringify({
                        intent: 'complaint_or_refund',
                        confidence: 0.91,
                        entities: { productQuery: null, quantity: null, orderId: null },
                    }),
                },
                done: true,
            });

        case 'llm-low-confidence':
            return respondJson(200, {
                message: {
                    role: 'assistant',
                    content: JSON.stringify({ intent: 'price_check', confidence: 0.2, entities: {} }),
                },
                done: true,
            });

        case 'llm-invalid-json':
            return respondJson(200, {
                message: { role: 'assistant', content: 'I think this is about rice 😀' },
                done: true,
            });

        case 'llm-error':
            return respondJson(500, { error: 'upstream exploded' });

        case 'llm-timeout':
            // Never resolves; only the classifier's AbortController stops it.
            return new Promise((resolve, reject) => {
                const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
                if (options.signal?.aborted) {
                    reject(abortError);
                    return;
                }
                options.signal?.addEventListener('abort', () => reject(abortError));
            });

        default:
            throw new Error(`unknown scenario: ${scenario}`);
    }
};

const { classify } = await import('../../src/services/classifier/index.js');

// "hmm okay then" has no rules signal, so every scenario exercises the LLM
// leg; llm-ok proves the happy path, the rest prove failure 1 degradation.
const result = await classify('hmm okay then', { products: [] });

console.log(JSON.stringify({ result, fetchCalls }));
