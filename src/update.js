import { basename, dirname, join } from 'path';
import { homedir } from 'os';
import { chmodSync, renameSync, writeFileSync, readFileSync, mkdirSync, existsSync, unlinkSync, accessSync, constants } from 'fs';
import { execSync, spawn } from 'child_process';
import pkg from '../package.json';

const VERSION = pkg.version;

const REPO = 'betterproposals/cli';
const API_LATEST = `https://api.github.com/repos/${REPO}/releases/latest`;

const CACHE_PATH = join(homedir(), '.betterproposals', 'update-check.json');
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // re-check at most once a day

// Maps the running platform/arch to the release asset names produced by the
// `build:*` scripts in package.json. Keep this in sync with those targets.
const ASSETS = {
    'darwin-arm64': { cli: 'betterproposals-mac-arm64', mcp: 'betterproposals-mcp-mac-arm64' },
    'darwin-x64': { cli: 'betterproposals-mac-x64', mcp: 'betterproposals-mcp-mac-x64' },
    'linux-x64': { cli: 'betterproposals-linux-x64', mcp: 'betterproposals-mcp-linux-x64' },
    'linux-arm64': { cli: 'betterproposals-linux-arm64', mcp: 'betterproposals-mcp-linux-arm64' },
    'win32-x64': { cli: 'betterproposals-win-x64.exe', mcp: 'betterproposals-mcp-win-x64.exe' },
};

function assetNames() {
    const key = `${process.platform}-${process.arch}`;
    const names = ASSETS[key];
    if (!names) {
        throw new Error(
            `Unsupported platform "${key}". Update the CLI manually from ` +
            `https://github.com/${REPO}/releases.`
        );
    }
    return names;
}

// Strip a leading `v` and compare two dotted numeric versions.
// Returns >0 if a > b, <0 if a < b, 0 if equal.
function compareVersions(a, b) {
    const pa = a.replace(/^v/, '').split('.').map(Number);
    const pb = b.replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const diff = (pa[i] || 0) - (pb[i] || 0);
        if (diff !== 0) return diff;
    }
    return 0;
}

function githubHeaders(accept) {
    const headers = {
        Accept: accept,
        'User-Agent': 'betterproposals-cli',
    };
    if (process.env.GITHUB_TOKEN) {
        headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }
    return headers;
}

async function fetchLatestRelease() {
    const response = await fetch(API_LATEST, { headers: githubHeaders('application/vnd.github+json') });
    if (!response.ok) {
        const hint = response.status === 404 || response.status === 401
            ? ' (the repo is private — set GITHUB_TOKEN to a token with `repo` scope)'
            : '';
        throw new Error(`GitHub API returned ${response.status}${hint}.`);
    }
    return response.json();
}

// Pick the download URL for an asset by name. The asset API `url` works for
// private repos when requested with `Accept: application/octet-stream` (GitHub
// redirects to a signed URL, which fetch follows). Falls back to the public
// browser download URL.
function assetUrl(release, name) {
    const asset = (release.assets || []).find((a) => a.name === name);
    if (!asset) {
        throw new Error(`Release ${release.tag_name} has no asset named "${name}".`);
    }
    return asset.url || asset.browser_download_url;
}

// Replacing the binary writes a temp file into its directory and renames over
// it — both need write permission on that directory. Check up front so we fail
// with actionable guidance before downloading ~64 MB, rather than a cryptic
// EACCES on the temp file.
function assertWritableDir(targetPath) {
    const dir = dirname(targetPath);
    try {
        accessSync(dir, constants.W_OK);
    } catch {
        const sudoHint = process.env.GITHUB_TOKEN
            ? 'sudo env GITHUB_TOKEN=<your-token> betterproposals update'
            : 'sudo betterproposals update';
        throw new Error(
            `No write permission for ${dir} (where ${basename(targetPath)} is installed).\n` +
            `Re-run with elevated privileges:\n  ${sudoHint}\n` +
            '(sudo strips environment variables, so pass GITHUB_TOKEN through `env` while the repo is private).'
        );
    }
}

async function replaceBinary(targetPath, url) {
    assertWritableDir(targetPath);
    const response = await fetch(url, { headers: githubHeaders('application/octet-stream') });
    if (!response.ok) {
        throw new Error(`Failed to download ${basename(targetPath)}: HTTP ${response.status}.`);
    }
    const data = Buffer.from(await response.arrayBuffer());

    // Write to a temp file in the same directory so the final rename is atomic
    // (same filesystem) rather than a cross-device copy.
    const tmp = join(dirname(targetPath), `${basename(targetPath)}.new-${process.pid}`);
    writeFileSync(tmp, data);
    if (process.platform !== 'win32') chmodSync(tmp, 0o755);

    if (process.platform === 'win32') {
        // A running .exe can't be overwritten, but it can be renamed. Move the
        // current binary aside, then move the new one in. The .old file stays
        // locked until this process exits; best-effort cleanup, retried next run.
        const old = `${targetPath}.old`;
        if (existsSync(old)) {
            try { unlinkSync(old); } catch { /* still locked from a previous run */ }
        }
        renameSync(targetPath, old);
        renameSync(tmp, targetPath);
        try { unlinkSync(old); } catch { /* expected: locked until exit */ }
    } else {
        // Overwriting a running binary is fine on Unix; the open inode survives.
        renameSync(tmp, targetPath);
    }
}

// Resolve a sibling binary on PATH the same way mcp-install.js does.
function resolveOnPath(name) {
    const lookup = process.platform === 'win32' ? 'where' : 'which';
    try {
        const out = execSync(`${lookup} ${name}`, { encoding: 'utf8' }).trim();
        return out.split(/\r?\n/)[0].trim() || null;
    } catch {
        return null;
    }
}

export async function update({ check = false, force = false } = {}) {
    // Running from source (`bun src/index.js`) or an unstamped build: execPath is
    // the bun runtime, not an installed CLI binary. Don't try to overwrite it.
    const isInstalledBinary = basename(process.execPath).startsWith('betterproposals');
    if (VERSION === '0.0.1' || !isInstalledBinary) {
        console.log(
            'Running from source — `update` only works on an installed binary.\n' +
            'Use `git pull` / `bun install` to update your checkout.'
        );
        return;
    }

    const release = await fetchLatestRelease();
    const latest = release.tag_name;
    const current = `v${VERSION}`;

    if (!force && compareVersions(latest, current) <= 0) {
        console.log(`Already on the latest version (${current}).`);
        return;
    }

    if (check) {
        console.log(`Update available: ${current} → ${latest}. Run "betterproposals update" to install.`);
        return;
    }

    const names = assetNames();

    await replaceBinary(process.execPath, assetUrl(release, names.cli));
    console.log(`Updated betterproposals ${current} → ${latest}.`);

    const mcpPath = resolveOnPath('betterproposals-mcp');
    if (mcpPath) {
        await replaceBinary(mcpPath, assetUrl(release, names.mcp));
        console.log(`Updated betterproposals-mcp → ${latest}.`);
    } else {
        console.warn('betterproposals-mcp not found on PATH — skipped (run `betterproposals mcp install` if you use it).');
    }

    console.log('Done. Re-run your command to use the new version.');
}

// ---------------------------------------------------------------------------
// Passive "update available" notifier
// ---------------------------------------------------------------------------

function readCache() {
    try {
        return JSON.parse(readFileSync(CACHE_PATH, 'utf8'));
    } catch {
        return null;
    }
}

function writeCache(latest) {
    mkdirSync(dirname(CACHE_PATH), { recursive: true });
    writeFileSync(CACHE_PATH, JSON.stringify({ checkedAt: Date.now(), latest }) + '\n', 'utf8');
}

// Run by the hidden `__refresh-update-cache` subcommand in a detached child.
// Best-effort: any failure (e.g. private repo without GITHUB_TOKEN) is swallowed
// so the cache just stays stale and no notice is shown. Never prints, never throws.
export async function refreshUpdateCache() {
    try {
        const release = await fetchLatestRelease();
        if (release?.tag_name) writeCache(release.tag_name);
    } catch {
        /* silent */
    }
}

const updateCheckDisabled = () =>
    VERSION === '0.0.1' || !!process.env.BETTERPROPOSALS_NO_UPDATE_CHECK;

// Returns { current, latest } when the cached check shows a newer release,
// else null. Shared by every passive surface (CLI notifier, MCP instructions,
// agent system prompt). Honors the global opt-out and skips dev/source runs.
export function getUpdateInfo() {
    if (updateCheckDisabled()) return null;
    const cache = readCache();
    if (cache?.latest && compareVersions(cache.latest, `v${VERSION}`) > 0) {
        return { current: `v${VERSION}`, latest: cache.latest };
    }
    return null;
}

// Resolve a `betterproposals` CLI binary to spawn the hidden refresh on. From
// the MCP server, process.execPath is `betterproposals-mcp` (which has no such
// subcommand), so fall back to the CLI on PATH.
function resolveCliBinary() {
    const self = basename(process.execPath);
    if (self.startsWith('betterproposals') && !self.includes('mcp')) return process.execPath;
    return resolveOnPath('betterproposals');
}

// If the cache is missing or stale, fire a detached, unref'd child to refresh it
// for next time — zero latency for the caller. Triggered from the CLI notifier
// and from the MCP/agent entry points so MCP-only users still get a warm cache.
export function maybeRefreshUpdateCache() {
    if (updateCheckDisabled()) return;
    const cache = readCache();
    if (cache && Date.now() - (cache.checkedAt || 0) <= CHECK_INTERVAL_MS) return;
    const bin = resolveCliBinary();
    if (!bin) return;
    try {
        spawn(bin, ['__refresh-update-cache'], { detached: true, stdio: 'ignore' }).unref();
    } catch {
        /* spawning must never break the caller */
    }
}

// Explicit, on-demand status for the `cli_status` agent/MCP tool. Unlike the
// passive surfaces this does a LIVE check (the agent is already awaiting the
// tool call) so the answer is deterministic, falling back to cache on failure.
// Ignores the passive opt-out — the user explicitly asked.
export async function cliStatus() {
    let latest = null;
    try {
        const release = await fetchLatestRelease();
        latest = release?.tag_name ?? null;
        if (latest) writeCache(latest);
    } catch {
        latest = readCache()?.latest ?? null;
    }
    const latestClean = latest ? latest.replace(/^v/, '') : null;
    return {
        current: VERSION,
        latest: latestClean,
        updateAvailable: latestClean ? compareVersions(`v${latestClean}`, `v${VERSION}`) > 0 : false,
        updateCommand: 'betterproposals update',
        ...(latestClean ? {} : { note: 'Latest version is unknown — the check failed (private repo needs GITHUB_TOKEN, or no network).' }),
    };
}

// Called after a normal command finishes (commander postAction hook). Prints a
// one-line nudge to stderr if a newer release is cached, then warms the cache in
// the background. Gated to interactive terminals (skips pipes/redirects/CI) so
// stdout/JSON output is never touched.
export function notifyUpdate() {
    if (process.env.CI || !process.stderr.isTTY) return;
    const info = getUpdateInfo();
    if (info) {
        process.stderr.write(
            `\nUpdate available: ${info.current} → ${info.latest} — run \`betterproposals update\` to upgrade.\n`
        );
    }
    maybeRefreshUpdateCache();
}
