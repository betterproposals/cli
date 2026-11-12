import { createHash } from 'node:crypto';

const DEFAULT_MARGIN_MS = 30 * 1000;
const DEFAULT_REFUSAL_MS = 10 * 1000;
const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_TIMEOUT_MS = 10 * 1000;

/**
 * The swap endpoint refused or could not be reached.
 * kind: 'invalid_token' (unknown, expired or revoked access token),
 * 'not_eligible' (the account may not use the MCP), or 'unavailable'.
 */
export class SwapError extends Error {
    constructor(kind, message) {
        super(message);
        this.name = 'SwapError';
        this.kind = kind;
    }
}

/** The account id carried by an internal token. It is not verified here: the API does that. */
export function accountIdFromInternalToken(token) {
    try {
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
        if (Number.isInteger(claims.aid) && claims.aid > 0) return claims.aid;
    } catch { /* falls through */ }
    throw new SwapError('unavailable', 'The swap endpoint returned a token without an account.');
}

/**
 * Exchanges the access token a client presents for the short-lived internal
 * token the API accepts. The user's own token never travels to the API.
 *
 * exchange(accessToken) resolves { internalToken, accountId, expiresAt } and
 * rejects with a SwapError. A token is remembered until `marginMs` before it
 * expires; concurrent calls for the same access token share one request; a
 * refusal is remembered briefly (`refusalMs`) so a bad token cannot be used to
 * hammer the main app. An unreachable endpoint is never remembered.
 */
export function createSwapClient({
    swapUrl,
    secret,
    headers = {},
    fetchImpl = fetch,
    now = Date.now,
    marginMs = DEFAULT_MARGIN_MS,
    refusalMs = DEFAULT_REFUSAL_MS,
    maxEntries = DEFAULT_MAX_ENTRIES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
    const entries = new Map();

    async function callSwap(accessToken) {
        let response;
        try {
            response = await fetchImpl(swapUrl, {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'X-Service-Credential': secret,
                },
                body: new URLSearchParams({ access_token: accessToken }).toString(),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch {
            throw new SwapError('unavailable', 'The sign-in service could not be reached.');
        }

        if (response.status === 401) {
            // 401 is also what a wrong service credential gets: tell them apart
            const body = await response.json().catch(() => ({}));
            if (body.error === 'invalid_token') throw new SwapError('invalid_token', 'The access token is invalid or expired.');
            throw new SwapError('unavailable', 'The sign-in service refused this server.');
        }
        if (response.status === 403) {
            throw new SwapError('not_eligible', 'This account cannot use the Better Proposals MCP connector.');
        }
        if (!response.ok) {
            throw new SwapError('unavailable', `The sign-in service answered ${response.status}.`);
        }

        const body = await response.json().catch(() => ({}));
        if (typeof body.internal_token !== 'string' || !Number.isFinite(body.expires_in)) {
            throw new SwapError('unavailable', 'The sign-in service sent an unexpected answer.');
        }

        return {
            internalToken: body.internal_token,
            accountId: accountIdFromInternalToken(body.internal_token),
            expiresAt: now() + body.expires_in * 1000,
        };
    }

    function evict() {
        while (entries.size > maxEntries) {
            entries.delete(entries.keys().next().value);
        }
    }

    return {
        exchange(accessToken) {
            const key = createHash('sha256').update(accessToken).digest('hex');

            const entry = entries.get(key);
            if (entry && now() < entry.validUntil) return entry.promise;

            const fresh = { promise: callSwap(accessToken), validUntil: Infinity };
            entries.delete(key);
            entries.set(key, fresh);
            evict();

            fresh.promise.then(
                (session) => { fresh.validUntil = session.expiresAt - marginMs; },
                (error) => {
                    if (error.kind === 'unavailable') {
                        if (entries.get(key) === fresh) entries.delete(key);
                    } else {
                        fresh.validUntil = now() + refusalMs;
                    }
                },
            );

            return fresh.promise;
        },

        get size() {
            return entries.size;
        },
    };
}
