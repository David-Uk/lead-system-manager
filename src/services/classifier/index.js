import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { loadActiveProducts } from '../product.service.js';
import { classifyWithRules } from './rules.js';
import { classifyWithLlm } from './llm.js';

/**
 * Hybrid classifier (workplan 4 + failure 1).
 *
 *   rules confident?          -> decided (source 'rules')
 *   else LLM consulted        -> confident? decided (source 'llm')
 *   LLM down/timeout/invalid  -> degrade to the rules opinion, or to
 *   low confidence               `unknown` + a failure reason the pipeline
 *                                escalates on ('ai_unavailable' /
 *                                'low_confidence')
 *
 * `failure` is non-null whenever the LLM leg did not deliver a decision,
 * even if the rules opinion rescued the message - the pipeline audits that
 * as CLASSIFIER_FALLBACK.
 *
 * @param {string} text - raw customer message
 * @param {{products?: Array<object>|null, forceLlmFailure?: boolean, log?: object}} [context]
 * @returns {Promise<{intent: string, confidence: number, entities: object,
 *   source: 'rules'|'llm'|'fallback', failure: 'ai_unavailable'|'low_confidence'|null}>}
 */
export async function classify(text, { products = null, forceLlmFailure = false, log = logger } = {}) {
    const catalogue = products ?? (await loadActiveProducts());
    const rulesResult = classifyWithRules(text, catalogue);

    if (rulesResult.intent && rulesResult.confidence >= env.RULES_CONFIDENCE_THRESHOLD) {
        return {
            intent: rulesResult.intent,
            confidence: rulesResult.confidence,
            entities: rulesResult.entities,
            source: 'rules',
            failure: null,
        };
    }

    let failure = null;

    if (env.LLM_PROVIDER === 'none') {
        failure = 'ai_unavailable'; // rules-only configuration (workplan 18)
    } else if (forceLlmFailure) {
        failure = 'ai_unavailable'; // test hook: simulate a provider outage (workplan 8.3)
        log.warn('LLM call skipped by forceLlmFailure');
    } else {
        try {
            const llmResult = await classifyWithLlm(text);
            if (llmResult.intent !== 'unknown' && llmResult.confidence >= env.CONFIDENCE_THRESHOLD) {
                return { ...llmResult, source: 'llm', failure: null };
            }
            failure = 'low_confidence';
            log.info(
                { intent: llmResult.intent, confidence: llmResult.confidence },
                'LLM classification below threshold',
            );
        } catch (err) {
            failure = 'ai_unavailable';
            log.warn({ code: err?.code, error: err?.message }, 'LLM classification failed');
        }
    }

    if (rulesResult.intent) {
        // Degraded but usable: keep the weaker rules signal.
        return {
            intent: rulesResult.intent,
            confidence: rulesResult.confidence,
            entities: rulesResult.entities,
            source: 'rules',
            failure,
        };
    }

    return {
        intent: 'unknown',
        confidence: 0,
        entities: rulesResult.entities,
        source: 'fallback',
        failure,
    };
}
