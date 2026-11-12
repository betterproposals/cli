import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHandler } from './server.js';
import { createSwapClient } from './swap.js';
import { createLimitsRegistry } from '../core/limits-store.js';
import { resetContextForTests } from '../core/context.js';
import { buildTools } from '../core/tools.js';

const config = {
    port: 0,
    publicUrl: 'https://mcp.example.com',
    resourceUrl: 'https://mcp.example.com/mcp',
    metadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource',
    issuer: 'https://app.example.com',
    swapUrl: 'http://main.internal/oauth/internal/swap',
    swapSecret: 's'.repeat(32),
    apiBaseUrl: 'http://api.internal',
    apiHeaders: { Host: 'api.example.com' },
};

const realFetch = globalThis.fetch;
const internalFor = (aid, tag = '') =>
    `v1.${Buffer.from(JSON.stringify({ uid: 7, aid })).toString('base64url')}.sig${tag}`;

let swapCalls;
let apiCalls;
let handle;

// access tokens: bpat_user3 and bpat_user4 are valid, bpat_trial is not eligible
function fakeSwap(url, init) {
    swapCalls.push({ url, init });
    const token = new URLSearchParams(init.body).get('access_token');
    if (token === 'bpat_user3') return new Response(JSON.stringify({ internal_token: internalFor(3, swapCalls.length), expires_in: 300 }));
    if (token === 'bpat_user4') return new Response(JSON.stringify({ internal_token: internalFor(4, swapCalls.length), expires_in: 300 }));
    if (token === 'bpat_trial') return new Response(JSON.stringify({ error: 'account_not_eligible' }), { status: 403 });
    return new Response(JSON.stringify({ error: 'invalid_token' }), { status: 401 });
}

function fakeApi(url, init) {
    apiCalls.push({ url, init });
    if (url.includes('/settings/limits')) {
        return new Response(JSON.stringify({ status: 'success', data: { parameter_max_length: 50 } }));
    }
    return new Response(JSON.stringify({ status: 'success', data: [{ ID: 1 }] }));
}

beforeEach(() => {
    swapCalls = [];
    apiCalls = [];
    globalThis.fetch = async (url, init) => fakeApi(String(url), init);
    handle = createHandler(config, {
        swapClient: createSwapClient({ swapUrl: config.swapUrl, secret: config.swapSecret, fetchImpl: async (url, init) => fakeSwap(url, init) }),
        limitsRegistry: createLimitsRegistry(),
    });
});

afterEach(() => {
    globalThis.fetch = realFetch;
    resetContextForTests();
});

function rpc(method, params, token = 'bpat_user3') {
    return handle(new Request('https://mcp.example.com/mcp', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            ...(token && { Authorization: `Bearer ${token}` }),
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }));
}

const callTool = (name, args = {}, token) => rpc('tools/call', { name, arguments: args }, token);

describe('hosted MCP server: discovery', () => {
    test('healthz answers ok without authentication', async () => {
        const response = await handle(new Request('https://mcp.example.com/healthz'));
        expect(response.status).toBe(200);
        expect(await response.text()).toBe('ok');
    });

    test.each(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'])('%s names the resource and the authorization server', async (path) => {
        const response = await handle(new Request(`https://mcp.example.com${path}`));
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({
            resource: 'https://mcp.example.com/mcp',
            authorization_servers: ['https://app.example.com'],
            bearer_methods_supported: ['header'],
            resource_name: 'Better Proposals',
        });
    });

    test('unknown paths are 404', async () => {
        const response = await handle(new Request('https://mcp.example.com/nope'));
        expect(response.status).toBe(404);
    });

    test('preflight requests are allowed', async () => {
        const response = await handle(new Request('https://mcp.example.com/mcp', { method: 'OPTIONS' }));
        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-headers')).toContain('Authorization');
    });
});

describe('hosted MCP server: authentication', () => {
    test('no token gets a 401 pointing at the resource metadata, without calling the main app', async () => {
        const response = await rpc('tools/list', {}, null);

        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${config.metadataUrl}"`);
        expect(swapCalls).toHaveLength(0);
    });

    test('an invalid token gets a 401 naming the error', async () => {
        const response = await rpc('tools/list', {}, 'bpat_nope');

        expect(response.status).toBe(401);
        expect(response.headers.get('www-authenticate')).toBe(`Bearer error="invalid_token", resource_metadata="${config.metadataUrl}"`);
        expect((await response.json()).error).toBe('invalid_token');
    });

    test('an account that is not eligible gets a 403', async () => {
        const response = await rpc('tools/list', {}, 'bpat_trial');

        expect(response.status).toBe(403);
        expect((await response.json()).error).toBe('account_not_eligible');
    });

    test('an unreachable main app gets a 503', async () => {
        handle = createHandler(config, {
            swapClient: createSwapClient({ swapUrl: config.swapUrl, secret: config.swapSecret, fetchImpl: async () => { throw new Error('down'); } }),
        });
        const response = await rpc('tools/list');

        expect(response.status).toBe(503);
    });

    test('only POST is served on /mcp', async () => {
        const response = await handle(new Request('https://mcp.example.com/mcp', { method: 'GET', headers: { Authorization: 'Bearer bpat_user3' } }));

        expect(response.status).toBe(405);
        expect(response.headers.get('allow')).toBe('POST');
    });

    test('the token is read from a Bearer header only', async () => {
        const response = await handle(new Request('https://mcp.example.com/mcp?access_token=bpat_user3', { method: 'POST', body: '{}' }));
        expect(response.status).toBe(401);
    });
});

describe('hosted MCP server: tools', () => {
    test('lists the hosted tool set, all annotated, without cli_status', async () => {
        const response = await rpc('tools/list', {});
        expect(response.status).toBe(200);
        const { result } = await response.json();

        expect(result.tools.map((tool) => tool.name).sort()).toEqual(buildTools().map((tool) => tool.name).sort());
        expect(result.tools.map((tool) => tool.name)).not.toContain('cli_status');
        expect(result.tools.every((tool) => tool.annotations && typeof tool.annotations.readOnlyHint === 'boolean')).toBe(true);
        expect(result.tools.find((tool) => tool.name === 'documents_list').annotations.readOnlyHint).toBe(true);
        expect(result.tools.find((tool) => tool.name === 'documents_edit').annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    });

    test('a tool call reaches the API with the internal token, never the access token', async () => {
        const response = await callTool('documents_list');
        const { result } = await response.json();

        expect(result.isError).toBeUndefined();
        expect(JSON.parse(result.content[0].text).data).toEqual([{ ID: 1 }]);

        expect(apiCalls).toHaveLength(1);
        expect(apiCalls[0].url).toBe('http://api.internal/proposal/?page=1&per_page=10');
        expect(apiCalls[0].init.headers).toEqual({
            Host: 'api.example.com',
            Authorization: `Bearer ${internalFor(3, 1)}`,
        });
        expect(JSON.stringify(apiCalls)).not.toContain('bpat_user3');
    });

    test('the swap is done once for repeated calls of one token', async () => {
        await callTool('documents_list');
        await callTool('documents_list');
        await rpc('tools/list', {});

        expect(swapCalls).toHaveLength(1);
    });

    test('two accounts at once never see each other\'s credentials', async () => {
        const [a, b] = await Promise.all([
            callTool('documents_list', {}, 'bpat_user3'),
            callTool('documents_list', {}, 'bpat_user4'),
        ]);
        expect(a.status).toBe(200);
        expect(b.status).toBe(200);

        const auth = apiCalls.map((call) => call.init.headers.Authorization).sort();
        expect(auth).toEqual([`Bearer ${internalFor(3, 1)}`, `Bearer ${internalFor(4, 2)}`].sort());
    });

    test('limits are kept per account', async () => {
        const write = (token) => callTool('companies_create', { company_name: 'x'.repeat(80) }, token);
        await write('bpat_user3');
        await write('bpat_user3');
        await write('bpat_user4');

        const limitCalls = apiCalls.filter((call) => call.url.includes('/settings/limits'));
        expect(limitCalls).toHaveLength(2);
    });

    test('a write over the account limit is refused before it reaches the API', async () => {
        const response = await callTool('companies_create', { company_name: 'x'.repeat(80) });
        const { result } = await response.json();

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('50');
        expect(apiCalls.some((call) => call.init.method === 'POST')).toBe(false);
    });

    test('an API failure is returned as a tool error, not an HTTP error', async () => {
        globalThis.fetch = async () => new Response('nope', { status: 403, statusText: 'Forbidden' });
        const response = await callTool('documents_list');
        const { result } = await response.json();

        expect(response.status).toBe(200);
        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('API error 403');
    });
});
