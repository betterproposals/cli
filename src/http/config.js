import { loadApiConfig, parseHeadersEnv } from '../core/context.js';
import { MAX_RESULT_CHARS } from '../core/register.js';

const DEFAULT_PORT = 3000;
const DEFAULT_RATE_LIMIT = 120;
const MIN_SECRET_LENGTH = 32;

function requiredUrl(env, name) {
    const raw = env[name];
    if (!raw) throw new Error(`${name} is required.`);
    try {
        new URL(raw);
    } catch {
        throw new Error(`${name} is not a valid URL: ${raw}`);
    }
    return raw.replace(/\/+$/, '');
}

/**
 * Configuration of the hosted MCP server, read from the environment.
 *
 * MCP_PUBLIC_URL: the public origin of this server, for example
 *   https://mcp.betterproposals.io (the MCP endpoint is MCP_PUBLIC_URL/mcp)
 * OAUTH_ISSUER: the main app that signs users in, announced to the clients
 * OAUTH_SWAP_URL: the main app endpoint that exchanges an access token for an
 *   internal API token (it can be a private address, unlike OAUTH_ISSUER)
 * OAUTH_SWAP_SECRET: the credential this server sends to the swap endpoint
 * OAUTH_SWAP_HEADERS: optional JSON object of extra headers for the swap request
 *   (for example X-Forwarded-Proto when the endpoint is reached over a private route)
 * BP_API_URL, BP_API_HEADERS: see loadApiConfig()
 * MCP_MAX_RESULT_CHARS: the largest tool answer returned, larger ones ask the model
 *   to narrow the request (default: see register.js)
 * MCP_RATE_LIMIT_PER_MINUTE: requests per user per minute (default 120, 0 = off)
 * MCP_DISABLED_TOOLS: comma separated names of tools to switch off
 * PORT: listen port (default 3000)
 *
 * Throws a message naming the problem, so the process can refuse to start.
 */
export function loadHttpConfig(env = process.env) {
    const publicUrl = requiredUrl(env, 'MCP_PUBLIC_URL');
    const issuer = requiredUrl(env, 'OAUTH_ISSUER');
    const swapUrl = requiredUrl(env, 'OAUTH_SWAP_URL');

    const swapSecret = env.OAUTH_SWAP_SECRET || '';
    if (swapSecret.length < MIN_SECRET_LENGTH) {
        throw new Error(`OAUTH_SWAP_SECRET is required and must be at least ${MIN_SECRET_LENGTH} characters.`);
    }

    const port = env.PORT === undefined || env.PORT === '' ? DEFAULT_PORT : Number(env.PORT);
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error(`PORT is not a valid port: ${env.PORT}`);
    }

    const maxResultChars = env.MCP_MAX_RESULT_CHARS === undefined || env.MCP_MAX_RESULT_CHARS === '' ? MAX_RESULT_CHARS : Number(env.MCP_MAX_RESULT_CHARS);
    if (!Number.isInteger(maxResultChars) || maxResultChars < 1000) {
        throw new Error(`MCP_MAX_RESULT_CHARS must be a whole number of at least 1000: ${env.MCP_MAX_RESULT_CHARS}`);
    }

    const rateLimitPerMinute = env.MCP_RATE_LIMIT_PER_MINUTE === undefined || env.MCP_RATE_LIMIT_PER_MINUTE === '' ? DEFAULT_RATE_LIMIT : Number(env.MCP_RATE_LIMIT_PER_MINUTE);
    if (!Number.isInteger(rateLimitPerMinute) || rateLimitPerMinute < 0) {
        throw new Error(`MCP_RATE_LIMIT_PER_MINUTE must be a whole number, 0 or more: ${env.MCP_RATE_LIMIT_PER_MINUTE}`);
    }

    const disabledTools = (env.MCP_DISABLED_TOOLS || '').split(',').map((name) => name.trim()).filter(Boolean);

    const swapHeaders = parseHeadersEnv(env.OAUTH_SWAP_HEADERS, 'OAUTH_SWAP_HEADERS');

    const { baseUrl, headers } = loadApiConfig(env);

    return {
        port,
        publicUrl,
        resourceUrl: `${publicUrl}/mcp`,
        metadataUrl: `${publicUrl}/.well-known/oauth-protected-resource`,
        issuer,
        swapUrl,
        swapSecret,
        swapHeaders,
        apiBaseUrl: baseUrl,
        apiHeaders: headers,
        maxResultChars,
        rateLimitPerMinute,
        disabledTools,
    };
}
