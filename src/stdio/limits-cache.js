import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { DEFAULT_LIMITS, normalize } from '../core/limits.js';

// The disk cache of the parameter limits of the logged-in account. It belongs
// to the local CLI and the stdio MCP server: they are one account per user and
// one process per session, so a file in the home directory is a good warm
// start. The hosted server never touches the disk.

const CACHE_PATH = join(homedir(), '.betterproposals', 'limits.json');
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

/**
 * The limits store of the local CLI and the stdio MCP server.
 *
 * Remembers the answer for the life of the process: the authoritative value
 * comes from a live call, because a single process may be driving a different
 * account than the last one did (setOverrideToken, or a re-login), which is
 * what clear() is for. The disk cache is a warm start for the advisory prose
 * and the fallback when the live call fails, not the basis for rejecting a
 * request.
 */
export function createStdioLimitsStore({ read = readLimitsCache, write = writeLimitsCache } = {}) {
    let pending = null;

    return {
        resolve(load) {
            pending ??= load().then((limits) => {
                if (limits.source === 'api') {
                    write(limits);
                    return limits;
                }
                return read() ?? limits;
            });
            return pending;
        },

        clear() {
            pending = null;
        },
    };
}
