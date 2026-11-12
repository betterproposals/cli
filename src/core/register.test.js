import { describe, expect, test } from 'bun:test';
import { registerTools } from './register.js';

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

    test('answers with the result as pretty JSON text', async () => {
        const server = fakeServer();
        registerTools(server, [{ name: 'a', handler: async (args) => ({ got: args }) }]);

        const result = await server.registered.get('a').callback({ id: 3 });

        expect(result).toEqual({ content: [{ type: 'text', text: JSON.stringify({ got: { id: 3 } }, null, 2) }] });
    });

    test('turns a thrown error into an error result', async () => {
        const server = fakeServer();
        registerTools(server, [{ name: 'a', handler: async () => { throw new Error('API error 400: nope'); } }]);

        const result = await server.registered.get('a').callback({});

        expect(result).toEqual({ content: [{ type: 'text', text: 'API error 400: nope' }], isError: true });
    });
});
