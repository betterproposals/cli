#!/usr/bin/env bun
// Hosted MCP server (Streamable HTTP, stateless) for web AI clients such as
// claude.ai and ChatGPT.
//
// A client signs in with OAuth against the main app (the authorization server)
// and sends its access token here. This server never forwards that token: it
// swaps it at the main app for a short-lived internal token and calls the API
// with that. Configuration is read from the environment, see config.js.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { runWithContext } from '../core/context.js';
import { describeLimit } from '../core/limits.js';
import { createLimitsRegistry } from '../core/limits-store.js';
import { buildTools } from '../core/tools.js';
import { registerTools } from '../core/register.js';
import { loadHttpConfig } from './config.js';
import { createSwapClient, SwapError } from './swap.js';
import pkg from '../../package.json';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Expose-Headers': 'WWW-Authenticate',
};

function json(status, body, headers = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...headers },
    });
}

function bearerToken(req) {
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.get('authorization') || '');
    return match ? match[1] : null;
}

/**
 * The request handler: (Request) => Promise<Response>. Everything it talks to
 * is passed in, so tests can run it against a fake swap and a fake API.
 */
export function createHandler(config, { swapClient, limitsRegistry } = {}) {
    const swap = swapClient ?? createSwapClient({ swapUrl: config.swapUrl, secret: config.swapSecret });
    const limits = limitsRegistry ?? createLimitsRegistry();

    // No limit notes: the limits differ per account and this server is shared,
    // so the descriptions carry the standard text and api_limits gives the
    // account's own values.
    const tools = buildTools();

    const challenge = (error) =>
        `Bearer ${error ? `error="${error}", ` : ''}resource_metadata="${config.metadataUrl}"`;

    const unauthorized = (error, description) =>
        json(401, { error: error ?? 'unauthorized', ...(description && { error_description: description }) },
            { 'WWW-Authenticate': challenge(error) });

    function buildServer() {
        const server = new McpServer(
            { name: 'Better Proposals', version: pkg.version },
            { instructions: describeLimit() },
        );
        registerTools(server, tools);
        return server;
    }

    async function handleMcp(req) {
        const accessToken = bearerToken(req);
        if (!accessToken) return unauthorized();

        // Stateless Streamable HTTP: no standalone event stream, no session to close.
        if (req.method !== 'POST') {
            return json(405, { error: 'Method not allowed' }, { Allow: 'POST' });
        }

        let session;
        try {
            session = await swap.exchange(accessToken);
        } catch (error) {
            if (!(error instanceof SwapError)) throw error;
            if (error.kind === 'invalid_token') return unauthorized('invalid_token', error.message);
            if (error.kind === 'not_eligible') return json(403, { error: 'account_not_eligible', error_description: error.message });
            return json(503, { error: 'temporarily_unavailable', error_description: error.message });
        }

        const context = {
            baseUrl: config.apiBaseUrl,
            headers: config.apiHeaders,
            // Asked again for every API call: a long tool call (a big document
            // split in many requests) outlives one internal token.
            getAuthHeaders: async () => {
                const { internalToken } = await swap.exchange(accessToken);
                return { Authorization: `Bearer ${internalToken}` };
            },
            refreshAuth: null,
            limitsStore: limits.forAccount(session.accountId),
        };

        const server = buildServer();
        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        });
        await server.connect(transport);
        try {
            const response = await runWithContext(context, () => transport.handleRequest(req));
            for (const [name, value] of Object.entries(CORS_HEADERS)) response.headers.set(name, value);
            return response;
        } finally {
            await transport.close();
            await server.close();
        }
    }

    return async function handle(req) {
        const { pathname } = new URL(req.url);

        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
        if (pathname === '/healthz') return new Response('ok');

        if (pathname === '/.well-known/oauth-protected-resource' || pathname === '/.well-known/oauth-protected-resource/mcp') {
            return json(200, {
                resource: config.resourceUrl,
                authorization_servers: [config.issuer],
                bearer_methods_supported: ['header'],
                resource_name: 'Better Proposals',
            });
        }

        if (pathname === '/mcp') return handleMcp(req);

        return json(404, { error: 'Not found' });
    };
}

function start() {
    let config;
    try {
        config = loadHttpConfig();
    } catch (error) {
        console.error(error.message);
        process.exit(1);
    }

    const handle = createHandler(config);

    Bun.serve({
        port: config.port,
        async fetch(req) {
            const started = Date.now();
            let response;
            try {
                response = await handle(req);
            } catch (error) {
                console.error('Unhandled error:', error);
                response = json(500, { error: 'Internal error' });
            }
            // Method, path and status only: never log tokens or request bodies.
            console.log(`${req.method} ${new URL(req.url).pathname} ${response.status} ${Date.now() - started}ms`);
            return response;
        },
    });

    console.log(`Better Proposals hosted MCP listening on :${config.port}`);
    console.log(`Resource ${config.resourceUrl}, authorization server ${config.issuer}`);
}

if (import.meta.main) start();
