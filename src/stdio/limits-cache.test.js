import { describe, expect, test } from 'bun:test';
import { createStdioLimitsStore } from './limits-cache.js';

const live = { parameter_max_length: 4000, source: 'api' };
const standard = { parameter_max_length: 1000, source: 'default' };

function setup({ cached = null } = {}) {
    const written = [];
    const store = createStdioLimitsStore({ read: () => cached, write: (limits) => written.push(limits) });
    const load = async () => { load.calls++; return load.result; };
    load.calls = 0;
    load.result = live;
    return { store, load, written };
}

describe('createStdioLimitsStore', () => {
    test('remembers the live limits for the process and keeps them on disk', async () => {
        const { store, load, written } = setup();

        expect(await store.resolve(load)).toBe(live);
        expect(await store.resolve(load)).toBe(live);

        expect(load.calls).toBe(1);
        expect(written).toEqual([live]);
    });

    test('falls back to the disk cache when the live lookup failed, without writing it back', async () => {
        const cached = { parameter_max_length: 2500, source: 'api' };
        const { store, load, written } = setup({ cached });
        load.result = standard;

        expect(await store.resolve(load)).toBe(cached);
        expect(written).toEqual([]);
    });

    test('falls back to the defaults when there is nothing on disk either', async () => {
        const { store, load } = setup();
        load.result = standard;

        expect(await store.resolve(load)).toBe(standard);
    });

    test('keeps the outcome of a failed lookup for the whole process, as before', async () => {
        const { store, load } = setup();
        load.result = standard;

        await store.resolve(load);
        await store.resolve(load);

        expect(load.calls).toBe(1);
    });

    test('clear makes the next use look the limits up again (another account)', async () => {
        const { store, load } = setup();

        await store.resolve(load);
        store.clear();
        await store.resolve(load);

        expect(load.calls).toBe(2);
    });
});
