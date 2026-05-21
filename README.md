# Better Proposals CLI (Developer Setup)
_(This will be user-facing CLI documentation later on)_

## Install

### macOS / Linux

**While the repo is private (testing phase):** 

You need a GitHub Personal Access Token with `repo` scope. Generate one at `github.com → Settings → Developer settings → Personal access tokens` or use an existing one.

Since we don't have a "release" tag yet (just pre-release), you'll need to install a specific version of the CLI, specified with the `BP_CLI_VERSION` env var.

```bash
curl -fsSL https://cli.dev.betterproposals.io/cli-install | env BP_CLI_VERSION=v0.1.0 GITHUB_TOKEN=[PERSONAL_ACCESS_TOKEN] bash
```

**Once the repo is public:** 

Users will be able to just install the latest version with:

```bash
curl -fsSL https://betterproposals.io/cli-install | bash
```

---

### Windows (PowerShell)

**While the repo is private:**

Same with `Windows/PowerShell`, you'll need to install a specific version of the CLI, specified with the `BP_CLI_VERSION` env var.

```powershell
$env:GITHUB_TOKEN="[PERSONAL_ACCESS_TOKEN]"; $env:BP_CLI_VERSION="v0.1.0"; iwr https://cli.dev.betterproposals.io/cli-install-windows | iex
```

**Once the repo is public:**

Again, same as Unix, users will be able to just install the latest version with:

```powershell
iwr https://betterproposals.io/cli-install-windows | iex
```

---

## Developer setup (from source)

⚠️ Not needed if you installed the CLI via the `curl/iwr` command above. ⚠️

### Install from local source code

Requires [Bun](https://bun.com) v1.3+.

```bash
bun install
bun link
```

`bun link` registers the package globally so the `betterproposals` binary is available anywhere in your shell.

### Run from local source code without installing

Requires [Bun](https://bun.com) v1.3+.

```bash
bun src/index.js <command>
```

## MCP (AI Agent Integration)

The CLI includes an MCP server that exposes all Better Proposals functionality as tools to AI agents (Claude, Gemini, Cursor, etc.).

### Setup

1. Authenticate first:
```bash
betterproposals login
```

2. Register the MCP server with your agent:
```bash
betterproposals mcp install claude-code
betterproposals mcp install claude-desktop
betterproposals mcp install cursor
betterproposals mcp install gemini
```

3. Restart your agent app. It will now have access to all Better Proposals tools.

To remove the registration:
```bash
betterproposals mcp uninstall <target>
```

## Llama (self-hosted models)

For Llama models (e.g. a `llama3.2:1b` small model) the CLI ships its own agent loop instead of relying on a host app. It speaks to any Ollama-compatible `/api/chat` endpoint, advertises all Better Proposals tools via the `tools` field, and dispatches the model's `tool_calls` against the same handlers the MCP server uses.

Configure the endpoint with env vars (override per-invocation with `--endpoint` / `--model`):

```bash
export BETTERPROPOSALS_LLAMA_URL="http://llama-host:11434/api/chat"
export BETTERPROPOSALS_LLAMA_MODEL="llama3.2:1b"
```

Then send a natural-language prompt:

```bash
betterproposals ai "How many documents have I sent today?"
```

For programmatic use (e.g. the web-app shell), `--json` returns the response plus a structured trace of every tool call:

```bash
betterproposals ai "List the last 3 templates I created" --json
```

### Multi-turn conversations

Each `betterproposals ai` invocation is its own process and would otherwise start fresh. Pass `--session <id>` to persist conversation history under that ID so follow-up turns retain context:

```bash
betterproposals ai "How many sent documents do I have?" --session user-42-conv-7
betterproposals ai "And how many were paid?"            --session user-42-conv-7
```

History is stored at `~/.betterproposals/sessions/<id>.json` (the system prompt is regenerated each run so the date stays current). The persisted history is capped at 40 messages — older turns are dropped first; override with `BETTERPROPOSALS_LLAMA_MAX_SESSION_MESSAGES`. To start a fresh chat, use a new ID or delete the file.

### Tool-result handling

Raw API responses can be huge (a single sent-proposals list is ~270 KB of JSON), which overwhelms small/local models and causes them to mistake the data for user input. To prevent this, the agent:

1. **Projects each tool result to key fields only** — drops nested noise like `PriceTables`, `Contacts`, full `Description`/`Preview` URLs, audit metadata, and HTML markup.
2. **Caps array results** at `--max-tool-items` (default 25, newest-first preserved).
3. **Saves the full raw JSON** to `<tmp>/betterproposals-ai/<pid>-<ts>/<NNN>-<tool>.json` so it's still inspectable for debugging or the web-app UI — but never enters the model's context.

The slim result fed back to the model includes a `_note` field describing what was projected and where the raw data lives.

## Commands

### `login`

Opens a browser window to authenticate with your Better Proposals account. The token is stored in the OS keychain and reused by subsequent commands.

```bash
betterproposals login
```

---

### `documents all`

List all documents.

```bash
betterproposals documents all [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --page <number>` | Page number | `1` |
| `-n, --per-page <number>` | Results per page | `10` |
| `-t, --type <number>` | Filter by document type ID | — |

---

### `documents new`

List new documents.

```bash
betterproposals documents new [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --page <number>` | Page number | `1` |
| `-n, --per-page <number>` | Results per page | `10` |
| `-t, --type <number>` | Filter by document type ID | — |

---

### `documents opened`

List opened documents.

```bash
betterproposals documents opened [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --page <number>` | Page number | `1` |
| `-n, --per-page <number>` | Results per page | `10` |
| `-t, --type <number>` | Filter by document type ID | — |

---

### `documents sent`

List sent documents.

```bash
betterproposals documents sent [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --page <number>` | Page number | `1` |
| `-n, --per-page <number>` | Results per page | `10` |
| `-t, --type <number>` | Filter by document type ID | — |

---

### `documents signed`

List signed documents.

```bash
betterproposals documents signed [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --page <number>` | Page number | `1` |
| `-n, --per-page <number>` | Results per page | `10` |
| `-t, --type <number>` | Filter by document type ID | — |

---

### `documents paid`

List paid documents.

```bash
betterproposals documents paid [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --page <number>` | Page number | `1` |
| `-n, --per-page <number>` | Results per page | `10` |
| `-t, --type <number>` | Filter by document type ID | — |

---

### `documents get <id>`

Get details for a single document.

```bash
betterproposals documents get <id>
```

---

### `documents count`

Get the total number of documents.

```bash
betterproposals documents count
```

---

### `documents create`

Create a new document.

```bash
betterproposals documents create --company <value> [options]
```

| Option | Description |
|--------|-------------|
| `-c, --company <value>` | **(Required)** Company ID or name. If a name is given and not found, a new company is created. |
| `--cover <id>` | Cover ID |
| `--template <id>` | Template ID to copy from |
| `--document-type <value>` | Document type ID or name |
| `--brand <id>` | Brand ID (uses default brand if omitted) |
| `--currency <code>` | Currency as 3-letter code, e.g. `USD` |
| `--tax <value>` | Enable tax |
| `--tax-label <label>` | Tax label |
| `--tax-amount <amount>` | Tax amount |
| `--contacts <json>` | Contacts as JSON array, e.g. `[{"FirstName":"Jane","Email":"jane@example.com"}]` |
| `--merge-tags <json>` | Merge tags as JSON array, e.g. `[{"tag":"my_tag","value":"My Value"}]` |

---

### `documents create-cover`

Create a document cover.

```bash
betterproposals documents create-cover [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--brand-id <id>` | Brand ID | uses brand settings |
| `--cover-name <name>` | Cover name | `Untitled` |
| `--bg-colour <hex>` | Background colour | `111111` |
| `--headline <text>` | Headline text | `Proposal for _________` |
| `--subheader <text>` | Subheader text | `Written by ________ for ________` |
| `--text-colour <hex>` | Text colour | `ffffff` |
| `--text-align <align>` | Text alignment | `left` |
| `--button-style <style>` | Button style | `round` |
| `--button-text <text>` | Button text | `Start Reading Proposal` |

---

### `settings get`

Get account settings.

```bash
betterproposals settings get
```

---

### `settings brands`

Get brand settings.

```bash
betterproposals settings brand
```

---

### `settings merge-tags`

Get custom merge tags.

```bash
betterproposals settings merge-tags [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --page <number>` | Page number | `1` |
| `-n, --per-page <number>` | Results per page | `10` |

---

### `currencies all`

List all currencies.

```bash
betterproposals currencies all [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --page <number>` | Page number | `1` |
| `-n, --per-page <number>` | Results per page | `10` |

---

### `currencies get <id>`

Get details for a single currency.

```bash
betterproposals currencies get <id>
```

---

### `companies all`

List all companies.

```bash
betterproposals companies all [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --page <number>` | Page number | `1` |
| `-n, --per-page <number>` | Results per page | `10` |

---

### `companies get <id>`

Get details for a single company.

```bash
betterproposals companies get <id>
```

---

### `companies create`

Create a new company.

```bash
betterproposals companies create --company-name <name>
```

| Option | Description |
|--------|-------------|
| `-n, --company-name <name>` | **(Required)** Company name |

---

### `document-types all`

List all document types.

```bash
betterproposals document-types all [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --page <number>` | Page number | `1` |
| `-n, --per-page <number>` | Results per page | `10` |

---

### `document-types create`

Create a new document type.

```bash
betterproposals document-types create --type-name <name> [options]
```

| Option | Description |
|--------|-------------|
| `--type-name <name>` | **(Required)** Document type name |
| `--type-colour <hex>` | Colour hex code (default: `#01A3EF`) |

---

### `templates get <id>`

Get details for a single template.

```bash
betterproposals templates get <id>
```

---

### `templates all`

List all templates.

```bash
betterproposals templates all [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `-p, --page <number>` | Page number | `1` |
| `-n, --per-page <number>` | Results per page | `10` |

---

### `ai <prompt>`

Send a natural-language prompt to a Llama (Ollama-compatible) endpoint with access to all Better Proposals tools. Drives the full agent loop locally — tool defs are advertised to the model, returned `tool_calls` are dispatched against the same handlers the MCP server uses, and results are fed back until the model produces a final answer.

```bash
betterproposals ai "<prompt>" [options]
```

| Option | Description | Default |
|--------|-------------|---------|
| `--endpoint <url>` | Ollama-compatible chat endpoint | `$BETTERPROPOSALS_LLAMA_URL` or `http://localhost:11434/api/chat` |
| `--model <name>` | Model name | `$BETTERPROPOSALS_LLAMA_MODEL` or `llama3.2:1b` |
| `--system <text>` | Override the default system prompt | built-in (includes today's local date) |
| `--max-iterations <n>` | Maximum tool-calling rounds before giving up | `8` |
| `--timeout <seconds>` | Per-request timeout in seconds | `$BETTERPROPOSALS_LLAMA_TIMEOUT` or `300` |
| `--num-ctx <n>` | Ollama context window in tokens | `$BETTERPROPOSALS_LLAMA_NUM_CTX` or `16384` |
| `--max-tool-items <n>` | Max items kept from a tool result `data` array | `$BETTERPROPOSALS_LLAMA_MAX_TOOL_ITEMS` or `25` |
| `--session <id>` | Persist conversation history under this ID so multi-turn chat works across invocations | `$BETTERPROPOSALS_LLAMA_SESSION` (none) |
| `--json` | Output a structured JSON object with the tool-call trace | off |