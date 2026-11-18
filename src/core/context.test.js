import { afterEach, describe, expect, test } from 'bun:test';
import { getContext, loadApiConfig, resetContextForTests, runWithContext, setDefaultContext } from './context.js';

afterEach(() => resetContextForTests());

describe('loadApiConfig', () => {
    test('defaults to the production API with no extra headers', () => {
        expect(loadApiConfig({})).toEqual({ baseUrl: 'https://api.betterproposals.io', headers: {} });
    });

    test('reads the URL and headers from the environment', () => {
        const config = loadApiConfig({ BP_API_URL: 'http://10.0.0.5:8080/', BP_API_HEADERS: '{"Host":"api.example.com"}' });
        expect(config).toEqual({ baseUrl: 'http://10.0.0.5:8080', headers: { Host: 'api.example.com' } });
    });

    test('rejects an invalid URL with a clear message', () => {
        expect(() => loadApiConfig({ BP_API_URL: 'not a url' })).toThrow('BP_API_URL is not a valid URL: not a url');
    });

    test('rejects headers that are not a JSON object of strings', () => {
        expect(() => loadApiConfig({ BP_API_HEADERS: '{oops' })).toThrow('BP_API_HEADERS must be a JSON object');
        expect(() => loadApiConfig({ BP_API_HEADERS: '["a"]' })).toThrow('BP_API_HEADERS must be a JSON object of header names to string values');
        expect(() => loadApiConfig({ BP_API_HEADERS: '{"a":1}' })).toThrow('BP_API_HEADERS must be a JSON object of header names to string values');
        expect(() => loadApiConfig({ BP_API_HEADERS: 'null' })).toThrow('BP_API_HEADERS must be a JSON object of header names to string values');
    });
});

describe('getContext', () => {
    test('outside a request it returns the process defaults', async () => {
        const refresh = async () => {};
        setDefaultContext({ getAuthHeaders: async () => ({ Bptoken: 'local' }), refreshAuth: refresh });

        const context = getContext();
        expect(await context.getAuthHeaders()).toEqual({ Bptoken: 'local' });
        expect(context.refreshAuth).toBe(refresh);
    });

    test('without any registered auth, resolving headers fails clearly', async () => {
        await expect(getContext().getAuthHeaders()).rejects.toThrow('No authentication is configured');
        expect(getContext().refreshAuth).toBeNull();
    });

    test('a request context overrides the defaults and inherits the rest', async () => {
        setDefaultContext({ getAuthHeaders: async () => ({ Bptoken: 'local' }), refreshAuth: async () => {} });

        await runWithContext({ getAuthHeaders: async () => ({ Authorization: 'Bearer a' }), refreshAuth: null }, async () => {
            const context = getContext();
            expect(await context.getAuthHeaders()).toEqual({ Authorization: 'Bearer a' });
            expect(context.refreshAuth).toBeNull();
            expect(context.baseUrl).toBe('https://api.betterproposals.io');
        });

        expect(await getContext().getAuthHeaders()).toEqual({ Bptoken: 'local' });
    });

    test('concurrent requests never see each other\'s context', async () => {
        const seen = [];
        const request = (name, delay) => runWithContext(
            { baseUrl: `https://${name}.example`, getAuthHeaders: async () => ({ Authorization: `Bearer ${name}` }) },
            async () => {
                await new Promise((resolve) => setTimeout(resolve, delay));
                const context = getContext();
                seen.push([name, context.baseUrl, (await context.getAuthHeaders()).Authorization]);
            },
        );

        await Promise.all([request('a', 30), request('b', 5), request('c', 15)]);

        expect(seen.sort()).toEqual([
            ['a', 'https://a.example', 'Bearer a'],
            ['b', 'https://b.example', 'Bearer b'],
            ['c', 'https://c.example', 'Bearer c'],
        ]);
    });
});
