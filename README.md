# Better Proposals CLI (Developer Setup)
_(This will be user-facing CLI documentation later on)_

## Prerequisites

- [Bun](https://bun.com) v1.3+

## Install

```bash
bun install
bun link
```

`bun link` registers the package globally so the `betterproposals` binary is available anywhere in your shell.

## Run without installing

```bash
bun src/index.js <command>
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