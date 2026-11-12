// Provider abstraction for the tool-calling agent chat. Normalizes the
// request/response/tool-call differences between:
//   - Ollama  (local): POST /api/chat, {message:{...}} response, tool
//     results keyed by `name`, tool-call arguments as objects.
//   - OpenRouter (cloud): OpenAI-compatible POST /api/v1/chat/completions,
//     {choices:[{message}]} response, tool results keyed by `tool_call_id`,
//     tool-call arguments as JSON strings.
//
// Only the agent loop (src/ai.js) uses this. Translation + embeddings stay
// on local Ollama (their models — the hy-chat translators and
// nomic-embed-text — have no OpenRouter equivalent).

import { ollamaChat, ollamaEmbed, stripThinking } from './ollama.js';

export const PROVIDERS = ['ollama', 'openrouter'];

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';
const OPENROUTER_URL = `${OPENROUTER_BASE}/chat/completions`;
const OPENROUTER_EMBED_URL = `${OPENROUTER_BASE}/embeddings`;
// Sent to OpenRouter for usage attribution on their dashboard. Harmless if
// the URL/title don't resolve to anything public.
const OPENROUTER_REFERER = 'https://betterproposals.io';
const OPENROUTER_TITLE = 'Better Proposals CLI';

function openRouterHeaders(apiKey) {
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': OPENROUTER_REFERER,
        'X-Title': OPENROUTER_TITLE,
    };
}

export function resolveProvider(explicit) {
    const p = explicit || process.env.BETTERPROPOSALS_PROVIDER || 'ollama';
    if (!PROVIDERS.includes(p)) {
        throw new Error(`Unknown provider "${p}". Valid providers: ${PROVIDERS.join(', ')}`);
    }
    return p;
}

export function resolveApiKey(provider) {
    if (provider !== 'openrouter') return null;
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) {
        throw new Error(
            'OpenRouter mode requires an API key. Set OPENROUTER_API_KEY in your .env ' +
            '(copy .env.example) or environment. Get one at https://openrouter.ai/keys'
        );
    }
    return key;
}

// Normalize a provider response into { assistantMessage, toolCalls }.
//   assistantMessage — pushed back into the running `messages` array so the
//                       next request carries the model's tool-call intent.
//   toolCalls        — [{ id, name, args }] for dispatch. `args` is left in
//                       the provider's native shape (object for Ollama,
//                       string for OpenRouter); invokeTool() accepts both.
function normalizeOllama(data) {
    const msg = data.message;
    if (!msg) {
        throw new Error('Ollama did not return a `message` field. Is this an Ollama-compatible /api/chat endpoint?');
    }
    const toolCalls = (msg.tool_calls ?? []).map((tc, i) => ({
        id: tc.id ?? `call_${i}`,
        name: tc.function?.name,
        args: tc.function?.arguments,
    }));
    return { assistantMessage: msg, toolCalls };
}

function normalizeOpenRouter(data) {
    const choice = data.choices?.[0];
    if (!choice?.message) {
        const errMsg = data.error?.message ? `: ${data.error.message}` : '';
        throw new Error(`OpenRouter returned no message${errMsg}.`);
    }
    const msg = choice.message;
    const toolCalls = (msg.tool_calls ?? []).map((tc, i) => ({
        id: tc.id ?? `call_${i}`,
        name: tc.function?.name,
        args: tc.function?.arguments,
    }));
    return { assistantMessage: msg, toolCalls };
}

export async function chatWithTools({
    provider,
    endpoint,
    apiKey,
    model,
    messages,
    tools,
    numCtx,
    timeoutMs,
}) {
    const signal = AbortSignal.timeout(timeoutMs);

    let url;
    const headers = { 'Content-Type': 'application/json' };
    let body;

    if (provider === 'openrouter') {
        url = OPENROUTER_URL;
        Object.assign(headers, openRouterHeaders(apiKey));
        // OpenAI-compatible body. No num_ctx / keep_alive / think — those
        // are Ollama-only knobs.
        body = { model, messages, tools, stream: false };
    } else {
        url = endpoint;
        body = {
            model, messages, tools, stream: false,
            options: { num_ctx: numCtx },
            keep_alive: '60m',
        };
    }

    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
            timeout: false,
        });
    } catch (e) {
        if (signal.aborted) {
            const where = provider === 'openrouter' ? 'OpenRouter' : 'Llama endpoint';
            throw new Error(
                `${where} did not respond within ${Math.round(timeoutMs / 1000)}s. ` +
                'Increase the limit with --timeout <seconds> (ai) / --mcp-timeout <seconds> (ask).'
            );
        }
        throw e;
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const where = provider === 'openrouter' ? 'OpenRouter' : 'Llama endpoint';
        throw new Error(`${where} returned ${response.status}: ${text || response.statusText}`);
    }

    const data = await response.json();
    return provider === 'openrouter' ? normalizeOpenRouter(data) : normalizeOllama(data);
}

// Build the tool-result message in the shape the provider expects on the
// next request. OpenAI/OpenRouter key results by tool_call_id; Ollama by
// the tool name.
export function formatToolResultMessage({ provider, toolCall, content }) {
    if (provider === 'openrouter') {
        return { role: 'tool', tool_call_id: toolCall.id, content };
    }
    return { role: 'tool', name: toolCall.name, content };
}

// --- Non-tool chat + embeddings, provider-aware --------------------------
// Used by the `ask` translation + triage/article-matching steps. In
// OpenRouter mode these outsource to cloud models too; in Ollama mode they
// hit the local server.

const DEFAULT_OR_CHAT_TIMEOUT_MS = 120_000;
const DEFAULT_OR_EMBED_TIMEOUT_MS = 60_000;

async function openRouterChat({ apiKey, model, messages, timeoutMs = DEFAULT_OR_CHAT_TIMEOUT_MS }) {
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
        response = await fetch(OPENROUTER_URL, {
            method: 'POST',
            headers: openRouterHeaders(apiKey),
            body: JSON.stringify({ model, messages, stream: false }),
            signal,
            timeout: false,
        });
    } catch (e) {
        if (signal.aborted) {
            throw new Error(`OpenRouter did not respond within ${Math.round(timeoutMs / 1000)}s.`);
        }
        throw e;
    }
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenRouter returned ${response.status}: ${text || response.statusText}`);
    }
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (content == null) {
        const errMsg = data.error?.message ? `: ${data.error.message}` : '';
        throw new Error(`OpenRouter returned no message content${errMsg}.`);
    }
    return content;
}

async function openRouterEmbed({ apiKey, model, input, timeoutMs = DEFAULT_OR_EMBED_TIMEOUT_MS }) {
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
        response = await fetch(OPENROUTER_EMBED_URL, {
            method: 'POST',
            headers: openRouterHeaders(apiKey),
            body: JSON.stringify({ model, input }),
            signal,
            timeout: false,
        });
    } catch (e) {
        if (signal.aborted) {
            throw new Error(`OpenRouter embeddings did not respond within ${Math.round(timeoutMs / 1000)}s.`);
        }
        throw e;
    }
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`OpenRouter embeddings returned ${response.status}: ${text || response.statusText}`);
    }
    const data = await response.json();
    // OpenAI-compatible: { data: [{ index, embedding: [...] }] }
    if (!Array.isArray(data.data)) {
        throw new Error('OpenRouter embeddings response had no `data` array.');
    }
    const sorted = [...data.data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const vectors = sorted.map((d) => d.embedding);
    return Array.isArray(input) ? vectors : vectors[0];
}

// Provider-aware text chat (no tools). `think` is honored only on Ollama.
export async function chatText({ provider, endpoint, apiKey, model, messages, timeoutMs, think }) {
    if (provider === 'openrouter') {
        const raw = await openRouterChat({ apiKey, model, messages, timeoutMs });
        // deepseek and other reasoning models may wrap thinking in <think>;
        // strip it so only the final text survives. (No think:false sent —
        // these models are fast enough that we don't disable reasoning.)
        return stripThinking(raw);
    }
    return ollamaChat({ endpoint, model, messages, timeoutMs, think });
}

// Provider-aware embeddings. `input` may be a string or an array of
// strings; the return shape matches (single vector vs array of vectors).
export async function embedText({ provider, endpoint, apiKey, model, input, timeoutMs }) {
    if (provider === 'openrouter') {
        return openRouterEmbed({ apiKey, model, input, timeoutMs });
    }
    return ollamaEmbed({ endpoint, model, input, timeoutMs });
}
