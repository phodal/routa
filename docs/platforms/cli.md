---
title: CLI
---

# CLI

Routa CLI is the best entry point if you want terminal-first usage or scriptable workflows.

## Install Options

### npm

```bash
npm install -g routa-cli
```

This is the recommended install path for most CLI users.

### Cargo

```bash
cargo install routa-cli
```

### Try Without Installing

```bash
npx -p routa-cli routa --help
```

## First Commands

```bash
routa --help
routa --version
routa -p "Explain the architecture of this repository"
routa -p "Plan the next refactor for this codebase"
routa acp runtime-status
```

## Good Fit

Use CLI when you want:

- one-shot prompts
- provider/runtime inspection
- scripting and automation
- direct terminal workflows inside a repository

## What Success Looks Like

Your first CLI setup is working once you can:

- run `routa --help`
- execute one prompt against a real repository with `routa -p "..."`
- inspect runtime state with `routa acp runtime-status`

## Related Docs

- [Quick Start](/quick-start)
- [Configuration](/configuration)
- [Use Routa](/use-routa)
