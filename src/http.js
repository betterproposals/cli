#!/usr/bin/env bun
// Hosted MCP server (Streamable HTTP, stateless) -- SPIKE.
//
// Temporary static-token mode, to prove the path from web AI clients through
// the load balancer to the API before the OAuth server exists. It serves ONE
// fixed account (BP_API_TOKEN) and exposes a read-only subset of the tools.
// It is NOT the launch design: remove before launch (see the roadmap).
//
// Configuration (environment, never committed):
//   BP_API_TOKEN       required  API token (Bptoken) of the test account
//   BP_API_URL         API base URL (default: production API)
//   BP_API_HEADERS     extra API request headers, JSON object
//   MCP_STATIC_BEARER  optional  if set, requests must send "Authorization: Bearer <value>"
//   MCP_TOOLS          comma-separated tool allowlist (default: a read-only set)
//   PORT               listen port (default 3000)
import { timingSafeEqual } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { TOOLS } from './tools.js';
import { setOverrideToken } from './auth.js';
import { describeLimit } from './limits.js';
import pkg from '../package.json';

const DEFAULT_TOOLS = ['documents_list', 'documents_get', 'templates_list', 'companies_list', 'api_limits'];

const port = Number(process.env.PORT || 3000);
const staticBearer = process.env.MCP_STATIC_BEARER || '';
const apiToken = process.env.BP_API_TOKEN || '';
const allowed = new Set(
    (process.env.MCP_TOOLS || DEFAULT_TOOLS.join(','))
        .split(',').map((name) => name.trim()).filter(Boolean),
);

if (!apiToken) {
    console.error('BP_API_TOKEN is required (the API token of the test account).');
    process.exit(1);
}

const tools = TOOLS.filter((tool) => allowed.has(tool.name));
const unknown = [...allowed].filter((name) => !tools.some((tool) => tool.name === name));
if (unknown.length > 0) {
    console.error(`Unknown tool(s) in MCP_TOOLS: ${unknown.join(', ')}`);
    process.exit(1);
}

// One fixed account for the whole process (spike only).
setOverrideToken(apiToken);

function ok(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(error) {
    return { content: [{ type: 'text', text: error.message }], isError: true };
}

// Stateless: a fresh server and transport per request, nothing kept between calls.
function buildServer() {
    const server = new McpServer(
        { name: 'Better Proposals', version: pkg.version },
        { instructions: describeLimit() },
    );
    for (const { name, description, inputSchema, handler } of tools) {
        server.registerTool(name, { description, inputSchema }, async (args) => {
            try { return ok(await handler(args)); } catch (e) { return err(e); }
        });
    }
    return server;
}

function bearerMatches(header) {
    const expected = Buffer.from(`Bearer ${staticBearer}`);
    const given = Buffer.from(header || '');
    return given.length === expected.length && timingSafeEqual(given, expected);
}

function json(status, body, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });
}

async function handle(req) {
    const { pathname } = new URL(req.url);

    if (pathname === '/healthz') return new Response('ok');
    if (pathname !== '/mcp') return json(404, { error: 'Not found' });

    if (staticBearer && !bearerMatches(req.headers.get('authorization'))) {
        return json(401, { error: 'Unauthorized' }, { 'WWW-Authenticate': 'Bearer' });
    }

    // Stateless Streamable HTTP: no standalone event stream, no session to close.
    if (req.method !== 'POST') {
        return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
    }

    const server = buildServer();
    const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
        return await transport.handleRequest(req);
    } finally {
        await transport.close();
        await server.close();
    }
}

Bun.serve({
    port,
    async fetch(req) {
        const started = Date.now();
        let response;
        try {
            response = await handle(req);
        } catch (e) {
            console.error('Unhandled error:', e);
            response = json(500, { error: 'Internal error' });
        }
        // Method, path and status only: never log tokens or request bodies.
        console.log(`${req.method} ${new URL(req.url).pathname} ${response.status} ${Date.now() - started}ms`);
        return response;
    },
});

console.log(`Better Proposals hosted MCP (spike) listening on :${port}`);
console.log(`Tools: ${tools.map((tool) => tool.name).join(', ')}`);
if (!staticBearer) console.warn('WARNING: MCP_STATIC_BEARER is not set, the endpoint is unauthenticated.');
