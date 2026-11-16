import { describe, expect, test } from 'bun:test';
import { TOOLS, TOOLS_BY_NAME } from './tools.js';

describe('stdio tools', () => {
    test('are the API tools plus cli_status, 33 in all', () => {
        expect(TOOLS).toHaveLength(33);
        expect(TOOLS.at(-1).name).toBe('cli_status');
        expect(Object.keys(TOOLS_BY_NAME)).toHaveLength(33);
    });

    test('cli_status reads only, but reaches out to GitHub', () => {
        expect(TOOLS_BY_NAME.cli_status.annotations).toEqual({ readOnlyHint: true, openWorldHint: true });
    });

    test('every tool carries annotations', () => {
        expect(TOOLS.filter((tool) => !tool.annotations)).toEqual([]);
    });
});
