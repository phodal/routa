---
title: Contributing
---

# Contributing

This page is only needed if you plan to contribute directly to Routa itself. If you are trying
to use, configure, or self-host Routa, start with [Quick Start](/quick-start),
[Configuration](/configuration), or [Administration](/administration) instead.

## Before You Start

- Read [Architecture](/ARCHITECTURE) for runtime boundaries.
- Read [Code Style](/coding-style) for implementation rules.
- Read [Git Workflow](/developer-guide/git-workflow) before you begin committing.
- Keep changes focused and prefer one concern per commit.

## Local Setup

### Web

```bash
npm install --legacy-peer-deps
npm run dev
```

### Desktop

```bash
npm install --legacy-peer-deps
npm --prefix apps/desktop install
npm run tauri:dev
```

## Development Expectations

- Follow the lint, test, and review rules described in [Testing](/developer-guide/testing).
- Do not mix unrelated refactors with feature or bug-fix changes.
- Update docs when public behavior, commands, or workflows change.

## Pull Requests

- Explain the user-visible change and the reasoning.
- Include screenshots or recordings for UI changes.
- List the checks you ran.
- Link related issues when applicable.

## Bugs And Security

- Use [GitHub Issues](https://github.com/phodal/routa/issues) for bugs and feature requests.
- Use [SECURITY.md](https://github.com/phodal/routa/blob/main/SECURITY.md) for security-sensitive reports.
