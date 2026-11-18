// Minimal Ollama HTTP helpers shared by the triage/translate/general
// paths. `src/ai.js` keeps its own slightly richer chat call because it
// also threads tool definitions + iteration state; the helpers here are
// the "send a prompt, get a string back" shape.

const DEFAULT_CHAT_TIMEOUT_MS = 300_000;
const DEFAULT_EMBED_TIMEOUT_MS = 60_000;
// Tell Ollama to keep each model resident in memory for an hour after the
// last request. A single `ask` invocation runs translate-in → embed →
// agent → translate-out sequentially, and a session of several prompts
// shares the same models — without this Ollama unloads after the default
// 5min idle and every subsequent call pays a cold-start penalty.
const DEFAULT_KEEP_ALIVE = '60m';

function deriveEmbedUrl(chatEndpoint) {
    // Callers pass the /api/chat URL because that's the env var they
    // already have. Swap the path so the same host serves embeddings.
    return chatEndpoint.replace(/\/api\/chat\/?$/, '/api/embed');
}

export async function ollamaChat({ endpoint, model, messages, numCtx, think, keepAlive = DEFAULT_KEEP_ALIVE, timeoutMs = DEFAULT_CHAT_TIMEOUT_MS }) {
    const signal = AbortSignal.timeout(timeoutMs);
    const body = { model, messages, stream: false, keep_alive: keepAlive };
    if (numCtx) body.options = { num_ctx: numCtx };
    // Ollama 0.6+ honors `think: false` to suppress <think>...</think>
    // blocks on reasoning-capable models (qwen3, deepseek-r1, etc.).
    // Pass through only when explicitly set so older models aren't
    // affected by an unknown field.
    if (think === false || think === true) body.think = think;

    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal,
            timeout: false,
        });
    } catch (e) {
        if (signal.aborted) {
            throw new Error(`Llama endpoint did not respond within ${Math.round(timeoutMs / 1000)}s.`);
        }
        throw e;
    }
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Llama endpoint returned ${response.status}: ${text || response.statusText}`);
    }
    const data = await response.json();
    if (!data.message) throw new Error('Llama endpoint did not return a `message` field.');
    return data.message.content ?? '';
}

export async function ollamaEmbed({ endpoint, model, input, keepAlive = DEFAULT_KEEP_ALIVE, timeoutMs = DEFAULT_EMBED_TIMEOUT_MS }) {
    const url = deriveEmbedUrl(endpoint);
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, input, keep_alive: keepAlive }),
            signal,
            timeout: false,
        });
    } catch (e) {
        if (signal.aborted) {
            throw new Error(`Embedding endpoint did not respond within ${Math.round(timeoutMs / 1000)}s.`);
        }
        throw e;
    }
    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Embed call returned ${response.status}: ${text || response.statusText}`);
    }
    const data = await response.json();
    if (!Array.isArray(data.embeddings)) {
        throw new Error('Embed endpoint did not return an `embeddings` array. Is the embedding model installed (`ollama pull <model>`)?');
    }
    return Array.isArray(input) ? data.embeddings : data.embeddings[0];
}

// Strip qwen-style reasoning blocks from a model response. Qwen3.5 emits
// <think>...</think> sections that bloat downstream parsing and are not
// part of the model's "user-visible" answer.
export function stripThinking(text) {
    return (text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}
