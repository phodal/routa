---
title: Web
---

# Web

Web is a first-class Routa runtime surface when you want browser-based access instead of the
packaged desktop app.

## When To Use Web

- self-hosting
- browser-based access for your own team
- internal deployment that preserves the same workspace model used by Desktop

## Run Locally

```bash
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000`.

If you want the web UI to point at a local backend:

```bash
ROUTA_RUST_BACKEND_URL="http://127.0.0.1:3210" npm run dev
```

## Best Fit

Use Web when you want:

- the browser surface instead of a packaged desktop app
- self-hosted deployment for your own team
- a hosted internal entry point to the same product model

## Why Web Is Different

Web is intentionally described as a runtime surface, not the default first-install path. If
your goal is to start using Routa quickly, choose [Desktop](/platforms/desktop) or
[CLI](/platforms/cli) first.

## Related Docs

- [Quick Start](/quick-start)
- [Administration](/administration)
- [Configuration](/configuration)
