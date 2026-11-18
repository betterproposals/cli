import { describe, expect, test } from 'bun:test';
import { loadHttpConfig } from './config.js';

const valid = {
    MCP_PUBLIC_URL: 'https://mcp.example.com/',
    OAUTH_ISSUER: 'https://app.example.com',
    OAUTH_SWAP_URL: 'http://10.0.0.5/oauth/internal/swap',
    OAUTH_SWAP_SECRET: 'x'.repeat(32),
};

describe('loadHttpConfig', () => {
    test('reads the settings and derives the resource and metadata URLs', () => {
        const config = loadHttpConfig({ ...valid, BP_API_URL: 'http://api.internal/', BP_API_HEADERS: '{"Host":"api.example.com"}', OAUTH_SWAP_HEADERS: '{"X-Forwarded-Proto":"https"}', PORT: '8080' });

        expect(config).toEqual({
            port: 8080,
            publicUrl: 'https://mcp.example.com',
            resourceUrl: 'https://mcp.example.com/mcp',
            metadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource',
            issuer: 'https://app.example.com',
            swapUrl: 'http://10.0.0.5/oauth/internal/swap',
            swapSecret: 'x'.repeat(32),
            swapHeaders: { 'X-Forwarded-Proto': 'https' },
            apiBaseUrl: 'http://api.internal',
            apiHeaders: { Host: 'api.example.com' },
            maxResultChars: 100000,
            rateLimitPerMinute: 120,
            disabledTools: [],
        });
    });

    test('the largest answer defaults to 100000 and can be set', () => {
        expect(loadHttpConfig(valid).maxResultChars).toBe(100000);
        expect(loadHttpConfig({ ...valid, MCP_MAX_RESULT_CHARS: '50000' }).maxResultChars).toBe(50000);
    });

    test.each(['abc', '10', '1.5'])('MCP_MAX_RESULT_CHARS %s is refused', (value) => {
        expect(() => loadHttpConfig({ ...valid, MCP_MAX_RESULT_CHARS: value })).toThrow('MCP_MAX_RESULT_CHARS');
    });

    test('the rate limit defaults to 120 a minute, 0 switches it off', () => {
        expect(loadHttpConfig(valid).rateLimitPerMinute).toBe(120);
        expect(loadHttpConfig({ ...valid, MCP_RATE_LIMIT_PER_MINUTE: '0' }).rateLimitPerMinute).toBe(0);
        expect(loadHttpConfig({ ...valid, MCP_RATE_LIMIT_PER_MINUTE: '30' }).rateLimitPerMinute).toBe(30);
    });

    test.each(['abc', '-1', '1.5'])('MCP_RATE_LIMIT_PER_MINUTE %s is refused', (value) => {
        expect(() => loadHttpConfig({ ...valid, MCP_RATE_LIMIT_PER_MINUTE: value })).toThrow('MCP_RATE_LIMIT_PER_MINUTE');
    });

    test('MCP_DISABLED_TOOLS is a trimmed comma list', () => {
        expect(loadHttpConfig({ ...valid, MCP_DISABLED_TOOLS: ' documents_edit, documents_create ,,' }).disabledTools).toEqual(['documents_edit', 'documents_create']);
    });

    test('the port defaults to 3000', () => {
        expect(loadHttpConfig(valid).port).toBe(3000);
    });

    test.each(['MCP_PUBLIC_URL', 'OAUTH_ISSUER', 'OAUTH_SWAP_URL'])('%s is required', (name) => {
        const env = { ...valid };
        delete env[name];
        expect(() => loadHttpConfig(env)).toThrow(`${name} is required`);
    });

    test('a URL setting must be a URL', () => {
        expect(() => loadHttpConfig({ ...valid, OAUTH_ISSUER: 'not a url' })).toThrow('OAUTH_ISSUER is not a valid URL');
    });

    test('the swap secret must be present and long enough', () => {
        expect(() => loadHttpConfig({ ...valid, OAUTH_SWAP_SECRET: 'short' })).toThrow('OAUTH_SWAP_SECRET');
        expect(() => loadHttpConfig({ ...valid, OAUTH_SWAP_SECRET: undefined })).toThrow('OAUTH_SWAP_SECRET');
    });

    test('the port must be valid', () => {
        expect(() => loadHttpConfig({ ...valid, PORT: 'abc' })).toThrow('PORT');
        expect(() => loadHttpConfig({ ...valid, PORT: '70000' })).toThrow('PORT');
    });

    test('the swap headers default to none', () => {
        expect(loadHttpConfig(valid).swapHeaders).toEqual({});
    });

    test('bad header settings are refused, naming the variable', () => {
        expect(() => loadHttpConfig({ ...valid, BP_API_HEADERS: 'nope' })).toThrow('BP_API_HEADERS');
        expect(() => loadHttpConfig({ ...valid, OAUTH_SWAP_HEADERS: 'nope' })).toThrow('OAUTH_SWAP_HEADERS');
        expect(() => loadHttpConfig({ ...valid, OAUTH_SWAP_HEADERS: '{"A":1}' })).toThrow('OAUTH_SWAP_HEADERS');
    });
});
