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
        const config = loadHttpConfig({ ...valid, BP_API_URL: 'http://api.internal/', BP_API_HEADERS: '{"Host":"api.example.com"}', PORT: '8080' });

        expect(config).toEqual({
            port: 8080,
            publicUrl: 'https://mcp.example.com',
            resourceUrl: 'https://mcp.example.com/mcp',
            metadataUrl: 'https://mcp.example.com/.well-known/oauth-protected-resource',
            issuer: 'https://app.example.com',
            swapUrl: 'http://10.0.0.5/oauth/internal/swap',
            swapSecret: 'x'.repeat(32),
            apiBaseUrl: 'http://api.internal',
            apiHeaders: { Host: 'api.example.com' },
        });
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

    test('a bad BP_API_HEADERS is refused', () => {
        expect(() => loadHttpConfig({ ...valid, BP_API_HEADERS: 'nope' })).toThrow('BP_API_HEADERS');
    });
});
