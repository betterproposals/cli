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

    describe('an answer above the limit', () => {
        // a document with 40 line items of 3,000 characters each: IDs are short, descriptions are not
        const document = () => ({
            status: 'success',
            data: { ID: 7, PriceTables: [{ ID: 1, Items: Array.from({ length: 40 }, (_, i) => ({ ID: 100 + i, Description: 'd'.repeat(3000) })) }] },
        });
        const server = (annotations) => {
            const fake = fakeServer();
            registerTools(fake, [{ name: 'a', annotations, handler: async () => document() }], { maxResultChars: 30000 });

            return fake.registered.get('a').callback;
        };

        test('a read is answered with the long texts cut, keeping the IDs', async () => {
            const result = await server({ readOnlyHint: true })({});
            const answer = JSON.parse(result.content[0].text);

            expect(result.isError).toBeUndefined();
            expect(result.content[0].text.length).toBeLessThanOrEqual(30000);
            expect(answer.status).toBe('success');
            expect(answer.data.PriceTables[0].Items[39].ID).toBe(139);
            expect(answer.data.PriceTables[0].Items[0].Description).toMatch(/…\[cut, 3000 chars\]$/);
            expect(answer._notice).toContain('Never send a cut text back');
        });

        test('a write is answered the same way, never as an error', async () => {
            const result = await server({ readOnlyHint: false, destructiveHint: true })({});

            expect(result.isError).toBeUndefined();
            expect(JSON.parse(result.content[0].text).data.PriceTables[0].Items).toHaveLength(40);
        });

        test('a write that does not fit even cut is reported as saved, not as an error', async () => {
            const fake = fakeServer();
            registerTools(fake, [{ name: 'w', annotations: { readOnlyHint: false }, handler: async () => document() }], { maxResultChars: 500 });

            const result = await fake.registered.get('w').callback({});

            expect(result.isError).toBeUndefined();
            expect(result.content[0].text).toStartWith('Saved.');
            expect(result.content[0].text).toContain('Do not send the request again');
        });

        test('a read that does not fit even cut is still refused', async () => {
            const fake = fakeServer();
            registerTools(fake, [{ name: 'r', annotations: { readOnlyHint: true }, handler: async () => document() }], { maxResultChars: 500 });

            const result = await fake.registered.get('r').callback({});

            expect(result.isError).toBe(true);
            expect(result.content[0].text).toContain('too large');
        });

        test('an answer that fits is not touched', async () => {
            const fake = fakeServer();
            const data = { data: [{ ID: 1, Description: 'd'.repeat(5000) }] };
            registerTools(fake, [{ name: 'a', annotations: { readOnlyHint: true }, handler: async () => data }]);

            const result = await fake.registered.get('a').callback({});

            expect(result.content[0].text).toBe(JSON.stringify(data));
        });
    });
});
