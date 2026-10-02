import { homedir } from 'os';
import { join } from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { execSync } from 'child_process';

export const TARGETS = ['claude-desktop', 'claude-code', 'cursor', 'antigravity', 'gemini'];

const RESTART_HINTS = {
    'claude-desktop': 'Restart Claude Desktop for changes to take effect.',
    'claude-code': 'Reload Claude Code for changes to take effect.',
    'cursor': 'Restart Cursor for changes to take effect.',
    'antigravity': 'Restart Antigravity for changes to take effect.',
    'gemini': 'Restart Gemini for changes to take effect.',
};

// Agents whose CLI manages its own MCP config, so we shell out instead of
// writing JSON. Claude Code silently ignores entries written to settings.json.
// `add` is followed by the server command; `agy` has no scope flag.
const CLI_TARGETS = {
    'claude-code': { bin: 'claude', add: 'mcp add -s user betterproposals', remove: 'mcp remove betterproposals -s user' },
    'antigravity': { bin: 'agy', add: 'mcp add betterproposals', remove: 'mcp remove betterproposals' },
    'gemini': {
        bin: 'gemini',
        add: 'mcp add -s user betterproposals',
        remove: 'mcp remove betterproposals',
        deprecated: 'Gemini CLI was retired for personal Google accounts on 2026-06-18. Use the `antigravity` target instead.',
    },
};

function configPath(target) {
    const home = homedir();
    const isWindows = process.platform === 'win32';

    switch (target) {
        case 'claude-desktop': {
            if (!isWindows) {
                return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
            }
            // Claude Desktop from the Microsoft Store uses a sandboxed LocalCache path.
            // The package folder name contains a publisher hash, so we detect it dynamically.
            const packagesDir = join(process.env.LOCALAPPDATA ?? '', 'Packages');
            try {
                const claudePkg = readdirSync(packagesDir).find(e => e.startsWith('Claude_'));
                if (claudePkg) {
                    return join(packagesDir, claudePkg, 'LocalCache', 'Roaming', 'Claude', 'claude_desktop_config.json');
                }
            } catch { /* Packages dir absent — not a Store install */ }
            return join(process.env.APPDATA ?? '', 'Claude', 'claude_desktop_config.json');
        }
        case 'cursor':
            return join(home, '.cursor', 'mcp.json');
        default:
            return null;
    }
}

function readConfig(path) {
    if (!existsSync(path)) return {};
    const raw = readFileSync(path, 'utf8');
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error(`Config file at ${path} contains invalid JSON. Fix it manually before running this command.`);
    }
}

function writeConfig(path, config) {
    const dir = path.substring(0, path.lastIndexOf('/') === -1 ? path.lastIndexOf('\\') : path.lastIndexOf('/'));
    if (dir) mkdirSync(dir, { recursive: true });
    writeFileSync(path, JSON.stringify(config, null, 2) + '\n', 'utf8');
}

function resolveMcpBinary() {
    // `which` doesn't exist on Windows — use `where` there. `where` can
    // return multiple matches (one per line), so take the first.
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    try {
        const out = execSync(`${lookup} betterproposals-mcp`, { encoding: 'utf8' }).trim();
        return out.split(/\r?\n/)[0].trim();
    } catch {
        throw new Error(
            'betterproposals-mcp binary not found on PATH.\n' +
            'Run `bun link` (or `npm install -g @betterproposals/cli`) first, then retry.'
        );
    }
}

function quoteArg(arg) {
    // Wrap in double quotes if the path contains whitespace, so the shell
    // passes it as a single arg to `claude mcp add` / `agy mcp add`.
    return /\s/.test(arg) ? `"${arg}"` : arg;
}

function validateTarget(target) {
    if (!TARGETS.includes(target)) {
        console.error(`Unknown target "${target}". Valid targets: ${TARGETS.join(', ')}`);
        process.exit(1);
    }
}

function runAgentCli(target, action, command) {
    const { bin, add, remove, deprecated } = CLI_TARGETS[target];
    if (deprecated) console.warn(`Warning: ${deprecated}`);

    const line = action === 'add' ? `${bin} ${add} ${quoteArg(command)}` : `${bin} ${remove}`;
    try {
        execSync(line, { stdio: 'inherit' });
    } catch {
        const verb = action === 'add' ? 'register' : 'remove';
        throw new Error(`Failed to ${verb} MCP server. Is the \`${bin}\` CLI installed and on PATH?`);
    }
}

export function install(target) {
    validateTarget(target);
    const command = resolveMcpBinary();

    if (CLI_TARGETS[target]) {
        runAgentCli(target, 'add', command);
        console.log(RESTART_HINTS[target]);
        return;
    }

    const path = configPath(target);
    const config = readConfig(path);
    config.mcpServers ??= {};

    if (config.mcpServers.betterproposals) {
        console.log(`Better Proposals MCP server is already registered in ${target} config.`);
        return;
    }

    config.mcpServers.betterproposals = { command };
    writeConfig(path, config);
    console.log(`Registered Better Proposals MCP server in ${path}`);
    console.log(RESTART_HINTS[target]);
}

export function uninstall(target) {
    validateTarget(target);

    if (CLI_TARGETS[target]) {
        runAgentCli(target, 'remove');
        return;
    }

    const path = configPath(target);

    if (!existsSync(path)) {
        console.log(`No config file found at ${path}. Nothing to remove.`);
        return;
    }

    const config = readConfig(path);

    if (!config.mcpServers?.betterproposals) {
        console.log(`Better Proposals MCP server is not registered in ${target} config. Nothing to remove.`);
        return;
    }

    delete config.mcpServers.betterproposals;
    writeConfig(path, config);
    console.log(`Removed Better Proposals MCP server from ${path}`);
}
