import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { companies, documents, getLimits } from './api.js';
import { resetContextForTests, runWithContext, setDefaultContext } from './context.js';
import { createLimitsRegistry } from './limits-store.js';

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

describe('getLimits', () => {
    const limitsResponse = (max) => json({ status: 'success', data: { parameter_max_length: max, scope: 'per_parameter' } });

    test('without a store the limits are looked up on every call', async () => {
        responses = [limitsResponse(3000), limitsResponse(4000)];
        setDefaultContext({ getAuthHeaders: async () => ({ Bptoken: 't' }) });

        expect((await getLimits()).parameter_max_length).toBe(3000);
        expect((await getLimits()).parameter_max_length).toBe(4000);
        expect(calls.map((call) => call.url)).toEqual([
            'https://api.betterproposals.io/settings/limits',
            'https://api.betterproposals.io/settings/limits',
        ]);
    });

    test('the store of the context decides what is remembered', async () => {
        responses = [limitsResponse(3000)];
        const store = createLimitsRegistry().forAccount(1);
        const context = { getAuthHeaders: async () => ({ Bptoken: 't' }), limitsStore: store };

        const first = await runWithContext(context, () => getLimits());
        const second = await runWithContext(context, () => getLimits());

        expect([first.parameter_max_length, first.source]).toEqual([3000, 'api']);
        expect(second).toBe(first);
        expect(calls).toHaveLength(1);
    });

    test('accounts with their own store never see each other\'s limits', async () => {
        const registry = createLimitsRegistry();
        responses = [limitsResponse(1000), limitsResponse(9000)];
        const as = (account) => runWithContext(
            { getAuthHeaders: async () => ({ Bptoken: `t${account}` }), limitsStore: registry.forAccount(account) },
            () => getLimits(),
        );

        const a = await as(1);
        const b = await as(2);
        const aAgain = await as(1);

        expect([a.parameter_max_length, b.parameter_max_length, aAgain.parameter_max_length]).toEqual([1000, 9000, 1000]);
        expect(calls).toHaveLength(2);
    });

    test('falls back to the standard limit when the lookup fails, and asks again next time', async () => {
        responses = [json({}, 500), limitsResponse(7000)];
        const context = { getAuthHeaders: async () => ({ Bptoken: 't' }), limitsStore: createLimitsRegistry().forAccount(1) };

        const failed = await runWithContext(context, () => getLimits());
        const recovered = await runWithContext(context, () => getLimits());

        expect([failed.parameter_max_length, failed.source]).toEqual([1000, 'default']);
        expect(recovered.parameter_max_length).toBe(7000);
    });

    test('a write is checked against the limits of the account before it is sent', async () => {
        responses = [limitsResponse(10)];
        const context = { getAuthHeaders: async () => ({ Bptoken: 't' }), limitsStore: createLimitsRegistry().forAccount(1) };

        await expect(runWithContext(context, () => companies.create({ companyName: 'a company name that is too long' })))
            .rejects.toThrow('company_name');

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('/settings/limits');
    });
});
