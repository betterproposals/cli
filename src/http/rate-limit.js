const DEFAULT_WINDOW_MS = 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10000;

/**
 * A fixed window counter per key (here: per user). check(key) resolves
 * { allowed, retryAfterSeconds }. A limit of 0 switches it off. The map is
 * bounded: expired windows are swept when it grows past maxEntries, and the
 * oldest entries go if that is not enough.
 */
export function createRateLimiter({ limit, windowMs = DEFAULT_WINDOW_MS, maxEntries = DEFAULT_MAX_ENTRIES, now = Date.now }) {
    const windows = new Map();

    function sweep() {
        const time = now();
        for (const [key, entry] of windows) {
            if (entry.resetAt <= time) windows.delete(key);
        }
        while (windows.size > maxEntries) {
            windows.delete(windows.keys().next().value);
        }
    }

    return {
        check(key) {
            if (!limit) return { allowed: true, retryAfterSeconds: 0 };

            const time = now();
            let entry = windows.get(key);
            if (!entry || entry.resetAt <= time) {
                entry = { count: 0, resetAt: time + windowMs };
                windows.delete(key);
                windows.set(key, entry);
                if (windows.size > maxEntries) sweep();
            }

            entry.count++;
            if (entry.count > limit) {
                return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - time) / 1000)) };
            }
            return { allowed: true, retryAfterSeconds: 0 };
        },

        get size() {
            return windows.size;
        },
    };
}
