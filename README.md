# Better Proposals CLI (Developer Setup)
_(This will be user-facing CLI documentation later on)_

## Install

### macOS / Linux

**While the repo is private (testing phase):** 

You need a GitHub Personal Access Token with `repo` scope. Generate one at `github.com → Settings → Developer settings → Personal access tokens` or use an existing one.

Since we don't have a "release" tag yet (just pre-release), you'll need to install a specific version of the CLI, specified with the `BP_CLI_VERSION` env var.

```bash
curl -fsSL https://cli.dev.betterproposals.io/cli-install | env BP_CLI_VERSION=v0.4.3 GITHUB_TOKEN=[PERSONAL_ACCESS_TOKEN] bash
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
$env:GITHUB_TOKEN="[PERSONAL_ACCESS_TOKEN]"; $env:BP_CLI_VERSION="v0.4.3"; iwr https://cli.dev.betterproposals.io/cli-install-windows | iex
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

For Llama models (e.g. a `qwen3.5:2b` small model) the CLI ships its own agent loop instead of relying on a host app. It speaks to any Ollama-compatible `/api/chat` endpoint, advertises all Better Proposals tools via the `tools` field, and dispatches the model's `tool_calls` against the same handlers the MCP server uses.

Configure the endpoint with env vars (override per-invocation with `--endpoint` / `--model`):

```bash
export BETTERPROPOSALS_LLAMA_URL="http://llama-host:11434/api/chat"
export BETTERPROPOSALS_LLAMA_MODEL="qwen3.5:2b"
```

Then send a natural-language prompt:

```bash
betterproposals ai "How many documents have I sent today?"
```

For programmatic use (e.g. the web-app shell), `--json` returns the response plus a structured trace of every tool call:

```bash
betterproposals ai "List the last 3 templates I created" --json
```

### OpenRouter (cloud) mode

Both `ai` and `ask` can run the agent LLM on [OpenRouter](https://openrouter.ai) instead of local Ollama — useful when you don't have a GPU box handy or want a stronger model. Add `--openrouter`:

```bash
cp .env.example .env          # then put your key in .env
# OPENROUTER_API_KEY=sk-or-...

betterproposals ai "How many documents have I sent today?" --openrouter
```

Bun auto-loads `.env`, so no extra tooling is needed. The key can also be supplied via the `OPENROUTER_API_KEY` environment variable directly.

In OpenRouter mode **every stage** runs in the cloud — no local Ollama is required at all. Default models per stage:

| Stage | Local Ollama | OpenRouter |
|-------|--------------|------------|
| `ai` agent | `qwen3.5:2b` | `qwen/qwen3.5-9b` |
| `ask` translation (both directions) | `hy-chat-translator-in/out` | `deepseek/deepseek-v4-flash` |
| `ask` triage + article embeddings | `nomic-embed-text` | `openai/text-embedding-3-small` |
| `ask` article reranker (general path, top-K) | off | `deepseek/deepseek-v4-flash` |
| `ask` intent gate (MCP-vs-general) | `qwen3.5:2b` | `deepseek/deepseek-v4-flash` |
| `ask` MCP agent — simple | `qwen3.5:2b` | `deepseek/deepseek-v4-flash` |
| `ask` MCP agent — medium | `qwen3.5:4b` | `deepseek/deepseek-v4-pro` |
| `ask` MCP agent — complex | `qwen3.5:9b` | `qwen/qwen3.7-plus` |

Override any of these with `--model` (ai), `--mcp-model` / `--mcp-tier` (ask agent), `--translator-in` / `--translator-out` (ask translation), or `--embed-model` (ask triage/articles).

The custom local translator models (`hy-chat-translator-*`, built from `ali6parmak/hy-mt1.5`) can't run on the cloud, so in OpenRouter mode their Modelfile system prompts are sent in-request to `deepseek/deepseek-v4-flash` instead. Embedding caches are keyed by model name, so the 768-dim local (`nomic`) and 1536-dim cloud (`text-embedding-3-small`) vectors never collide — switching providers back and forth doesn't force a recompute.

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

## Triage + multilingual (`ask`)

`ask` is the production entry point. Most user prompts split into two patterns: **how-to questions** ("how do I add a price table?") and **data lookups** ("how many sent today?"). The first kind can be answered for free by pointing at the right help article; the second needs the agent loop and a real LLM. `ask` decides which path automatically.

```bash
betterproposals ask "Quante proposte ho inviato oggi?"
```

### Pipeline

1. **Language detection + translate-in** — converts the prompt to English (and remembers the source language for the response).
   - *Ollama:* `franc-min` (pure JS, no model) detects the language, then `hy-chat-translator-in` (fine-tuned `ali6parmak/hy-mt1.5`) translates if it isn't English.
   - *OpenRouter:* a single `deepseek/deepseek-v4-flash` call returns `{lang, english}` together. This is far more robust than franc on short text — franc mislabels e.g. "create a proposal about a coffee shop" as Romanian, which previously caused the whole answer to come back in the wrong language.
2. **Triage (cosine first pass)** — the English prompt is embedded (`nomic-embed-text` local / `openai/text-embedding-3-small` cloud) and compared against two anchor sets (general help vs MCP-actionable) via cosine similarity. Anchor embeddings are cached per model under `~/.betterproposals/`.
3. **Intent gate (complementary step)** — cosine can't separate *"how do I create a proposal"* (how-to → general) from *"create a proposal"* (action → MCP); the anchors are lexically near and scores land within a few hundredths. So whenever cosine picks **general**, a fast LLM (`qwen3.5:2b` local / `deepseek/deepseek-v4-flash` cloud) re-checks intent with an **MCP-priority bias** and flips to MCP if the message is really a command or data query. Instructional phrasing ("how do I…", "where do I…") stays general. Recent `--session` turns are fed in so follow-ups like *"yes, set the tax to 21%"* are understood in context and stay on the data path.
4. **Route**:
   - **General path** — *no agent LLM*. The English prompt is embedded once more and compared against the ~150 help-center articles (`src/data/help-articles.json`) by cosine similarity; the top-5 candidates are then reranked by a small LLM on OpenRouter (`deepseek/deepseek-v4-flash`, off locally) so questions whose lexical top-1 is wrong still get the best article (e.g. "Indian rupees — how do I set them?" picks "Finance settings" over the cosine winner "Using quantities"). Disable with `--no-reranker`.
   - **MCP path** — tiered escalation based on prompt complexity (`simple` / `medium` / `complex`). The model behind each tier depends on the provider — see the [OpenRouter table](#openrouter-cloud-mode). Complexity is computed deterministically from prompt length, multi-step conjunctions, aggregation words, comparison words, and time ranges — no LLM call needed to pick the tier. Override with `--mcp-tier` or `--mcp-model`.
5. **Translate-out** — translates the English response back to the user's language (`hy-chat-translator-out` local / `deepseek/deepseek-v4-flash` cloud). **URLs are masked as `[[URL0]]` placeholders before translation and spliced back afterwards** so help-article links never get mangled (without this, `/en/articles/4984101-using-pricing-tables` would be "translated" into a non-existent `/it/articles/...` URL).

### Required setup

### Session pinning (`--session`)

When a `--session <id>` is passed:

- **Detected language is pinned** — the language from the first turn is reused for every subsequent turn in the session, so the language can't drift between short prompts and the outbound translator can't prepend language labels ("Italiano:") to the final response.
- **MCP path is pinned** — as soon as a turn has been routed MCP, every later turn in the same session stays on MCP. The general path has no session memory (it returns a static article link), so dropping back to general mid-conversation would silently lose the prior messages. The pinning signal is the session messages file (`~/.betterproposals/sessions/<id>.json`) which only the MCP agent ever writes.

Metadata (pinned language, last path) is stored separately in `~/.betterproposals/sessions/<id>.meta.json`.

```bash
betterproposals ask "quali sono le mie impostazioni?" --session conv-7 --openrouter
betterproposals ask "sì, vorrei mettere le tasse al 21%" --session conv-7 --openrouter
# second turn stays in MCP with the conversation visible, language stays Italian
```

### Required setup

```bash
ollama pull ali6parmak/hy-mt1.5
ollama create hy-chat-translator-in  -f ./ModelFile_hy-mt15-in
ollama create hy-chat-translator-out -f ./ModelFile_hy-mt15-out
ollama pull nomic-embed-text
ollama pull qwen3.5:2b
ollama pull qwen3.5:4b
ollama pull qwen3.5:9b
```

### Options

| Option | Description | Default |
|--------|-------------|---------|
| `--endpoint <url>` | Ollama endpoint for translation + embeddings | `$BETTERPROPOSALS_LLAMA_URL` or `http://localhost:11434/api/chat` |
| `--openrouter` | Run the whole pipeline on OpenRouter — translation, embeddings, intent gate, reranker, agent | off |
| `--translator-in <name>` | IN translator model | `$BETTERPROPOSALS_TRANSLATOR_IN` or `hy-chat-translator-in` |
| `--translator-out <name>` | OUT translator model | `$BETTERPROPOSALS_TRANSLATOR_OUT` or `hy-chat-translator-out` |
| `--embed-model <name>` | Embedding model (triage + article matching) | `$BETTERPROPOSALS_EMBED_MODEL` or `nomic-embed-text` |
| `--reranker-model <name>` | Model for the top-K article reranker (OpenRouter only) | `$BETTERPROPOSALS_RERANKER_MODEL` or `deepseek/deepseek-v4-flash` on OpenRouter |
| `--no-reranker` | Disable the LLM reranker; fall back to top-1 cosine on the general path | off |
| `--mcp-tier <tier>` | Force `simple` / `medium` / `complex` | auto-detected |
| `--mcp-model <name>` | Pin a specific MCP model, overrides the tier mapping | — |
| `--mcp-timeout <seconds>` | Per-request timeout on the MCP path | inherits `ai` defaults |
| `--translate-timeout <seconds>` | Per-request timeout for translate calls | 120 |
| `--no-translate` | Treat input as English, skip both translate steps | off |
| `--force <general\|mcp>` | Bypass triage | — |
| `--triage-only` | Print the triage decision and exit | off |
| `--session <id>` | Persist MCP-path history under this ID | — |
| `--num-ctx <n>` | Ollama context window (MCP path only) | inherits `ai` defaults |
| `--max-iterations <n>` | Max tool-calling rounds on the MCP path | `8` |
| `--max-tool-items <n>` | Cap on tool-result `data` array items | inherits `ai` defaults |
| `--json` | Output structured `{language, decision, mcpTier, mcpModel, article, response, englishResponse, trace}` | off |

### Debugging

`--triage-only` short-circuits the route and prints the decision:

```bash
betterproposals ask "How do I change my brand colors?" --triage-only
# path: general
# generalScore: 0.9123  (best anchor: How do I customize my brand logo and colors?)
# mcpScore:     0.4521  (best anchor: Show me my brand settings)
# language: en (English)
# englishPrompt: How do I change my brand colors?
```

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
| `--openrouter` | Run on OpenRouter instead of local Ollama (needs `OPENROUTER_API_KEY`) | off |
| `--model <name>` | Model name | `$BETTERPROPOSALS_LLAMA_MODEL` or `qwen3.5:2b` (Ollama) / `qwen/qwen3.5-9b` (OpenRouter) |
| `--system <text>` | Override the default system prompt | built-in (includes today's local date) |
| `--max-iterations <n>` | Maximum tool-calling rounds before giving up | `8` |
| `--timeout <seconds>` | Per-request timeout in seconds | `$BETTERPROPOSALS_LLAMA_TIMEOUT` or `300` |
| `--num-ctx <n>` | Ollama context window in tokens (Ollama only) | `$BETTERPROPOSALS_LLAMA_NUM_CTX` or `16384` |
| `--max-tool-items <n>` | Max items kept from a tool result `data` array | `$BETTERPROPOSALS_LLAMA_MAX_TOOL_ITEMS` or `25` |
| `--session <id>` | Persist conversation history under this ID so multi-turn chat works across invocations | `$BETTERPROPOSALS_LLAMA_SESSION` (none) |
| `--json` | Output a structured JSON object with the tool-call trace | off |