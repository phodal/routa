---
title: Self-Hosting
---

# Self-Hosting

Routa can be used as a packaged Desktop app, but the web/runtime surface can also be run in your
own environment.

## What Self-Hosting Means Today

Today, self-hosting is primarily about running the Next.js web surface and, when needed, wiring
it to a local or remote backend/runtime.

## Basic Local Flow

Run the web surface from source:

```bash
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000`.

If you want the web UI to point at a local backend:

```bash
ROUTA_RUST_BACKEND_URL="http://127.0.0.1:3210" npm run dev
```

## Operational Concerns

The main things to think about are:

- which provider paths are available
- which environment variables are set
- whether the backend/runtime surface is reachable from the web UI
- whether Docker-backed execution paths are available when required

## What This Is Not Yet

The repository currently has stronger release and contributor docs than full public production
self-hosting runbooks. Treat this page as the operational entry point, not as a complete hosting
manual.

## Read Next

- [Configuration](/configuration)
- [Deployment](/deployment)
- [Release Guide](/release-guide)
