#!/usr/bin/env bun
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { TOOLS } from './tools.js';
import { registerTools } from '../core/register.js';
import { getUpdateInfo, maybeRefreshUpdateCache } from './update.js';
import { describeLimit } from '../core/limits.js';
import { getCachedLimits } from './limits-cache.js';
import { configureStdioContext } from './bootstrap.js';
import pkg from '../../package.json';

configureStdioContext();

// Warm the version-check cache in the background (MCP-only users never run the
// interactive CLI that normally triggers this), then surface any pending update
// to the agent via the server `instructions` it reads at connection time.
maybeRefreshUpdateCache();

// Instructions are built synchronously at connect time, so the limit comes from
// the disk cache. It's advisory — the api_limits tool gives the live value, and
// api.js enforces against it — so a cold cache showing the conservative default
// is fine.
const notes = [describeLimit(getCachedLimits())];

const updateInfo = getUpdateInfo();
if (updateInfo) {
    notes.push(
        `A newer Better Proposals CLI is available (${updateInfo.current} → ${updateInfo.latest}). ` +
        'When appropriate, proactively let the user know they can update by running `betterproposals update`. ' +
        'Call the cli_status tool to confirm exact version details on request.'
    );
}

const server = new McpServer(
    { name: 'Better Proposals', version: pkg.version },
    { instructions: notes.join('\n\n') },
);

registerTools(server, TOOLS);

const transport = new StdioServerTransport();
await server.connect(transport);
