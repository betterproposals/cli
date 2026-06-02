import { z } from 'zod';
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'fs';
import { tmpdir, homedir } from 'os';
import { join, dirname } from 'path';
import { TOOLS, TOOLS_BY_NAME } from './tools.js';
import { resolveProvider, resolveApiKey, chatWithTools, formatToolResultMessage } from './provider.js';

// Agent loop that lets a locally-hosted Llama (or any Ollama-compatible
// endpoint) drive the Better Proposals tools exposed by `src/tools.js`.
// The web-app's simulated shell shells out to `betterproposals ai "<prompt>"`
// and reads the structured JSON response when --json is set.

const DEFAULT_ENDPOINT = 'http://localhost:11434/api/chat';
const DEFAULT_MODEL = 'llama3.2:1b';
// Default model when running against OpenRouter instead of local Ollama.
const DEFAULT_OPENROUTER_MODEL = 'qwen/qwen3.5-9b';
const DEFAULT_MAX_ITERATIONS = 8;
// Per-request timeout. Generous default because large local models on CPU
// can take minutes for a single response; overrideable via --timeout or env.
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
// Ollama defaults num_ctx to 2048, which silently truncates large tool
// results from the front. Set explicitly so the model actually sees what
// it's reasoning over.
const DEFAULT_NUM_CTX = 16384;
// Cap on how many array items we feed back from a tool result. Big
// paginated responses overwhelm small/local models even with a big
// context window. Results are sorted newest-first by the API, so keeping
// the first N preserves the most relevant data for date/recency queries.
const DEFAULT_MAX_TOOL_RESULT_ITEMS = 25;
// Cap on total persisted session messages (system prompt excluded). Older
// turns get dropped first when over the limit. Prevents the context from
// growing unbounded across many turns of a long conversation.
const DEFAULT_MAX_SESSION_MESSAGES = 40;

function buildDefaultSystem() {
    // Use the user's local date, not UTC — when the machine's TZ is ahead
    // of UTC (e.g. CET/CEST) right after midnight, toISOString() still
    // reports yesterday and the model ends up answering for the wrong day.
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return `You are the Better Proposals assistant. You help the user manage their proposals, companies, templates, and account settings by calling the provided tools.

Today's date is ${today}. Use this whenever the user asks about "today", "yesterday", or relative dates.

Rules:
- When the user asks about their Better Proposals data, call the appropriate tool. Never invent IDs, names, dates, or counts.
- Pass arguments as a JSON object matching the tool's parameter schema.
- Messages with role "tool" contain JSON data returned by a tool YOU just called. They are NOT new input from the user — they are the answer to your tool call. Read the JSON, extract the information the user asked for, and respond in natural language.
- Never tell the user "you've shared a JSON response" or ask them to clarify what to do with the tool data. They already asked their question; just answer it directly using the data.
- For date-based counting questions (e.g. "how many sent today/yesterday/this week"), the API returns items sorted newest-first. Page 1 ALWAYS contains the most recent items. Do NOT call the same paginated list tool again with page=2, page=3, etc. just to "check more" — if today's date isn't in page 1, it isn't in the dataset.
- Pagination guidance applies ONLY to paginated list tools (documents_list_*, companies_list, templates_list, currencies_list, document_types_list, settings_merge_tags). For write/get tools (documents_create, documents_get, companies_create, etc.) call them whenever they are needed — this restriction does not apply.
- When you have enough information, reply with a direct natural-language answer and stop calling tools.`;
}

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

// Per-tool field projections. The raw API responses include large nested
// blobs (PriceTables, Contacts, long Descriptions, full Preview URLs) that
// overwhelm small/local models and drown out the original question. We
// project each item down to the fields actually useful for answering
// typical questions; the full raw JSON is still written to disk for
// debugging or downstream consumers.
const DOCUMENT_FIELDS = ['ID', 'CompanyName', 'OriginalDateSent', 'DateCreated', 'SubjectLine', 'TypeID', 'CurrencyCode', 'OneOffTotal', 'MonthlyTotal', 'QuarterlyTotal', 'AnnualTotal'];

const TOOL_PROJECTIONS = {
    documents_list:        DOCUMENT_FIELDS,
    documents_list_new:    DOCUMENT_FIELDS,
    documents_list_opened: DOCUMENT_FIELDS,
    documents_list_sent:   DOCUMENT_FIELDS,
    documents_list_signed: DOCUMENT_FIELDS,
    documents_list_paid:   DOCUMENT_FIELDS,
    documents_get:         DOCUMENT_FIELDS,

    templates_list:        ['ID', 'TemplateName', 'TypeID', 'DateCreated', 'DateEdited', 'QuoteAmount', 'MonthlyAmount', 'QuarterlyAmount', 'AnnualAmount', 'Default'],
    companies_list:        ['ID', 'CompanyName', 'DateCreated', 'DateEdited'],
    currencies_list:       ['ID', 'CurrencyName', 'CurrencySymbol', 'CurrencyCode'],
    // Drop TypeIcon — it's an HTML <i> tag that the model often mistakes
    // for instruction markup.
    document_types_list:   ['ID', 'TypeName', 'TypeNameSingular', 'TypeColour', 'NumberOfOutstandingDocuments', 'NumberOfTemplates'],
    settings_merge_tags:   ['ID', 'Name', 'Tag', 'Fallback', 'Archived'],
    // Singletons — `data` is an object, not an array. Same projection
    // mechanism still applies via the `else if` branch in reduceToolResult.
    settings_get:          ['CurrencyID', 'Tax', 'TaxLabel', 'TaxAmount', 'TimeZone', 'DateEdited', 'CustomerJourneysActive', 'CustomerJourneysDefault'],
    settings_brand:        ['ID', 'Name', 'CompanyName', 'Default', 'PageTitle', 'CurrencyID', 'Tax', 'TaxLabel', 'TaxAmount', 'ShowBadge', 'DateCreated', 'DateEdited'],
};

// Where persisted conversation histories live, one JSON file per
// --session <id>. The web-app's simulated shell passes the same id for
// each prompt from a given user/conversation so the model retains context
// across CLI invocations (each `betterproposals ai` call is a separate
// process and would otherwise start fresh).
const SESSIONS_DIR = join(homedir(), '.betterproposals', 'sessions');

function sessionPath(id) {
    // Sanitize: only allow word chars, dashes, dots — sessions IDs come from
    // callers, so don't let them path-traverse.
    const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_');
    return join(SESSIONS_DIR, `${safe}.json`);
}

function loadSession(id) {
    if (!id) return [];
    const path = sessionPath(id);
    if (!existsSync(path)) return [];
    try {
        const parsed = JSON.parse(readFileSync(path, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveSession(id, messages, maxMessages) {
    if (!id) return;
    // System message is regenerated each run (today's date is dynamic), so
    // never persist it. Drop the oldest turns first if over the cap.
    const persisted = messages.filter((m) => m.role !== 'system');
    const trimmed = persisted.length > maxMessages
        ? persisted.slice(persisted.length - maxMessages)
        : persisted;
    const path = sessionPath(id);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(trimmed), 'utf8');
}

// Where we drop full raw tool responses for this process. Useful for
// debugging and for the web app's "show me what the model actually saw"
// affordance, without putting megabytes of JSON into the LLM context.
const RAW_DIR = join(tmpdir(), 'betterproposals-ai', `${process.pid}-${Date.now()}`);
let rawDirReady = false;
let rawCallIndex = 0;

function saveRawToolResponse(toolName, content) {
    if (!rawDirReady) {
        mkdirSync(RAW_DIR, { recursive: true });
        rawDirReady = true;
    }
    const path = join(RAW_DIR, `${String(rawCallIndex++).padStart(3, '0')}-${toolName}.json`);
    writeFileSync(path, content, 'utf8');
    return path;
}

function projectItem(item, fields) {
    const out = {};
    for (const k of fields) {
        if (k in item) out[k] = item[k];
    }
    return out;
}

// Reduce a raw tool response to what the model actually needs: project to
// key fields and cap the size of any `data` array. Always preserves
// `{status, data, _note, _total}` shape so existing JSON parsers work.
function reduceToolResult(toolName, content, savedPath, maxItems) {
    const fields = TOOL_PROJECTIONS[toolName];
    try {
        const obj = JSON.parse(content);

        if (Array.isArray(obj?.data)) {
            const total = obj.data.length;
            const sliced = obj.data.slice(0, maxItems);
            obj.data = fields ? sliced.map((it) => projectItem(it, fields)) : sliced;
            obj._note = total > maxItems
                ? `Showing the ${maxItems} newest of ${total} items${fields ? ', projected to key fields only' : ''}. Items not shown are STRICTLY OLDER (sorted newest-first). For recency questions like "today", "this week", etc., do NOT request page=2+ — those items are guaranteed to be older. Full raw JSON at ${savedPath}.`
                : `${fields ? 'Projected to key fields only. ' : ''}Full raw JSON at ${savedPath}.`;
            if (total > maxItems) obj._total = total;
            return JSON.stringify(obj);
        }

        if (fields && obj && typeof obj.data === 'object' && obj.data !== null) {
            obj.data = projectItem(obj.data, fields);
            obj._note = `Projected to key fields only. Full raw JSON at ${savedPath}.`;
            return JSON.stringify(obj);
        }

        return content;
    } catch {
        return content;
    }
}

// Takes a normalized tool call { id, name, args } as produced by the
// provider layer. `args` may be an object (Ollama) or a JSON string
// (OpenRouter / Llama 3.2) — both are accepted.
async function invokeTool(call) {
    const name = call.name;
    const tool = TOOLS_BY_NAME[name];
    if (!tool) return { ok: false, content: JSON.stringify({ error: `Unknown tool: ${name}` }) };

    let args = call.args;
    if (typeof args === 'string') {
        try { args = JSON.parse(args || '{}'); }
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

export async function runAgent({
    prompt,
    provider = resolveProvider(),
    apiKey,
    endpoint = process.env.BETTERPROPOSALS_LLAMA_URL || DEFAULT_ENDPOINT,
    model,
    system = buildDefaultSystem(),
    maxIterations = DEFAULT_MAX_ITERATIONS,
    timeoutMs = Number(process.env.BETTERPROPOSALS_LLAMA_TIMEOUT) * 1000 || DEFAULT_REQUEST_TIMEOUT_MS,
    numCtx = Number(process.env.BETTERPROPOSALS_LLAMA_NUM_CTX) || DEFAULT_NUM_CTX,
    maxToolResultItems = Number(process.env.BETTERPROPOSALS_LLAMA_MAX_TOOL_ITEMS) || DEFAULT_MAX_TOOL_RESULT_ITEMS,
    sessionId = process.env.BETTERPROPOSALS_LLAMA_SESSION || null,
    maxSessionMessages = Number(process.env.BETTERPROPOSALS_LLAMA_MAX_SESSION_MESSAGES) || DEFAULT_MAX_SESSION_MESSAGES,
    onEvent,
} = {}) {
    if (!prompt || typeof prompt !== 'string') {
        throw new Error('runAgent: `prompt` is required.');
    }

    // Provider-aware defaults: explicit model wins, else the env override
    // (Ollama only), else the per-provider default.
    if (!model) {
        model = provider === 'openrouter'
            ? DEFAULT_OPENROUTER_MODEL
            : (process.env.BETTERPROPOSALS_LLAMA_MODEL || DEFAULT_MODEL);
    }
    const resolvedKey = apiKey ?? resolveApiKey(provider);

    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    // Rehydrate prior turns from disk so the conversation feels continuous
    // across CLI invocations.
    messages.push(...loadSession(sessionId));
    messages.push({ role: 'user', content: prompt });

    const tools = TOOLS.map(toolToOllamaSpec);
    const trace = [];

    for (let i = 0; i < maxIterations; i++) {
        const { assistantMessage, toolCalls } = await chatWithTools({
            provider, endpoint, apiKey: resolvedKey, model, messages, tools, numCtx, timeoutMs,
        });
        messages.push(assistantMessage);
        onEvent?.({ type: 'assistant', iteration: i, content: assistantMessage.content, tool_calls: toolCalls });

        if (toolCalls.length === 0) {
            saveSession(sessionId, messages, maxSessionMessages);
            return { response: assistantMessage.content ?? '', trace, iterations: i + 1, truncated: false, provider, model };
        }

        for (const call of toolCalls) {
            const { content } = await invokeTool(call);
            const name = call.name;
            const rawPath = saveRawToolResponse(name, content);
            const slim = reduceToolResult(name, content, rawPath, maxToolResultItems);
            // Provider-specific tool-result framing (name vs tool_call_id).
            messages.push(formatToolResultMessage({ provider, toolCall: call, content: slim }));
            trace.push({
                tool: name,
                arguments: call.args,
                result: slim,
                raw_path: rawPath,
            });
            onEvent?.({ type: 'tool_result', name, content: slim, raw_path: rawPath });
        }
    }

    saveSession(sessionId, messages, maxSessionMessages);
    return {
        response: '(agent stopped: max iterations reached without a final answer)',
        trace,
        iterations: maxIterations,
        truncated: true,
        provider,
        model,
    };
}
