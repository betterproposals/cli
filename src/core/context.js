import { AsyncLocalStorage } from 'node:async_hooks';

const DEFAULT_API_URL = 'https://api.betterproposals.io';

const storage = new AsyncLocalStorage();

// What the process registered once at startup (the stdio CLI registers the
// keychain token here). A request context created with runWithContext() starts
// from these and overrides what it needs.
let defaults = {};
let envConfig = null;

/**
 * A JSON object of header names to string values, read from an environment
 * variable (empty when it is not set). Throws a message naming the variable.
 */
export function parseHeadersEnv(raw, name) {
    if (!raw) return {};

    let parsed;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error(`${name} must be a JSON object, for example {"Host":"api.example.com"}.`);
    }
    const valid = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        && Object.values(parsed).every((value) => typeof value === 'string');
    if (!valid) {
        throw new Error(`${name} must be a JSON object of header names to string values.`);
    }

    return parsed;
}

/**
 * API location and extra headers from the environment.
 *
 * BP_API_URL: base URL of the API, defaults to the production API.
 * BP_API_HEADERS: JSON object of extra headers sent with every API request
 * (for example a Host header when the API is reached over a private route).
 */
export function loadApiConfig(env = process.env) {
    const raw = env.BP_API_URL || DEFAULT_API_URL;
    try {
        new URL(raw);
    } catch {
        throw new Error(`BP_API_URL is not a valid URL: ${raw}`);
    }

    const headers = parseHeadersEnv(env.BP_API_HEADERS, 'BP_API_HEADERS');

    return { baseUrl: raw.replace(/\/+$/, ''), headers };
}

async function noAuth() {
    throw new Error('No authentication is configured for this process.');
}

function resolveDefaults() {
    envConfig ??= loadApiConfig();
    return {
        baseUrl: envConfig.baseUrl,
        headers: envConfig.headers,
        getAuthHeaders: noAuth,
        refreshAuth: null,
        limitsStore: null,
        ...defaults,
    };
}

/**
 * Register process-wide defaults. Used once at startup by the entry point.
 *
 * Context fields:
 * - baseUrl, headers: where the API is and the extra headers to send
 * - getAuthHeaders(): resolves the authentication headers for one API request
 * - refreshAuth(): called once after a 401 so the request can be retried;
 *   leave it null when a 401 should simply fail
 * - limitsStore: remembers the parameter limits of the account (see
 *   limits-store.js); null looks them up on every use
 */
export function setDefaultContext(partial) {
    defaults = { ...defaults, ...partial };
}

/** The context of the running request, or the process defaults outside one. */
export function getContext() {
    return storage.getStore() ?? resolveDefaults();
}

/** Run fn with its own context. Concurrent runs never see each other's. */
export function runWithContext(partial, fn) {
    return storage.run({ ...resolveDefaults(), ...partial }, fn);
}

/** Forget what was read from the environment and registered at startup. Tests only. */
export function resetContextForTests() {
    defaults = {};
    envConfig = null;
}
