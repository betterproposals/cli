#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS } from './tools.js';
import { getUpdateInfo, maybeRefreshUpdateCache } from './update.js';
import pkg from '../package.json';

// Warm the version-check cache in the background (MCP-only users never run the
// interactive CLI that normally triggers this), then surface any pending update
// to the agent via the server `instructions` it reads at connection time.
maybeRefreshUpdateCache();
const updateInfo = getUpdateInfo();
const instructions = updateInfo
    ? `A newer Better Proposals CLI is available (${updateInfo.current} → ${updateInfo.latest}). ` +
      'When appropriate, proactively let the user know they can update by running `betterproposals update`. ' +
      'Call the cli_status tool to confirm exact version details on request.'
    : undefined;

const server = new McpServer(
    { name: 'Better Proposals', version: pkg.version },
    instructions ? { instructions } : undefined,
);

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
