import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resetContextForTests, runWithContext } from './context.js';
import { annotationsFor, buildTools, withoutPriceTables } from './tools.js';

const WRITE_TOOLS = [
    'companies_create', 'document_types_create', 'documents_block_pricing', 'documents_create',
    'documents_create_cover', 'documents_edit', 'documents_edit_cover', 'documents_links',
];

describe('buildTools', () => {
    const tools = buildTools();

    test('exposes the API tools, without the ones only the local CLI has', () => {
        const names = tools.map((tool) => tool.name);
        expect(names).toHaveLength(27);
        expect(new Set(names).size).toBe(27);
        expect(names).not.toContain('cli_status');
        expect(names).toContain('api_limits');
        expect(names).not.toContain('documents_send');
    });

    test('gives every tool a handler, a schema and annotations', () => {
        for (const tool of tools) {
            expect(typeof tool.handler).toBe('function');
            expect(typeof tool.inputSchema).toBe('object');
            expect(tool.annotations).toBeDefined();
            expect(tool.annotations.openWorldHint).toBe(false);
        }
    });

    test('marks exactly the write tools as writes', () => {
        const writes = tools.filter((tool) => tool.annotations.readOnlyHint === false).map((tool) => tool.name);
        expect(writes.sort()).toEqual(WRITE_TOOLS);
        for (const tool of tools.filter((t) => t.annotations.readOnlyHint)) {
            expect(tool.annotations.destructiveHint).toBeUndefined();
        }
    });

    test('flags the tools that can overwrite or remove existing data as destructive', () => {
        const destructive = tools.filter((tool) => tool.annotations.destructiveHint === true).map((tool) => tool.name).sort();
        expect(destructive).toEqual(['documents_block_pricing', 'documents_edit', 'documents_edit_cover', 'documents_links']);
        expect(annotationsFor('documents_create').destructiveHint).toBe(false);
    });

    test('refuses a tool nobody classified', () => {
        expect(() => annotationsFor('documents_new_thing')).toThrow('documents_new_thing is not classified');
    });

    test('describes the size limits with the notes it is given', () => {
        const custom = buildTools({ limitNotes: { value: ' VALUE-NOTE', json: ' JSON-NOTE' } });
        const byName = Object.fromEntries(custom.map((tool) => [tool.name, tool]));

        expect(byName.companies_create.inputSchema.company_name.description).toContain(' VALUE-NOTE');
        expect(byName.documents_create.inputSchema.contacts.description).toContain(' JSON-NOTE');
    });

    test('without notes it describes the standard limit', () => {
        const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));

        expect(byName.companies_create.inputSchema.company_name.description).toContain('Max 1000 bytes');
    });

    test('keeps the notes of one build out of the next', () => {
        buildTools({ limitNotes: { value: ' ONLY-FOR-THE-FIRST' } });
        const byName = Object.fromEntries(buildTools().map((tool) => [tool.name, tool]));

        expect(byName.companies_create.inputSchema.company_name.description).not.toContain('ONLY-FOR-THE-FIRST');
    });
});

describe('src/core', () => {
    test('does not depend on the stdio or http entry points', () => {
        const dir = new URL('.', import.meta.url).pathname;
        const files = readdirSync(dir).filter((file) => file.endsWith('.js') && !file.endsWith('.test.js'));
        expect(files.length).toBeGreaterThan(4);

        for (const file of files) {
            const source = readFileSync(dir + file, 'utf8');
            expect(`${file}: ${/from '\.\.\/(stdio|http)\//.test(source)}`).toBe(`${file}: false`);
        }
    });
});

describe('disabled tools', () => {
    test('leaves out the named tools and keeps the rest', () => {
        const names = buildTools({ disabled: ['documents_edit', 'api_limits'] }).map((tool) => tool.name);
        expect(names).toHaveLength(25);
        expect(names).not.toContain('documents_edit');
        expect(names).not.toContain('api_limits');
    });

    test('a name that is not a tool throws, naming it', () => {
        expect(() => buildTools({ disabled: ['documents_get', 'nope', 'documents_populate'] })).toThrow('nope, documents_populate');
    });
});

describe('list size controls', () => {
    const byName = (name) => buildTools().find((tool) => tool.name === name);

    test('per_page defaults to 10 and is capped at 50 on every paginated tool', () => {
        for (const tool of buildTools().filter((t) => t.inputSchema.per_page)) {
            const schema = tool.inputSchema.per_page;
            expect(schema.parse(undefined)).toBe(10);
            expect(schema.parse(50)).toBe(50);
            expect(schema.safeParse(51).success).toBe(false);
        }
    });

    test('withoutPriceTables drops the tables of every document and keeps the rest', () => {
        const answer = { status: 'success', data: [{ ID: 1, PriceTables: [{ a: 1 }] }, { ID: 2 }] };
        expect(withoutPriceTables(answer)).toEqual({ status: 'success', data: [{ ID: 1 }, { ID: 2 }] });
        expect(answer.data[0].PriceTables).toBeDefined();
    });

    test('withoutPriceTables leaves anything that is not a list answer alone', () => {
        expect(withoutPriceTables({ status: 'error' })).toEqual({ status: 'error' });
        expect(withoutPriceTables(null)).toBe(null);
    });

    test('the list tools leave the pricing tables out, documents_get does not touch them', async () => {
        const realFetch = globalThis.fetch;
        globalThis.fetch = async () => new Response(JSON.stringify({ status: 'success', data: [{ ID: 1, PriceTables: [{ a: 1 }] }] }));
        try {
            const context = { baseUrl: 'http://api.test', headers: {}, getAuthHeaders: async () => ({}) };
            for (const name of ['documents_list', 'documents_list_new', 'documents_list_opened', 'documents_list_sent', 'documents_list_signed', 'documents_list_paid']) {
                const answer = await runWithContext(context, () => byName(name).handler({ page: 1, per_page: 10 }));
                expect(answer).toEqual({ status: 'success', data: [{ ID: 1 }] });
            }
            const one = await runWithContext(context, () => byName('documents_get').handler({ id: 1 }));
            expect(JSON.stringify(one)).toContain('PriceTables');
        } finally {
            globalThis.fetch = realFetch;
            resetContextForTests();
        }
    });
});
