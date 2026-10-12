import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';

// The API rejects any single POST value over a per-account budget, lists over
// a max number of entries and requests over a max size (see the Flight::before
// hook in the API's public/index.php). Agents have no
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
    Description: 'description',
    Title: 'title',
    Tables: 'tables',
    Recipients: 'recipients',
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

// The API checks every single value (scope per_value): JSON parameters like
// Tables or MergeTags are decoded and checked value by value, in characters,
// with the lists limited in number of entries. Older API versions check every
// parameter as a whole, in bytes (scope per_parameter, the default here).
export function isPerValue(limits) {
    return limits?.scope === 'per_value';
}

// PHP's mb_strlen() counts code points, like the spread of a JS string.
export function charLength(value) {
    return [...String(value)].length;
}

// Limits are keyed by path without list indexes, lowercased by the API
// (e.g. tables.items.description).
export function fieldMaxLength(limits, path) {
    return limits.field_max_length?.[path.toLowerCase()] ?? limits.parameter_max_length;
}

export function listMaxItems(limits, path) {
    return limits.list_max_items?.[path.toLowerCase()] ?? limits.list_max_items_default ?? 100;
}

// One sentence, shared by the MCP instructions, the agent system prompt, and
// the write tools' field descriptions, so the number is stated identically
// everywhere it appears.
export function describeLimit(limits = getCachedLimits()) {
    const max = limits.parameter_max_length;
    const hedge = limits.source === 'default'
        ? ' (the standard limit; call the api_limits tool to confirm this account\'s exact budget)'
        : '';

    if (isPerValue(limits)) {
        return `Each single value sent when creating or updating data is capped at ${max} characters${hedge}, ` +
            'also inside JSON parameters (every label, description, merge tag value counts on its own). ' +
            'Some fields allow more and lists have a max number of entries: call api_limits for the details.';
    }

    return `Each individual parameter sent when creating or updating data is capped at ${max} bytes${hedge}. ` +
        'The cap is per parameter, not per request, and is measured in UTF-8 bytes — ' +
        'accented and non-Latin characters cost 2-4 bytes each.';
}

// Short notes appended to the write tools' field descriptions.
export function valueLimitNote(limits = getCachedLimits()) {
    return isPerValue(limits)
        ? ` Max ${limits.parameter_max_length} characters (call api_limits to confirm this account's exact budget).`
        : ` Max ${limits.parameter_max_length} bytes (call api_limits to confirm this account's exact budget).`;
}

export function jsonLimitNote(limits = getCachedLimits()) {
    return isPerValue(limits)
        ? ` Every value inside the JSON is limited on its own (max ${limits.parameter_max_length} characters, ` +
            'some fields allow more) and lists have a max number of entries: call api_limits for the details.'
        : ` The entire JSON string counts as a single parameter against the ${limits.parameter_max_length}-byte limit — ` +
            'all entries share that one budget, so keep values short or send fewer at a time.';
}

function labelFor(key, path) {
    const alias = FIELD_ALIASES[key];
    return alias ? `"${alias}" (sent as ${path})` : `"${path}"`;
}

// Same as Utility::PARAMETER_MAX_DEPTH in the API.
const PARAMETER_MAX_DEPTH = 6;

// Mirror of Utility::validateParameterValue() in the API.
function assertValue(value, path, label, depth, limits, key) {
    if (typeof value === 'string' && /^\s*[[{]/.test(value)) {
        try {
            const decoded = JSON.parse(value);
            if (decoded && typeof decoded === 'object') value = decoded;
        } catch { /* not JSON, checked as a string */ }
    }

    if (value && typeof value === 'object') {
        if (depth > PARAMETER_MAX_DEPTH) {
            throw new Error(`${labelFor(key, label)} cannot be nested more than ${PARAMETER_MAX_DEPTH} levels.`);
        }

        if (Array.isArray(value)) {
            const max = listMaxItems(limits, path);
            if (value.length > max) {
                throw new Error(
                    `${labelFor(key, label)} has ${value.length} entries; the API allows ${max} per request. ` +
                    'Send the rest with another request.'
                );
            }
            value.forEach((child, i) => assertValue(child, path, `${label}[${i}]`, depth + 1, limits, key));
        } else {
            for (const [childKey, child] of Object.entries(value)) {
                assertValue(child, `${path}.${childKey}`, `${label}.${childKey}`, depth + 1, limits, key);
            }
        }
        return;
    }

    if (value === undefined || value === null) return;

    const max = fieldMaxLength(limits, path);
    const size = charLength(value);
    if (size > max) {
        throw new Error(`${labelFor(key, label)} is ${size} characters; the API limit is ${max} characters. Shorten it.`);
    }
}

/**
 * Reject an over-limit request body before it reaches the network.
 *
 * Mirrors the server's own measurement. Throws on the first offender with the
 * field named and its actual size, so an agent can fix the input instead of
 * guessing at an opaque 400.
 */
export function assertParamLengths(body, limits) {
    if (!limits?.enforced) return; // server only logs; don't be stricter than it is

    if (isPerValue(limits)) {
        for (const [key, value] of Object.entries(body)) {
            assertValue(value, key, key, 1, limits, key);
        }
        return;
    }

    const max = limits.parameter_max_length;

    for (const [key, value] of Object.entries(body)) {
        if (value === undefined || value === null) continue;

        const size = Array.isArray(value)
            ? byteLength(value.flat(Infinity).join(''))
            : byteLength(value);

        if (size <= max) continue;

        throw new Error(
            `${labelFor(key, key)} is ${size} bytes; the API limit is ${max} bytes per parameter. ` +
            'Shorten it or split the content across multiple parameters. ' +
            'Note the limit counts UTF-8 bytes, so non-ASCII characters cost more than one each.'
        );
    }
}

// Whole request body, checked on the encoded form in api.js.
export function assertRequestLength(encodedBody, limits) {
    if (!limits?.enforced || !isPerValue(limits) || !(limits.request_max_length > 0)) return;

    const size = byteLength(encodedBody);
    if (size > limits.request_max_length) {
        throw new Error(
            `The request is ${size} bytes; the API limit is ${limits.request_max_length} bytes per request. ` +
            'Send the content with more requests.'
        );
    }
}
