import { detectLanguage, translateToEnglish, translateFromEnglish } from './translate.js';
import { triage } from './triage.js';
import { runGeneralAgent } from './general.js';
import { runAgent } from './ai.js';
import { resolveProvider, resolveApiKey } from './provider.js';

// Orchestrator for `betterproposals ask`. Flow:
//   1. detect input language locally (franc-min, no LLM)
//   2. translate to English (if not already English)
//   3. embedding-based triage → 'general' or 'mcp'
//   4. route:
//        general → article-matching (no agent LLM)
//        mcp     → agent loop with a tiered model picked by complexity
//   5. translate response back to the user's language (if not English)
//
// In Ollama mode every stage hits the local server. In OpenRouter mode
// ALL stages outsource to the cloud — translation (deepseek), embeddings
// (text-embedding-3-small), and the agent (tiered) — so no local Ollama is
// required at all. The translation step is skipped when the source is
// already English.

const DEFAULT_ENDPOINT = 'http://localhost:11434/api/chat';
const DEFAULT_TRANSLATE_TIMEOUT_MS = 120_000;

// Per-provider model defaults for each stage.
const STAGE_DEFAULTS = {
    ollama: {
        translatorIn: 'hy-chat-translator-in',
        translatorOut: 'hy-chat-translator-out',
        embed: 'nomic-embed-text',
        mcp: { simple: 'qwen3.5:2b', medium: 'qwen3.5:4b', complex: 'qwen3.5:9b' },
    },
    openrouter: {
        translatorIn: 'deepseek/deepseek-v4-flash',
        translatorOut: 'deepseek/deepseek-v4-flash',
        embed: 'openai/text-embedding-3-small',
        mcp: { simple: 'qwen/qwen3.5-9b', medium: 'google/gemma-4-26b-a4b-it', complex: 'mistralai/mistral-small-2603' },
    },
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
    provider = resolveProvider(),
    apiKey,
    endpoint = process.env.BETTERPROPOSALS_LLAMA_URL || DEFAULT_ENDPOINT,
    translatorInModel,  // resolved per-provider below if unset
    translatorOutModel,
    embedModel,
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

    // Resolve per-stage models: explicit arg → env override → provider
    // default. Resolve the API key once (throws early if OpenRouter without
    // a key). In OpenRouter mode every stage uses the cloud; in Ollama mode
    // every stage uses the local server.
    const defs = STAGE_DEFAULTS[provider] ?? STAGE_DEFAULTS.ollama;
    const resolvedApiKey = apiKey ?? resolveApiKey(provider);
    const inModel = translatorInModel || process.env.BETTERPROPOSALS_TRANSLATOR_IN || defs.translatorIn;
    const outModel = translatorOutModel || process.env.BETTERPROPOSALS_TRANSLATOR_OUT || defs.translatorOut;
    const resolvedEmbed = embedModel || process.env.BETTERPROPOSALS_EMBED_MODEL || defs.embed;
    const mcpTiers = defs.mcp;

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
                provider, endpoint, apiKey: resolvedApiKey, model: inModel, timeoutMs: translateTimeoutMs,
            });
        }
    }

    // 3. Triage.
    const decision = force
        ? { path: force, generalScore: null, mcpScore: null, margin: null, generalBest: null, mcpBest: null }
        : await triage(englishPrompt, { provider, embedEndpoint: endpoint, apiKey: resolvedApiKey, embedModel: resolvedEmbed });

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
        chosenMcpModel = mcpModel ?? mcpTiers[chosenMcpTier] ?? mcpTiers.simple;
        const result = await runAgent({
            prompt: englishPrompt,
            provider,
            apiKey: resolvedApiKey,
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
            provider,
            embedEndpoint: endpoint,
            apiKey: resolvedApiKey,
            embedModel: resolvedEmbed,
        });
        englishResponse = result.response;
        bestArticle = result.article;
        bestArticleScore = result.score;
    }

    // 5. Translate response back.
    let response = englishResponse;
    if (translate && languageCode !== 'en') {
        response = await translateFromEnglish(englishResponse, languageCode, {
            provider, endpoint, apiKey: resolvedApiKey, model: outModel, timeoutMs: translateTimeoutMs,
        });
    }

    return {
        language: languageCode,
        languageName,
        englishPrompt,
        decision,
        provider,
        mcpTier: chosenMcpTier,
        mcpModel: chosenMcpModel,
        article: bestArticle,
        articleScore: bestArticleScore,
        response,
        englishResponse,
        trace,
    };
}
