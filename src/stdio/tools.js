import { buildTools } from '../core/tools.js';
import { jsonLimitNote, valueLimitNote } from '../core/limits.js';
import { getCachedLimits } from './limits-cache.js';
import { cliStatus } from './update.js';

// The tools of the local CLI: the ones of the API, described with the size
// limits of the logged-in account (from the disk cache, they are built before
// anything can be awaited), plus the one that only makes sense on the user's
// machine.
const limits = getCachedLimits();

const cliStatusTool = {
    name: 'cli_status',
    description: 'Report the Better Proposals CLI version and whether a newer release is available. Use when the user asks what version they are on, whether the CLI is up to date, or how to update.',
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
    handler: () => cliStatus(),
};

export const TOOLS = [
    ...buildTools({ limitNotes: { value: valueLimitNote(limits), json: jsonLimitNote(limits) } }),
    cliStatusTool,
];

export const TOOLS_BY_NAME = Object.fromEntries(TOOLS.map((tool) => [tool.name, tool]));
