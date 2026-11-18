import { describe, expect, test } from 'bun:test';
import { createLimitsRegistry } from './limits-store.js';

const live = (max = 1000) => ({ parameter_max_length: max, source: 'api' });
const fallback = () => ({ parameter_max_length: 1000, source: 'default' });

function counter(result) {
    const loader = async () => { loader.calls++; return typeof result === 'function' ? result() : result; };
    loader.calls = 0;
    return loader;
}

describe('createLimitsRegistry', () => {
    test('loads once and remembers a limit that came from the API', async () => {
        const store = createLimitsRegistry().forAccount(7);
        const load = counter(live(5000));

        expect((await store.resolve(load)).parameter_max_length).toBe(5000);
        expect((await store.resolve(load)).parameter_max_length).toBe(5000);
        expect(load.calls).toBe(1);
    });

    test('concurrent callers of one account share a single load', async () => {
        const store = createLimitsRegistry().forAccount(7);
        const load = counter(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); return live(); });

        await Promise.all([store.resolve(load), store.resolve(load), store.resolve(load)]);

        expect(load.calls).toBe(1);
    });

    test('a failed lookup (the defaults) is not remembered', async () => {
        const store = createLimitsRegistry().forAccount(7);
        const load = counter(fallback());

        await store.resolve(load);
        await store.resolve(load);

        expect(load.calls).toBe(2);
    });

    test('a rejected load reaches the caller and is not remembered', async () => {
        const store = createLimitsRegistry().forAccount(7);
        let calls = 0;
        const load = async () => { calls++; throw new Error('boom'); };

        await expect(store.resolve(load)).rejects.toThrow('boom');
        await expect(store.resolve(load)).rejects.toThrow('boom');
        expect(calls).toBe(2);
    });

    test('forgets the limit after the ttl', async () => {
        let time = 1_000;
        const store = createLimitsRegistry({ ttlMs: 60_000, now: () => time }).forAccount(7);
        const load = counter(live());

        await store.resolve(load);
        time += 59_999;
        await store.resolve(load);
        expect(load.calls).toBe(1);

        time += 2;
        await store.resolve(load);
        expect(load.calls).toBe(2);
    });

    test('keeps the accounts apart', async () => {
        const registry = createLimitsRegistry();

        const a = await registry.forAccount(1).resolve(counter(live(1000)));
        const b = await registry.forAccount(2).resolve(counter(live(9000)));
        const again = await registry.forAccount(1).resolve(counter(live(1)));

        expect([a.parameter_max_length, b.parameter_max_length, again.parameter_max_length]).toEqual([1000, 9000, 1000]);
    });

    test('clear forgets the limit of that account only', async () => {
        const registry = createLimitsRegistry();
        const one = counter(live());
        const two = counter(live());

        await registry.forAccount(1).resolve(one);
        await registry.forAccount(2).resolve(two);
        registry.forAccount(1).clear();
        await registry.forAccount(1).resolve(one);
        await registry.forAccount(2).resolve(two);

        expect([one.calls, two.calls]).toEqual([2, 1]);
    });

    test('never holds more accounts than maxEntries, dropping the oldest', async () => {
        const registry = createLimitsRegistry({ maxEntries: 2 });
        const loads = [counter(live()), counter(live()), counter(live())];

        for (const [index, load] of loads.entries()) await registry.forAccount(index).resolve(load);

        expect(registry.size).toBe(2);
        await registry.forAccount(0).resolve(loads[0]);
        expect(loads[0].calls).toBe(2);
    });
});
