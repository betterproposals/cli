import { describe, expect, test } from 'bun:test';
import { createRateLimiter } from './rate-limit.js';

function setup(options) {
    const state = { time: 1_000_000 };
    state.limiter = createRateLimiter({ now: () => state.time, ...options });
    return state;
}

describe('createRateLimiter', () => {
    test('allows the limit and refuses the next one, with the seconds until the window ends', () => {
        const state = setup({ limit: 3 });
        for (let i = 0; i < 3; i++) expect(state.limiter.check(1).allowed).toBe(true);

        state.time += 20_000;
        expect(state.limiter.check(1)).toEqual({ allowed: false, retryAfterSeconds: 40 });
    });

    test('a new window starts when the old one ends', () => {
        const state = setup({ limit: 1 });
        expect(state.limiter.check(1).allowed).toBe(true);
        expect(state.limiter.check(1).allowed).toBe(false);

        state.time += 59_999;
        expect(state.limiter.check(1).allowed).toBe(false);
        state.time += 1;
        expect(state.limiter.check(1).allowed).toBe(true);
    });

    test('users are counted apart', () => {
        const state = setup({ limit: 1 });
        expect(state.limiter.check(1).allowed).toBe(true);
        expect(state.limiter.check(1).allowed).toBe(false);
        expect(state.limiter.check(2).allowed).toBe(true);
    });

    test('a limit of 0 means no limit and remembers nothing', () => {
        const state = setup({ limit: 0 });
        for (let i = 0; i < 1000; i++) expect(state.limiter.check(1).allowed).toBe(true);
        expect(state.limiter.size).toBe(0);
    });

    test('the map stays bounded: expired windows are swept, then the oldest go', () => {
        const state = setup({ limit: 5, maxEntries: 3 });
        for (const user of [1, 2, 3]) state.limiter.check(user);
        state.time += 60_000;
        state.limiter.check(4);
        expect(state.limiter.size).toBe(1);

        for (const user of [5, 6, 7, 8]) state.limiter.check(user);
        expect(state.limiter.size).toBe(3);
    });
});
