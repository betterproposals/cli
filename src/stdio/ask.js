import { prepareInput, translateToEnglish, translateFromEnglish } from './translate.js';
import { triage, classifyMcpIntent } from './triage.js';
import { runGeneralAgent } from './general.js';
import { runAgent, loadSessionContext, sessionHasBeenMcp, loadSessionMeta, saveSessionMeta } from './ai.js';
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
        intent: 'qwen3.5:2b',
        reranker: null,   // off unless explicitly overridden on the local path
        mcp: { simple: 'qwen3.5:2b', medium: 'qwen3.5:4b', complex: 'qwen3.5:9b' },
    },
    openrouter: {
        translatorIn: 'deepseek/deepseek-v4-flash',
        translatorOut: 'deepseek/deepseek-v4-flash',
        embed: 'openai/text-embedding-3-small',
        intent: 'deepseek/deepseek-v4-flash',
        reranker: 'deepseek/deepseek-v4-flash',
        mcp: { simple: 'deepseek/deepseek-v4-flash', medium: 'deepseek/deepseek-v4-pro', complex: 'qwen/qwen3.7-plus' },
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
    intentModel,
    rerankerModel,
    noReranker,         // explicitly disable the LLM reranker on the general path
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
    const resolvedIntent = intentModel || process.env.BETTERPROPOSALS_INTENT_MODEL || defs.intent;
    const resolvedRerankerModel = rerankerModel || process.env.BETTERPROPOSALS_RERANKER_MODEL || defs.reranker;
    // Reranker is on whenever we have a model for it AND the caller didn't
    // explicitly disable it. The local path ships null by default (off);
    // OpenRouter ships deepseek-v4-flash (on).
    const reranker = noReranker || !resolvedRerankerModel
        ? null
        : { model: resolvedRerankerModel };
    const mcpTiers = defs.mcp;

    // 1+2. Detect + translate to English (skips translation when already
    // English; on OpenRouter detection + translation are one strong-model
    // call, robust on short text where franc misfires).
    //
    // Session pinning: if this session already has a recorded language
    // from a previous turn, reuse it without re-detecting. Language
    // drifts across short prompts and the back-translator sometimes
    // prepends the language name ("Italiano:"); pinning prevents both.
    let languageCode = 'en';
    let languageName = 'English';
    let englishPrompt = prompt;
    let languageSource = 'detected';
    const meta = sessionId ? loadSessionMeta(sessionId) : null;
    const languagePinned = translate && meta?.languageCode;
    if (languagePinned) {
        languageCode = meta.languageCode;
        languageName = meta.languageName;
        languageSource = 'pinned';
        if (languageCode === 'en') {
            englishPrompt = prompt;
        } else {
            englishPrompt = await translateToEnglish(prompt, {
                provider, endpoint, apiKey: resolvedApiKey, model: inModel, timeoutMs: translateTimeoutMs,
            });
        }
    } else if (translate) {
        const prepared = await prepareInput(prompt, {
            provider, endpoint, apiKey: resolvedApiKey, model: inModel, timeoutMs: translateTimeoutMs,
        });
        languageCode = prepared.languageCode;
        languageName = prepared.languageName;
        englishPrompt = prepared.englishPrompt;
    }

    // 3. Triage (cosine first pass).
    const decision = force
        ? { path: force, generalScore: null, mcpScore: null, margin: null, generalBest: null, mcpBest: null }
        : await triage(englishPrompt, { provider, embedEndpoint: endpoint, apiKey: resolvedApiKey, embedModel: resolvedEmbed });

    // 3b. Complementary intent gate. Cosine can't separate "how do I create
    // a proposal" (general) from "create a proposal" (mcp). When cosine
    // landed on general, re-check with an LLM that has MCP-priority bias;
    // feed recent session turns so follow-ups ("yes, set tax to 21%") stay
    // on the data path.
    if (!force && decision.path === 'general') {
        const context = sessionId ? loadSessionContext(sessionId) : '';
        const intent = await classifyMcpIntent(englishPrompt, {
            provider, endpoint, apiKey: resolvedApiKey, model: resolvedIntent,
            timeoutMs: translateTimeoutMs, context,
        });
        if (intent === 'mcp') {
            decision.path = 'mcp';
            decision.overriddenByIntentGate = true;
        }
    }

    // 3c. Session pinning: once a session has been routed MCP at least
    // once, every subsequent turn stays on MCP. The general path has no
    // session memory, so dropping back to general mid-conversation loses
    // all prior messages. (We check presence of the messages file which
    // only runAgent ever writes.)
    if (!force && sessionId && sessionHasBeenMcp(sessionId)) {
        decision.path = 'mcp';
        decision.sessionPinnedToMcp = true;
    }

    // 4. Meta housekeeping for the session. Pin language on first turn,
    // update on each turn so it's available for future rehydrations even
    // if --no-translate is passed next time. Also record the path choice.
    if (sessionId) {
        saveSessionMeta(sessionId, {
            languageCode,
            languageName,
            languageSource,
            lastPath: decision.path,
        });
    }

    if (triageOnly) {
        return { language: languageCode, languageName, languageSource, englishPrompt, decision, response: null };
    }

    // 4. Route.
    let englishResponse;
    let trace = [];
    let chosenMcpModel = null;
    let chosenMcpTier = null;
    let bestArticle = null;
    let bestArticleScore = null;
    let rerankedFlag = false;
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
            reranker,
        });
        englishResponse = result.response;
        bestArticle = result.article;
        bestArticleScore = result.score;
        rerankedFlag = result.reranked;
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
        languageSource,
        englishPrompt,
        decision,
        provider,
        mcpTier: chosenMcpTier,
        mcpModel: chosenMcpModel,
        article: bestArticle,
        articleScore: bestArticleScore,
        reranked: rerankedFlag,
        response,
        englishResponse,
        trace,
    };
}
