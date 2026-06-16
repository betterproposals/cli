#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS } from './tools.js';
import pkg from '../package.json';

const server = new McpServer({
    name: 'Better Proposals',
    version: pkg.version,
});

function ok(data) {
    return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function err(error) {
    return { content: [{ type: 'text', text: error.message }], isError: true };
}

for (const { name, description, inputSchema, handler } of TOOLS) {
    server.registerTool(name, { description, inputSchema }, async (args) => {
        try { return ok(await handler(args)); } catch (e) { return err(e); }
    });
}

const transport = new StdioServerTransport();
await server.connect(transport);
