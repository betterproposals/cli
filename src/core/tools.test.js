import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { annotationsFor, buildTools } from './tools.js';

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
