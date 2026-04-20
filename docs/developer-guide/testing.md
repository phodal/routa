---
title: Testing
---

# Testing

Routa uses `entrix` and the `docs/fitness/` rulebook as the canonical validation system for
source-code changes.

## Recommended Validation Flow

For source-code changes, use this order:

```bash
entrix run --dry-run
entrix run --tier fast
entrix run --tier normal
```

Use `fast` for quick feedback and `normal` when behavior, shared modules, APIs, or workflow
orchestration changed.

## Install

```bash
cargo build -p entrix
```

## What The Tiers Mean

- `fast`: linting, static analysis, and contract checks
- `normal`: unit tests, API tests, and broader code-quality gates
- `deep`: longer-running UI, security, and regression evidence

## UI And Runtime Checks

- Use Playwright for automated UI coverage.
- Use browser or desktop walkthroughs for smoke validation when the UI changes.
- For Tauri UI smoke checks, run `npm run tauri dev` and verify `http://127.0.0.1:3210/`.

## Docs-Only Changes

If the change is strictly non-code such as `docs/`, `*.md`, `*.yml`, or `.github/`, source-code
validation can be skipped.

## Canonical Rulebook

The full fitness-function and evidence model lives in the repository rulebook:

- [docs/fitness/README.md](https://github.com/phodal/routa/blob/main/docs/fitness/README.md)
