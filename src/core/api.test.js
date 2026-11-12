import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { documents } from './api.js';
import { resetContextForTests, runWithContext, setDefaultContext } from './context.js';

const realFetch = globalThis.fetch;
let calls;
let responses;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
    calls = [];
    responses = [];
    globalThis.fetch = async (url, options) => {
        calls.push({ url, options });
        return responses.shift() ?? json({ status: 'success', data: [] });
    };
});

afterEach(() => {
    globalThis.fetch = realFetch;
    resetContextForTests();
});

describe('API client and the request context', () => {
    test('sends to the context base URL with its extra and auth headers', async () => {
        await runWithContext({
            baseUrl: 'http://api.internal:8080',
            headers: { Host: 'api.example.com', Bptoken: 'ignored' },
            getAuthHeaders: async () => ({ Authorization: 'Bearer abc' }),
        }, () => documents.list({ page: 2, perPage: 5 }));

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe('http://api.internal:8080/proposal/?page=2&per_page=5');
        expect(calls[0].options.headers).toEqual({ Host: 'api.example.com', Bptoken: 'ignored', Authorization: 'Bearer abc' });
    });

    test('the auth headers win over a clashing extra header', async () => {
        await runWithContext({
            headers: { Bptoken: 'from-env' },
            getAuthHeaders: async () => ({ Bptoken: 'from-auth' }),
        }, () => documents.list());

        expect(calls[0].options.headers.Bptoken).toBe('from-auth');
    });

    test('process defaults serve the local CLI', async () => {
        setDefaultContext({ getAuthHeaders: async () => ({ Bptoken: 'local-token' }) });

        await documents.list();

        expect(calls[0].url).toStartWith('https://api.betterproposals.io/proposal/');
        expect(calls[0].options.headers).toEqual({ Bptoken: 'local-token' });
    });

    test('a 401 refreshes once and retries with the new credentials', async () => {
        let token = 'old';
        let refreshes = 0;
        responses = [json({}, 401), json({ status: 'success', data: ['ok'] })];

        const result = await runWithContext({
            getAuthHeaders: async () => ({ Bptoken: token }),
            refreshAuth: async () => { refreshes++; token = 'new'; },
        }, () => documents.list());

        expect(result.data).toEqual(['ok']);
        expect(refreshes).toBe(1);
        expect(calls.map((call) => call.options.headers.Bptoken)).toEqual(['old', 'new']);
    });

    test('a second 401 after the refresh fails instead of looping', async () => {
        let refreshes = 0;
        responses = [json({}, 401), json({}, 401)];

        await expect(runWithContext({
            getAuthHeaders: async () => ({ Bptoken: 't' }),
            refreshAuth: async () => { refreshes++; },
        }, () => documents.list())).rejects.toThrow('API error 401');

        expect(refreshes).toBe(1);
        expect(calls).toHaveLength(2);
    });

    test('without a refresh handler a 401 fails straight away', async () => {
        responses = [json({}, 401)];

        await expect(runWithContext({
            getAuthHeaders: async () => ({ Authorization: 'Bearer x' }),
            refreshAuth: null,
        }, () => documents.list())).rejects.toThrow('API error 401');

        expect(calls).toHaveLength(1);
    });

    test('an authentication failure stops the request before it is sent', async () => {
        await expect(runWithContext({
            getAuthHeaders: async () => { throw new Error('Not authenticated.'); },
        }, () => documents.list())).rejects.toThrow('Not authenticated.');

        expect(calls).toHaveLength(0);
    });

    test('a failing refresh surfaces its own error', async () => {
        responses = [json({}, 401)];

        await expect(runWithContext({
            getAuthHeaders: async () => ({ Bptoken: 't' }),
            refreshAuth: async () => { throw new Error('Token expired. The caller must re-issue a token.'); },
        }, () => documents.list())).rejects.toThrow('Token expired');
    });

    test('concurrent requests are sent with their own credentials', async () => {
        const run = (token, delay) => runWithContext({
            getAuthHeaders: async () => {
                await new Promise((resolve) => setTimeout(resolve, delay));
                return { Authorization: `Bearer ${token}` };
            },
        }, () => documents.list());

        await Promise.all([run('a', 20), run('b', 1)]);

        expect(calls.map((call) => call.options.headers.Authorization).sort()).toEqual(['Bearer a', 'Bearer b']);
    });
});
