import { describe, expect, test } from 'bun:test';
import { MAX_RESULT_CHARS, registerTools } from './register.js';

function fakeServer() {
    const registered = new Map();
    return { registered, registerTool: (name, config, callback) => registered.set(name, { config, callback }) };
}

describe('registerTools', () => {
    test('registers every tool with its description, schema and annotations', () => {
        const server = fakeServer();
        const annotations = { readOnlyHint: true };
        registerTools(server, [{ name: 'a', description: 'Tool a', inputSchema: { x: 1 }, annotations, handler: async () => 1 }]);

        const { config } = server.registered.get('a');
        expect(config).toEqual({ description: 'Tool a', inputSchema: { x: 1 }, annotations });
    });

    test('answers with the result as compact JSON text', async () => {
        const server = fakeServer();
        registerTools(server, [{ name: 'a', handler: async (args) => ({ got: args }) }]);

        const result = await server.registered.get('a').callback({ id: 3 });

        expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify({ got: { id: 3 } }) }] });
    });

    test('turns a thrown error into an error result', async () => {
        const server = fakeServer();
        registerTools(server, [{ name: 'a', handler: async () => { throw new Error('API error 400: nope'); } }]);

        const result = await server.registered.get('a').callback({});

        expect(result).toEqual({ content: [{ type: 'text', text: 'API error 400: nope' }], isError: true });
    });

    test('answers a result at the limit and refuses one above it', async () => {
        const server = fakeServer();
        registerTools(server, [{ name: 'a', handler: async ({ n }) => 'x'.repeat(n) }], { maxResultChars: 1000 });

        const fits = await server.registered.get('a').callback({ n: 998 });
        expect(fits.isError).toBeUndefined();
        expect(fits.content[0].text).toHaveLength(1000);

        const tooBig = await server.registered.get('a').callback({ n: 999 });
        expect(tooBig.isError).toBe(true);
        expect(tooBig.content[0].text).toContain('too large');
        expect(tooBig.content[0].text).toContain('per_page');
        expect(tooBig.content[0].text.length).toBeLessThan(400);
    });

    test('the default limit is 100000 characters', async () => {
        expect(MAX_RESULT_CHARS).toBe(100000);
        const server = fakeServer();
        registerTools(server, [{ name: 'a', handler: async () => 'x'.repeat(MAX_RESULT_CHARS) }]);

        expect((await server.registered.get('a').callback({})).isError).toBe(true);
    });
});
