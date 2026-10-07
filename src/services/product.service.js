import { Product } from '../models/product.model.js';

/**
 * Catalogue access (workplan 7 `products`) and the free-text matcher shared
 * by the rules classifier and the product/price intent handlers.
 *
 * Matching runs in JavaScript over the active catalogue (about 30 products)
 * instead of a MongoDB text search: results are deterministic, trivially
 * unit-testable, and the classifier needs the full list for alias matching
 * anyway.
 */

/** Query noise that would otherwise match every product. */
const STOPWORDS = new Set([
    'the', 'a', 'an', 'and', 'or', 'of', 'for', 'to', 'in', 'on', 'at', 'with',
    'is', 'are', 'am', 'be', 'been', 'do', 'does', 'did', 'you', 'your', 'una',
    'we', 'our', 'i', 'my', 'me', 'it', 'its', 'this', 'that', 'these', 'those',
    'can', 'could', 'will', 'would', 'should', 'have', 'has', 'had', 'get',
    'want', 'need', 'buy', 'order', 'sell', 'please', 'pls', 'abeg', 'how',
    'much', 'na', 'dey', 'don', 'so', 'then', 'there', 'here', 'what', 'which',
    'who', 'when', 'where', 'why', 'if', 'but', 'not', 'no', 'yes', 'ok',
    'okay', 'hey', 'hi', 'hello', 'good', 'morning', 'afternoon', 'evening',
    'price', 'cost', 'charge', 'stock', 'available', 'still', 'any', 'some',
]);

/** @returns {Promise<Array<object>>} every active catalogue entry (lean docs) */
export async function loadActiveProducts() {
    return Product.find({ active: true }).lean();
}

function tokenise(text) {
    return String(text ?? '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** "bags" should also match the alias "bag of rice"; products are rarely plural. */
function tokenForms(token) {
    const forms = [token];
    if (token.length > 4 && token.endsWith('s')) forms.push(token.slice(0, -1));
    return forms;
}

function scoreProduct(product, tokens) {
    const haystack = [product.name, ...(product.aliases ?? [])]
        .map((part) => String(part).toLowerCase())
        .join(' | ');

    let score = 0;
    for (const token of tokens) {
        const matched = tokenForms(token).some((form) =>
            new RegExp(`(^|[^a-z0-9])${escapeRegExp(form)}`, 'i').test(haystack),
        );
        if (matched) score += 1;
    }
    return score;
}

/**
 * Ranks catalogue entries against free text. Returns the best matches first,
 * each carrying its `matchScore`; empty when nothing matches.
 *
 * @param {string} query - customer text or a classifier productQuery
 * @param {Array<object>} products - catalogue entries to rank against
 * @param {{limit?: number}} [options]
 */
export function rankProducts(query, products, { limit = 5 } = {}) {
    const tokens = tokenise(query);
    if (tokens.length === 0 || !products?.length) return [];

    return products
        .map((product) => ({ product, score: scoreProduct(product, tokens) }))
        .filter((entry) => entry.score > 0)
        .sort(
            (a, b) =>
                b.score - a.score ||
                String(a.product.name).localeCompare(String(b.product.name)),
        )
        .slice(0, limit)
        .map((entry) => ({ ...entry.product, matchScore: entry.score }));
}

/**
 * Convenience: rank the active catalogue against free text, keeping only
 * the products tied at the top score. "How much is 5kg rice?" must answer
 * with Rice 5kg alone - weaker "5kg" matches (Beans 5kg, Garri 5kg) are not
 * alternatives - while a genuinely ambiguous query ("rice or beans") keeps
 * all equally-good matches so the handler can list them.
 */
export async function findProductsByQuery(query, { limit = 5 } = {}) {
    const ranked = rankProducts(query, await loadActiveProducts());
    const best = ranked[0]?.matchScore;
    return ranked.filter((product) => product.matchScore === best).slice(0, limit);
}

/** @returns {Promise<object|null>} the product with this SKU, if any */
export async function getProductBySku(sku) {
    if (!sku) return null;
    return Product.findOne({ sku: String(sku).toUpperCase() });
}
