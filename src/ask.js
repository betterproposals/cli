import { detectLanguage, translateToEnglish, translateFromEnglish } from './translate.js';
import { triage, DEFAULT_EMBED_MODEL } from './triage.js';
import { runGeneralAgent } from './general.js';
import { runAgent } from './ai.js';

// Orchestrator for `betterproposals ask`. Flow:
//   1. detect input language locally (franc-min, no LLM)
//   2. translate to English via hy-chat-translator-in (if not already English)
//   3. embedding-based triage → 'general' or 'mcp'
//   4. route:
//        general → article-matching (no LLM, instant)
//        mcp     → agent loop with a tiered qwen3.5 model picked by complexity
//   5. translate response back via hy-chat-translator-out (if not English)
//
// All translation/embedding endpoints share the same Ollama host. The
// translation step is skipped automatically when the detected source is
// English, saving a roundtrip on the common case.

const DEFAULT_ENDPOINT = 'http://localhost:11434/api/chat';
const DEFAULT_TRANSLATOR_IN = 'hy-chat-translator-in';
const DEFAULT_TRANSLATOR_OUT = 'hy-chat-translator-out';
const DEFAULT_TRANSLATE_TIMEOUT_MS = 120_000;

const MCP_TIERS = {
    simple: 'qwen3.5:2b',
    medium: 'qwen3.5:4b',
    complex: 'qwen3.5:9b',
};

// Heuristic complexity scoring for MCP prompts. Cheap, deterministic, no
// LLM call. The signals: length, multi-step conjunctions, aggregation
// words, comparison words, and explicit time ranges. The user can
// override the tier with --mcp-tier or pin a model with --mcp-model.
export function pickMcpTier(prompt) {
    let score = 0;
    const len = prompt.length;
    if (len > 100) score += 1;
    if (len > 200) score += 1;
    if (/\b(and|then|also|plus|moreover|furthermore)\b/i.test(prompt)) score += 1;
    if (/\b(sum|total|average|count|grouped?|aggregate|how many)\b/i.test(prompt)) score += 1;
    if (/\b(more than|less than|compar(?:e|ed|ing|ison)|versus|vs\.?|highest|lowest|top \d+|bottom \d+)\b/i.test(prompt)) score += 1;
    if (/\b(between|from .* to|since|until)\b/i.test(prompt)) score += 0.5;

    if (score >= 4) return 'complex';
    if (score >= 2) return 'medium';
    return 'simple';
}

export async function ask({
    prompt,
    endpoint = process.env.BETTERPROPOSALS_LLAMA_URL || DEFAULT_ENDPOINT,
    translatorInModel = process.env.BETTERPROPOSALS_TRANSLATOR_IN || DEFAULT_TRANSLATOR_IN,
    translatorOutModel = process.env.BETTERPROPOSALS_TRANSLATOR_OUT || DEFAULT_TRANSLATOR_OUT,
    embedModel = process.env.BETTERPROPOSALS_EMBED_MODEL || DEFAULT_EMBED_MODEL,
    mcpModel,           // explicit override; otherwise pickMcpTier picks
    mcpTier,            // 'simple' | 'medium' | 'complex' override
    mcpTimeoutMs,
    translateTimeoutMs = DEFAULT_TRANSLATE_TIMEOUT_MS,
    translate = true,
    force,              // 'general' | 'mcp' override on the triage
    triageOnly = false,
    sessionId,
    numCtx,
    maxIterations,
    maxToolResultItems,
} = {}) {
    if (!prompt || typeof prompt !== 'string') {
        throw new Error('ask: `prompt` is required.');
    }

    // 1+2. Detect + translate to English (skip when already English).
    let languageCode = 'en';
    let languageName = 'English';
    let englishPrompt = prompt;
    if (translate) {
        const detected = detectLanguage(prompt);
        languageCode = detected.iso639_1;
        languageName = detected.name;
        if (languageCode !== 'en') {
            englishPrompt = await translateToEnglish(prompt, {
                endpoint, model: translatorInModel, timeoutMs: translateTimeoutMs,
            });
        }
    }

    // 3. Triage.
    const decision = force
        ? { path: force, generalScore: null, mcpScore: null, margin: null, generalBest: null, mcpBest: null }
        : await triage(englishPrompt, { embedEndpoint: endpoint, embedModel });

    if (triageOnly) {
        return { language: languageCode, languageName, englishPrompt, decision, response: null };
    }

    // 4. Route.
    let englishResponse;
    let trace = [];
    let chosenMcpModel = null;
    let chosenMcpTier = null;
    let bestArticle = null;
    let bestArticleScore = null;
    if (decision.path === 'mcp') {
        chosenMcpTier = mcpTier ?? pickMcpTier(englishPrompt);
        chosenMcpModel = mcpModel ?? MCP_TIERS[chosenMcpTier] ?? MCP_TIERS.simple;
        const result = await runAgent({
            prompt: englishPrompt,
            endpoint,
            model: chosenMcpModel,
            timeoutMs: mcpTimeoutMs,
            numCtx,
            maxIterations,
            maxToolResultItems,
            sessionId,
        });
        englishResponse = result.response;
        trace = result.trace;
    } else {
        const result = await runGeneralAgent({
            prompt: englishPrompt,
            embedEndpoint: endpoint,
            embedModel,
        });
        englishResponse = result.response;
        bestArticle = result.article;
        bestArticleScore = result.score;
    }

    // 5. Translate response back.
    let response = englishResponse;
    if (translate && languageCode !== 'en') {
        response = await translateFromEnglish(englishResponse, languageCode, {
            endpoint, model: translatorOutModel, timeoutMs: translateTimeoutMs,
        });
    }

    return {
        language: languageCode,
        languageName,
        englishPrompt,
        decision,
        mcpTier: chosenMcpTier,
        mcpModel: chosenMcpModel,
        article: bestArticle,
        articleScore: bestArticleScore,
        response,
        englishResponse,
        trace,
    };
}
