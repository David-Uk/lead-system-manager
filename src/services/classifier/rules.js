import { rankProducts } from '../product.service.js';

/**
 * Deterministic rules classifier - step 1 of the hybrid (workplan 4).
 *
 * Pure and synchronous: takes the message text plus the active product list
 * (for alias matching) and never touches the database, which keeps it
 * trivially unit-testable. Confidence follows the strength of the matched
 * signals; anything below RULES_CONFIDENCE_THRESHOLD is handed to the LLM.
 *
 * Scoring: each strong pattern (weight 2) or weak pattern (weight 1) that
 * matches adds points; a catalogue match confirms catalogue/purchase
 * intents (+1). On ties, the RULE_SET order below decides (complaints beat
 * logistics, logistics beat purchase intent, purchase beats price, and a
 * generic catalogue-listing phrase beats a single-product enquiry).
 */

const CONFIDENCE_BASE = 0.5;
const CONFIDENCE_PER_POINT = 0.175;
const CONFIDENCE_CAP = 0.95;

const RULE_SET = [
    {
        intent: 'complaint_or_refund',
        strong: [
            /refund/i,
            /complain/i,
            /damaged?/i,
            /broken/i,
            /spoiled/i,
            /wrong (item|order|goods|delivery)/i,
            /not (happy|satisfied)/i,
            /dispute/i,
            /scam(med)?/i,
            /cheat(ed)?/i,
        ],
        weak: [/terrible/i, /awful/i, /useless/i],
    },
    {
        intent: 'order_status',
        strong: [
            /\bord-[a-z0-9-]+\b/i,
            /where('| i)?s? (is |be )?(my |the )?(order|delivery|package|food)\b/i,
            /\b(order|delivery|package|food)\b.{0,20}\b(status|track\w*|arrive[ds]?|reach(ed)?|deliver(ed)?)\b/i,
            /\btrack(ing)?\b/i,
        ],
        weak: [/\bstatus\b/i],
    },
    {
        intent: 'place_order',
        strong: [
            /\b(want|need|like|wish|wanna|please|pls)\b.{0,15}\b(buy|order|purchase)\b/i,
            /\bplace (an? )?order\b/i,
            /\b(buy|order|get)\b.{0,12}\b\d{1,3}\b/i,
            /\b\d{1,3}\s*(bags?|packs?|cartons?|pieces?|pcs|units?|tins?|bottles?|loaves?|loaf|dozens?|sachets?|kilos?)\b/i,
        ],
        weak: [/\bi want\b/i, /\bcan i (get|buy|order|have)\b/i, /\bi('ll| will| go) take\b/i],
    },
    {
        intent: 'price_check',
        strong: [
            /how much/i,
            /\bprices?\b/i,
            /\bcost\b/i,
            /\bhow e (be|cost)\b/i,
            /\bna how much\b/i,
            /\brate\b/i,
        ],
        weak: [/\bcharge\b/i],
    },
    {
        intent: 'catalog_listing',
        strong: [
            /\bwhat (are|r) the (products?|items?|goods|things)\b/i,
            /\bwhat (products?|items?|goods|things)\b.{0,25}\b(do you|does|are|available|sell|have)\b/i,
            /\bwhat (kind|type|sort)s? of (products?|items?|goods|things)\b/i,
            /\bwhat (do|does) (you|una|u) (sell|have|stock|get|dey)\b/i,
            /\bwhich (products?|items?|goods)\b/i,
            /\bdo you (have|sell|stock) (any )?(products?|items?|goods)\b/i,
            /\bdo (you|una) sell\b/i,
            /\b(list|menu|catalogue|catalog)\b/i,
            /\bshow me\b.{0,25}\b(products?|items?|goods|catalogue|catalog|menu)\b/i,
            /\bshow me what (you|una)\b/i,
            /\bwhat('s| is) available\b/i,
            /\bwetin (una|you|u)\b.{0,25}\b(sell|get|have|stock)\b/i,
        ],
        weak: [],
    },
    {
        intent: 'product_enquiry',
        strong: [
            /\bdo you (have|sell|stock|carry|get)\b/i,
            /\b(is|are)\b.{0,30}\bavailable\b/i,
            /\bin stock\b/i,
            /\buna (get|sell)\b/i,
            /\byou (get|sell|dey sell)\b/i,
        ],
        weak: [/\bsell\b/i, /\bavailable\b/i, /\bstock\b/i],
    },
];

/** First standalone number 1-50 that is not part of an order reference. */
function extractQuantity(input) {
    const withoutOrderIds = input.replace(/\bord-[a-z0-9-]+\b/gi, ' ');
    for (const match of withoutOrderIds.matchAll(/\b(\d{1,3})\b/g)) {
        const value = Number(match[1]);
        if (value >= 1 && value <= 50) return value;
    }
    return null;
}

/**
 * @param {string} text - raw customer message
 * @param {Array<object>} products - active catalogue entries (for alias matching)
 * @returns {{intent: string|null, confidence: number, entities: object}}
 *   `intent: null` means "no rules signal" - index.js sends those to the LLM.
 */
export function classifyWithRules(text, products = []) {
    const input = String(text ?? '').trim();
    const entities = { productQuery: null, quantity: null, orderId: null };

    const orderId = input.match(/\b(ord-[a-z0-9-]+)/i)?.[1];
    if (orderId) entities.orderId = orderId.toUpperCase();

    const ranked = rankProducts(input, products, { limit: 3 });
    const bestProduct = ranked[0] ?? null;
    // Several equally-strong catalogue candidates ("rice or beans"): leave
    // productQuery unset so the handler re-queries with the full text and
    // can list every match instead of guessing one.
    const ambiguous = Boolean(bestProduct && ranked[1] && ranked[1].matchScore === bestProduct.matchScore);
    if (bestProduct && !ambiguous) entities.productQuery = bestProduct.name;

    const scores = new Map();
    for (const { intent, strong, weak } of RULE_SET) {
        let points = 0;
        for (const pattern of strong) if (pattern.test(input)) points += 2;
        for (const pattern of weak) if (pattern.test(input)) points += 1;
        if (points > 0) scores.set(intent, points);
    }

    let bestIntent = null;
    let bestPoints = 0;
    for (const { intent } of RULE_SET) {
        const points = scores.get(intent) ?? 0;
        if (points > bestPoints) {
            bestIntent = intent;
            bestPoints = points;
        }
    }

    if (!bestIntent) {
        return { intent: null, confidence: 0, entities };
    }

    // Resolve the catalog_listing / product_enquiry overlap in both
    // directions. A named product defuses a listing phrase: "what products
    // do you have in rice?" is a rice question, not a catalogue dump. With
    // no named product, listing vocabulary outranks product_enquiry's
    // generic "available" / "do you sell" phrasings, which stack to 3
    // points: "what are the products available?" asks for the overview.
    if (bestProduct && !ambiguous && bestIntent === 'catalog_listing') {
        bestIntent = 'product_enquiry';
    } else if (
        bestIntent === 'product_enquiry' &&
        !bestProduct &&
        (scores.get('catalog_listing') ?? 0) >= 2
    ) {
        bestIntent = 'catalog_listing';
    }

    // A catalogue match confirms catalogue questions and purchase intent.
    let points = bestPoints;
    if (
        bestProduct &&
        !ambiguous &&
        ['product_enquiry', 'price_check', 'place_order'].includes(bestIntent)
    ) {
        points += 1;
    }

    if (bestIntent === 'place_order') {
        entities.quantity = extractQuantity(input);
    }

    return {
        intent: bestIntent,
        confidence: Math.min(CONFIDENCE_CAP, CONFIDENCE_BASE + CONFIDENCE_PER_POINT * points),
        entities,
    };
}
