const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 1000;

/**
 * Per-account memory for the parameter limits, for a server handling many
 * accounts in one process.
 *
 * A limits store is what the context carries as `limitsStore`: resolve(load)
 * returns the remembered limits, or runs load() once and remembers the result;
 * clear() forgets it. Concurrent callers of the same account share one load.
 * Only a limit that came live from the API is remembered (and for ttlMs): a
 * failed lookup falls back to the defaults and is looked up again next time.
 */
export function createLimitsRegistry({ ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now } = {}) {
    const entries = new Map();

    function evict() {
        while (entries.size > maxEntries) {
            entries.delete(entries.keys().next().value);
        }
    }

    return {
        forAccount(accountId) {
            const key = String(accountId);

            return {
                resolve(load) {
                    const entry = entries.get(key);
                    if (entry && now() - entry.at < ttlMs) return entry.promise;

                    const fresh = { promise: load(), at: now() };
                    entries.delete(key);
                    entries.set(key, fresh);
                    evict();

                    fresh.promise.then(
                        (limits) => { if (limits.source !== 'api' && entries.get(key) === fresh) entries.delete(key); },
                        () => { if (entries.get(key) === fresh) entries.delete(key); },
                    );

                    return fresh.promise;
                },

                clear() {
                    entries.delete(key);
                },
            };
        },

        get size() {
            return entries.size;
        },
    };
}
