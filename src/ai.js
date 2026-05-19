import { z } from 'zod';
import { TOOLS, TOOLS_BY_NAME } from './tools.js';

// Agent loop that lets a locally-hosted Llama (or any Ollama-compatible
// endpoint) drive the Better Proposals tools exposed by `src/tools.js`.
// The web-app's simulated shell shells out to `betterproposals ai "<prompt>"`
// and reads the structured JSON response when --json is set.

const DEFAULT_ENDPOINT = 'http://localhost:11434/api/chat';
const DEFAULT_MODEL = 'llama3.2:1b';
const DEFAULT_MAX_ITERATIONS = 8;
// Per-request timeout. Generous default because large local models on CPU
// can take minutes for a single response; overrideable via --timeout or env.
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

const DEFAULT_SYSTEM = `You are the Better Proposals assistant. You help the user manage their proposals, companies, templates, and account settings by calling the provided tools.

Rules:
- Always use a tool when the user is asking about their actual Better Proposals data. Never invent IDs, names, or counts.
- Pass arguments as a JSON object matching the tool's parameter schema.
- When you have enough information to answer, reply directly in plain text without calling any more tools.`;

// Minimal zod → JSON-Schema converter covering the types used in src/tools.js
// (ZodString with .length, ZodNumber with .int/.positive, ZodOptional, ZodDefault).
// We intentionally avoid pulling in `zod-to-json-schema` to keep the dep tree small.
function zodFieldToJsonSchema(field) {
    let inner = field;
    let optional = false;
    let hasDefault = false;
    let defaultValue;

    while (true) {
        const typeName = inner?._def?.typeName;
        if (typeName === 'ZodDefault') {
            hasDefault = true;
            defaultValue = inner._def.defaultValue();
            inner = inner._def.innerType;
        } else if (typeName === 'ZodOptional') {
            optional = true;
            inner = inner._def.innerType;
        } else {
            break;
        }
    }

    const description = field.description ?? inner.description;
    const out = {};
    if (description) out.description = description;

    const typeName = inner._def.typeName;
    if (typeName === 'ZodString') {
        out.type = 'string';
        for (const check of inner._def.checks ?? []) {
            if (check.kind === 'length') {
                out.minLength = check.value;
                out.maxLength = check.value;
            }
        }
    } else if (typeName === 'ZodNumber') {
        out.type = 'number';
        for (const check of inner._def.checks ?? []) {
            if (check.kind === 'int') out.type = 'integer';
            if (check.kind === 'min' && check.value > 0) out.exclusiveMinimum = 0;
        }
    } else {
        // Fall back to string for any unhandled zod type rather than crashing.
        out.type = 'string';
    }

    if (hasDefault) out.default = defaultValue;
    return { schema: out, required: !optional && !hasDefault };
}

function zodShapeToJsonSchema(shape) {
    const properties = {};
    const required = [];
    for (const [key, field] of Object.entries(shape)) {
        const { schema, required: isRequired } = zodFieldToJsonSchema(field);
        properties[key] = schema;
        if (isRequired) required.push(key);
    }
    const out = { type: 'object', properties };
    if (required.length > 0) out.required = required;
    return out;
}

function toolToOllamaSpec(tool) {
    return {
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description,
            parameters: zodShapeToJsonSchema(tool.inputSchema),
        },
    };
}

async function invokeTool(call) {
    const name = call.function?.name;
    const tool = TOOLS_BY_NAME[name];
    if (!tool) return { ok: false, content: JSON.stringify({ error: `Unknown tool: ${name}` }) };

    let args = call.function?.arguments;
    // Llama 3.2 sometimes returns `arguments` as a JSON string instead of an
    // object; accept both shapes.
    if (typeof args === 'string') {
        try { args = JSON.parse(args); }
        catch { return { ok: false, content: JSON.stringify({ error: `Could not parse arguments for ${name}` }) }; }
    }
    args ??= {};

    try {
        const validated = z.object(tool.inputSchema).parse(args);
        const result = await tool.handler(validated);
        return { ok: true, content: JSON.stringify(result) };
    } catch (e) {
        return { ok: false, content: JSON.stringify({ error: e.message }) };
    }
}

async function callOllama({ endpoint, model, messages, tools, timeoutMs }) {
    // Use our own AbortSignal as the single source of truth for timing,
    // and disable Bun's built-in ~5min fetch timeout via `timeout: false`
    // (no-op on Node/undici, the fix on Bun). `signal.aborted` lets us
    // distinguish our timeout from connection/HTTP errors in the catch.
    const signal = AbortSignal.timeout(timeoutMs);
    let response;
    try {
        response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, tools, stream: false }),
            signal,
            timeout: false,
        });
    } catch (e) {
        if (signal.aborted) {
            throw new Error(
                `Llama endpoint did not respond within ${Math.round(timeoutMs / 1000)}s. ` +
                'Large local models can be slow, especially on CPU. ' +
                'Increase the limit with --timeout <seconds> or BETTERPROPOSALS_LLAMA_TIMEOUT (seconds).'
            );
        }
        throw e;
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Llama endpoint returned ${response.status}: ${text || response.statusText}`);
    }

    const data = await response.json();
    if (!data.message) {
        throw new Error('Llama endpoint did not return a `message` field. Is this an Ollama-compatible /api/chat endpoint?');
    }
    return data;
}

export async function runAgent({
    prompt,
    endpoint = process.env.BETTERPROPOSALS_LLAMA_URL || DEFAULT_ENDPOINT,
    model = process.env.BETTERPROPOSALS_LLAMA_MODEL || DEFAULT_MODEL,
    system = DEFAULT_SYSTEM,
    maxIterations = DEFAULT_MAX_ITERATIONS,
    timeoutMs = Number(process.env.BETTERPROPOSALS_LLAMA_TIMEOUT) * 1000 || DEFAULT_REQUEST_TIMEOUT_MS,
    onEvent,
} = {}) {
    if (!prompt || typeof prompt !== 'string') {
        throw new Error('runAgent: `prompt` is required.');
    }

    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: prompt });

    const tools = TOOLS.map(toolToOllamaSpec);
    const trace = [];

    for (let i = 0; i < maxIterations; i++) {
        const data = await callOllama({ endpoint, model, messages, tools, timeoutMs });
        const msg = data.message;
        messages.push(msg);
        onEvent?.({ type: 'assistant', iteration: i, content: msg.content, tool_calls: msg.tool_calls });

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
            return { response: msg.content ?? '', trace, iterations: i + 1, truncated: false };
        }

        for (const call of msg.tool_calls) {
            const { content } = await invokeTool(call);
            messages.push({ role: 'tool', content });
            trace.push({
                tool: call.function?.name,
                arguments: call.function?.arguments,
                result: content,
            });
            onEvent?.({ type: 'tool_result', name: call.function?.name, content });
        }
    }

    return {
        response: '(agent stopped: max iterations reached without a final answer)',
        trace,
        iterations: maxIterations,
        truncated: true,
    };
}
