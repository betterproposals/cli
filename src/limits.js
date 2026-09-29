import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';

// The API rejects any single POST parameter over a per-account byte budget
// (see the Flight::before hook in the API's public/index.php). Agents have no
// way to guess that budget, so the API exposes it at GET /settings/limits and
// this module caches, describes, and enforces it client-side.
//
// Pure cache + measurement logic only — the HTTP call lives in api.js, which
// owns auth and retries. Keeping the dependency one-way (api.js → limits.js)
// avoids an import cycle.

const CACHE_PATH = join(homedir(), '.betterproposals', 'limits.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// Conservative fallback: the standard limit every account gets. Used whenever
// the API can't tell us better (older deploy without the endpoint, no network,
// not logged in). Under-promising is safe; over-promising produces a 400.
export const DEFAULT_PARAMETER_MAX_LENGTH = 1000;

export const DEFAULT_LIMITS = Object.freeze({
    parameter_max_length: DEFAULT_PARAMETER_MAX_LENGTH,
    increased: false,
    enforced: true,
    scope: 'per_parameter',
    applies_to: 'POST',
    measured_in: 'bytes',
    source: 'default',
});

// Tool argument names (what an agent passes) differ in case/style from the API
// parameter names (what the request body carries). Validation happens at the
// request layer, where only the API name is known, so map back for the error
// message. Only the write tools' fields need an entry.
const FIELD_ALIASES = {
    MergeTags: 'merge_tags',
    Contacts: 'contacts',
    CompanyName: 'company_name',
    TypeName: 'type_name',
    TypeColour: 'type_colour',
    CoverName: 'cover_name',
    Headline: 'headline',
    Subheader: 'subheader',
    ButtonText: 'button_text',
    BGColour: 'bg_colour',
    TextColour: 'text_colour',
    TextAlign: 'text_align',
    ButtonStyle: 'button_style',
    DocumentType: 'document_type',
    TaxLabel: 'tax_label',
    TaxAmount: 'tax_amount',
};

// PHP's strlen() counts BYTES. JS string .length counts UTF-16 code units, so a
// 600-character Turkish or CJK string can be well over 1000 bytes while looking
// safely under the limit. Measure the way the server does or the check is a lie.
export function byteLength(value) {
    return Buffer.byteLength(String(value), 'utf8');
}

function normalize(data) {
    if (!data || typeof data !== 'object') return { ...DEFAULT_LIMITS };
    const max = Number(data.parameter_max_length);
    return {
        ...DEFAULT_LIMITS,
        ...data,
        parameter_max_length: Number.isFinite(max) && max > 0 ? max : DEFAULT_PARAMETER_MAX_LENGTH,
    };
}

export function readLimitsCache() {
    try {
        const cache = JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
        if (Date.now() - (cache.checkedAt || 0) > CACHE_TTL_MS) return null;
        return normalize(cache.limits);
    } catch {
        return null;
    }
}

export function writeLimitsCache(limits) {
    try {
        mkdirSync(dirname(CACHE_PATH), { recursive: true });
        writeFileSync(CACHE_PATH, JSON.stringify({ checkedAt: Date.now(), limits }) + '\n', 'utf8');
    } catch {
        /* caching is an optimisation; never fail a real operation over it */
    }
}

// The limit is per-account, so a cache left behind by a previous login would
// report the wrong number. Called from auth.js on login and logout.
export function clearLimitsCache() {
    try { unlinkSync(CACHE_PATH); } catch { /* nothing cached */ }
}

// Synchronous, cache-only view for the places that can't await: the MCP server
// `instructions` string and the static tool descriptions, both built at module
// load. Advisory prose only — never the basis for rejecting a request.
export function getCachedLimits() {
    return readLimitsCache() ?? { ...DEFAULT_LIMITS };
}

// One sentence, shared by the MCP instructions, the agent system prompt, and
// the write tools' field descriptions, so the number is stated identically
// everywhere it appears.
export function describeLimit(limits = getCachedLimits()) {
    const max = limits.parameter_max_length;
    const hedge = limits.source === 'default'
        ? ' (the standard limit; call the api_limits tool to confirm this account\'s exact budget)'
        : '';
    return `Each individual parameter sent when creating or updating data is capped at ${max} bytes${hedge}. ` +
        'The cap is per parameter, not per request, and is measured in UTF-8 bytes — ' +
        'accented and non-Latin characters cost 2-4 bytes each.';
}

/**
 * Reject an over-limit request body before it reaches the network.
 *
 * Mirrors the server's own measurement: each parameter independently, arrays
 * flattened and concatenated, counted in UTF-8 bytes. Throws on the first
 * offender with the field named and its actual size, so an agent can fix the
 * input instead of guessing at an opaque 400.
 */
export function assertParamLengths(body, limits) {
    if (!limits?.enforced) return; // server only logs; don't be stricter than it is

    const max = limits.parameter_max_length;

    for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;

        const size = Array.isArray(value)
            ? byteLength(value.flat(Infinity).join(''))
            : byteLength(value);

        if (size <= max) continue;

        const alias = FIELD_ALIASES[key];
        const label = alias ? `"${alias}" (sent as ${key})` : `"${key}"`;
        throw new Error(
            `${label} is ${size} bytes; the API limit is ${max} bytes per parameter. ` +
            'Shorten it or split the content across multiple parameters. ' +
            'Note the limit counts UTF-8 bytes, so non-ASCII characters cost more than one each.'
        );
    }
}
