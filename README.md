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