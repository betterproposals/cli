import { describe, expect, test } from 'bun:test';
import { accountIdFromInternalToken, createSwapClient, SwapError } from './swap.js';

const tokenFor = (aid) =>
    `v1.${Buffer.from(JSON.stringify({ uid: 7, aid, exp: 9999999999 })).toString('base64url')}.signature`;

function setup(responder, options = {}) {
    const state = { calls: [], time: 1_000_000 };
    const fetchImpl = async (url, init) => {
        state.calls.push({ url, init });
        return responder(state.calls.length, init);
    };
    state.client = createSwapClient({
        swapUrl: 'http://main.internal/oauth/internal/swap',
        secret: 's'.repeat(32),
        fetchImpl,
        now: () => state.time,
        ...options,
    });
    return state;
}

const ok = (aid = 3, expiresIn = 300) => new Response(JSON.stringify({ internal_token: tokenFor(aid), expires_in: expiresIn }));
const refused = (status, error) => new Response(JSON.stringify({ error }), { status });

describe('accountIdFromInternalToken', () => {
    test('reads the account claim', () => {
        expect(accountIdFromInternalToken(tokenFor(42))).toBe(42);
    });

    test.each(['', 'garbage', 'v1.e30.sig', `v1.${Buffer.from('{"aid":"x"}').toString('base64url')}.sig`])('rejects %p', (token) => {
        expect(() => accountIdFromInternalToken(token)).toThrow(SwapError);
    });
});

describe('createSwapClient', () => {
    test('posts the access token with the service credential and returns the session', async () => {
        const state = setup(() => ok(3));
        const session = await state.client.exchange('bpat_abc');

        expect(state.calls).toHaveLength(1);
        expect(state.calls[0].url).toBe('http://main.internal/oauth/internal/swap');
        expect(state.calls[0].init.method).toBe('POST');
        expect(state.calls[0].init.headers['X-Service-Credential']).toBe('s'.repeat(32));
        expect(state.calls[0].init.body).toBe('access_token=bpat_abc');
        expect(session).toEqual({ internalToken: tokenFor(3), accountId: 3, expiresAt: state.time + 300_000 });
    });

    test('sends the extra headers, which never override the credential', async () => {
        const state = setup(() => ok(), { headers: { 'X-Forwarded-Proto': 'https', 'X-Service-Credential': 'forged' } });
        await state.client.exchange('bpat_abc');

        expect(state.calls[0].init.headers['X-Forwarded-Proto']).toBe('https');
        expect(state.calls[0].init.headers['X-Service-Credential']).toBe('s'.repeat(32));
    });

    test('remembers the session until 30 seconds before it expires', async () => {
        const state = setup(() => ok());
        await state.client.exchange('bpat_abc');

        state.time += 269_000;
        await state.client.exchange('bpat_abc');
        expect(state.calls).toHaveLength(1);

        state.time += 2_000;
        await state.client.exchange('bpat_abc');
        expect(state.calls).toHaveLength(2);
    });

    test('keeps the sessions of different tokens apart', async () => {
        const state = setup((n) => ok(n));
        const a = await state.client.exchange('bpat_a');
        const b = await state.client.exchange('bpat_b');

        expect(state.calls).toHaveLength(2);
        expect(a.accountId).toBe(1);
        expect(b.accountId).toBe(2);
    });

    test('concurrent calls for one token share one request', async () => {
        const state = setup(async () => { await Bun.sleep(10); return ok(); });
        const results = await Promise.all([1, 2, 3].map(() => state.client.exchange('bpat_abc')));

        expect(state.calls).toHaveLength(1);
        expect(results[0]).toBe(results[1]);
    });

    test('an invalid token is refused, and the refusal is remembered briefly', async () => {
        const state = setup(() => refused(401, 'invalid_token'));

        await expect(state.client.exchange('bpat_bad')).rejects.toMatchObject({ kind: 'invalid_token' });
        await expect(state.client.exchange('bpat_bad')).rejects.toMatchObject({ kind: 'invalid_token' });
        expect(state.calls).toHaveLength(1);

        state.time += 11_000;
        await expect(state.client.exchange('bpat_bad')).rejects.toMatchObject({ kind: 'invalid_token' });
        expect(state.calls).toHaveLength(2);
    });

    test('an account that is not eligible is told so', async () => {
        const state = setup(() => refused(403, 'account_not_eligible'));
        await expect(state.client.exchange('bpat_abc')).rejects.toMatchObject({ kind: 'not_eligible' });
    });

    test('a refused service credential is not blamed on the user token', async () => {
        const state = setup(() => refused(401, 'invalid_credential'));
        await expect(state.client.exchange('bpat_abc')).rejects.toMatchObject({ kind: 'unavailable' });
    });

    test.each([
        ['a server error', () => new Response('boom', { status: 500 })],
        ['an unreadable answer', () => new Response('not json')],
        ['an answer without a token', () => new Response('{}')],
        ['an unreachable endpoint', () => { throw new Error('ECONNREFUSED'); }],
    ])('%s is unavailable and is not remembered', async (_name, responder) => {
        const state = setup(responder);

        await expect(state.client.exchange('bpat_abc')).rejects.toMatchObject({ kind: 'unavailable' });
        await expect(state.client.exchange('bpat_abc')).rejects.toMatchObject({ kind: 'unavailable' });
        expect(state.calls).toHaveLength(2);
        expect(state.client.size).toBe(0);
    });

    test('logs why the endpoint could not be reached, without the credential', async () => {
        const logged = [];
        const original = console.error;
        console.error = (...args) => logged.push(args.join(' '));
        try {
            const state = setup(() => { throw Object.assign(new Error('Unable to connect'), { code: 'ConnectionRefused' }); });
            await expect(state.client.exchange('bpat_secret_token')).rejects.toMatchObject({ kind: 'unavailable' });
        } finally {
            console.error = original;
        }

        expect(logged).toEqual(['Swap request to http://main.internal failed: Error (ConnectionRefused): Unable to connect']);
        expect(logged.join()).not.toContain('bpat_secret_token');
        expect(logged.join()).not.toContain('s'.repeat(32));
    });

    test('holds at most maxEntries sessions', async () => {
        const state = setup(() => ok(), { maxEntries: 2 });
        for (const token of ['a', 'b', 'c']) await state.client.exchange(token);

        expect(state.client.size).toBe(2);
    });
});
