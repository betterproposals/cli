import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { embedText, chatText } from './provider.js';

// Vector-cosine-similarity triage. The user prompt (translated to English
// first) is embedded once, then compared against two pre-embedded anchor
// sets. The path whose strongest anchor has the higher cosine similarity
// wins. Max-similarity (rather than average) is used so that a strong
// match against one specific anchor isn't diluted by unrelated anchors.

export const DEFAULT_EMBED_MODEL = 'nomic-embed-text';

// Representative "how do I X" / informational questions across the
// help.betterproposals.io categories: Getting Started, Editor, Proposals,
// Templates, Branding, Integrations, Settings, Nudge.
export const GENERAL_ANCHORS = [
    // Getting Started
    'How do I get started with Better Proposals?',
    'Where do I begin after signing up?',
    // Editor
    'How do I add a price table to my proposal?',
    'How do I customize the design of a proposal?',
    'How do I use the proposal editor?',
    'How do I add images and text blocks to a proposal?',
    // Proposals lifecycle
    'How do I create a new proposal?',
    'How do I send a proposal to a client?',
    'How do I track when a client opens my proposal?',
    'How do I let my client sign and pay through the proposal?',
    // Templates
    'How do I create a template?',
    'How do I use an existing template?',
    'Where do I find pre-built templates?',
    // Branding
    'How do I customize my brand logo and colors?',
    'How do I set up my company branding?',
    'Where do I change the fonts on my proposals?',
    // Integrations
    'How do I connect my CRM to Better Proposals?',
    'How do I set up Stripe for payments?',
    'How do I integrate Better Proposals with Zapier?',
    // Settings
    'How do I change my password?',
    'How do I set up tax for my proposals?',
    'How do I change my default currency?',
    'How do I invite a team member?',
    // Nudge
    'How does the Nudge follow-up feature work?',
    'How do I set up automated reminders for unopened proposals?',
];

// Anchors derived from src/tools.js — typical phrasings of questions that
// would be answered by calling one of the MCP tools.
export const MCP_ANCHORS = [
    // documents (read)
    'How many proposals did I send today?',
    'Show me my sent proposals',
    'Show me my paid proposals',
    'How many documents do I have in total?',
    'List my recent proposals',
    'Which proposals have been signed?',
    'Which proposals were opened by clients?',
    'Show me the proposal with ID 12345',
    'Give me details about document 12345',
    // documents (create)
    'Create a new proposal for company Acme',
    'Make a new proposal cover with the title My Proposal',
    // companies
    'List all my companies',
    'Show me details for the company with ID 12345',
    'Create a new company called Acme Inc',
    // templates
    'What templates do I have?',
    'Show me details for template 12345',
    // currencies
    'What currencies are supported?',
    'Show me details for currency EUR',
    // settings
    'What are my account settings?',
    'Show me my brand settings',
    'List my custom merge tags',
    // document types
    'List my custom document types',
    'Create a new document type called Quote',
];

// Cache keyed by embed model: nomic (768-dim, local) and
// text-embedding-3-small (1536-dim, OpenRouter) produce incompatible
// vectors, so switching providers must not reuse the other's cache.
function anchorsCachePath(embedModel) {
    const safe = String(embedModel).replace(/[^A-Za-z0-9._-]/g, '_');
    return join(homedir(), '.betterproposals', `triage-anchors-${safe}.json`);
}

// Lightweight fingerprint to invalidate the cache when anchor arrays
// change. Doesn't need to be cryptographic — collisions just mean a
// recompute, which is cheap.
function anchorsFingerprint() {
    return [
        GENERAL_ANCHORS.length,
        MCP_ANCHORS.length,
        GENERAL_ANCHORS[0],
        MCP_ANCHORS[0],
        GENERAL_ANCHORS[GENERAL_ANCHORS.length - 1],
        MCP_ANCHORS[MCP_ANCHORS.length - 1],
    ].join('||');
}

export function cosineSimilarity(a, b) {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function ensureAnchorEmbeddings({ provider, embedEndpoint, apiKey, embedModel }) {
    const fingerprint = anchorsFingerprint();
    const cachePath = anchorsCachePath(embedModel);
    if (existsSync(cachePath)) {
        try {
            const cached = JSON.parse(readFileSync(cachePath, 'utf8'));
            if (cached.model === embedModel && cached.fingerprint === fingerprint) {
                return cached;
            }
        } catch {
            // Corrupt cache — fall through and recompute.
        }
    }

    // Both providers' embed endpoints accept an array of inputs in one call.
    const generalEmbeds = await embedText({ provider, endpoint: embedEndpoint, apiKey, model: embedModel, input: GENERAL_ANCHORS });
    const mcpEmbeds = await embedText({ provider, endpoint: embedEndpoint, apiKey, model: embedModel, input: MCP_ANCHORS });

    const data = {
        model: embedModel,
        fingerprint,
        general: generalEmbeds,
        mcp: mcpEmbeds,
    };
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, JSON.stringify(data), 'utf8');
    return data;
}

export async function triage(prompt, { provider = 'ollama', embedEndpoint, apiKey, embedModel = DEFAULT_EMBED_MODEL } = {}) {
    const anchors = await ensureAnchorEmbeddings({ provider, embedEndpoint, apiKey, embedModel });
    const promptEmbed = await embedText({ provider, endpoint: embedEndpoint, apiKey, model: embedModel, input: prompt });

    let generalScore = -Infinity;
    let generalBest = null;
    anchors.general.forEach((e, i) => {
        const s = cosineSimilarity(promptEmbed, e);
        if (s > generalScore) { generalScore = s; generalBest = GENERAL_ANCHORS[i]; }
    });

    let mcpScore = -Infinity;
    let mcpBest = null;
    anchors.mcp.forEach((e, i) => {
        const s = cosineSimilarity(promptEmbed, e);
        if (s > mcpScore) { mcpScore = s; mcpBest = MCP_ANCHORS[i]; }
    });

    return {
        path: mcpScore >= generalScore ? 'mcp' : 'general',
        generalScore,
        mcpScore,
        margin: Math.abs(mcpScore - generalScore),
        generalBest,
        mcpBest,
    };
}

const INTENT_SYSTEM = `You route the latest user message for the "Better Proposals" assistant, which has tools to read and modify the user's own account data (proposals, documents, quotes, contracts, companies, templates, covers, document types, currencies, merge tags, and account/brand/tax settings).

Reply "MCP" if the message is a COMMAND or a DATA QUESTION about the user's own account, for example:
- imperative actions: "create a proposal about X", "make a draft for Y", "send it", "delete that", "add a company"
- data lookups: "how many proposals did I send today", "what are my settings", "list my templates", "show my companies"
- a short follow-up that continues such a task: "yes, do it", "set the tax to 21%", "the second one"

Reply "GENERAL" if the message is an INSTRUCTIONAL / how-to / informational question about how to use the product — typically phrased "how do I…", "how can I…", "how to…", "where do I…", "what is…", "can I…". These want an explanation, not an action on the user's data, EVEN IF they mention verbs like add, create, or send.

When genuinely ambiguous, prefer MCP.
Reply with exactly one word: MCP or GENERAL.`;

// Complementary intent gate. Cosine similarity confuses "how do I create a
// proposal" (how-to → general) with "create a proposal" (action → mcp)
// because the anchors are lexically near. This LLM step re-checks a
// general verdict and flips it to mcp when the message is really an
// action/query on the user's data — enforcing "MCP has priority". Given an
// optional `context` (recent conversation), follow-ups stay on track.
export async function classifyMcpIntent(englishPrompt, { provider = 'ollama', endpoint, apiKey, model, timeoutMs, context } = {}) {
    const messages = [{ role: 'system', content: INTENT_SYSTEM }];
    if (context) {
        messages.push({ role: 'user', content: `Recent conversation (for context only):\n${context}` });
    }
    messages.push({ role: 'user', content: `Latest message: ${englishPrompt}` });
    const raw = await chatText({ provider, endpoint, apiKey, model, messages, timeoutMs });
    // Bias to MCP: only an explicit, sole GENERAL keeps the general path.
    return /\bGENERAL\b/i.test(raw) && !/\bMCP\b/i.test(raw) ? 'general' : 'mcp';
}
