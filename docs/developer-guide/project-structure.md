---
title: Project Structure
---

# Project Structure

This page is for advanced users, self-hosters, and contributors who need to understand how the
different Routa runtime pieces fit together. If you are just trying to start using Routa, go
back to [Quick Start](/quick-start) or [Platforms](/platforms).

Routa is a workspace-first multi-agent coordination platform with two main runtime surfaces:

- `Web`: Next.js app and API in `src/`
- `Desktop`: Tauri app in `apps/desktop/` backed by Axum in `crates/routa-server/`

The project is intentionally not "two separate products". Web and desktop differ in deployment
model and storage, but they are expected to preserve the same domain semantics, API shape, and
agent-coordination behavior.

## Main Paths

| Path | Purpose |
|---|---|
| `src/app/` | Next.js App Router pages and API routes |
| `src/client/` | Client components, hooks, and UI protocol helpers |
| `src/core/` | TypeScript domain logic, stores, ACP/MCP, Kanban, workflows, trace, review, and harness logic |
| `apps/desktop/` | Tauri shell and packaging |
| `crates/routa-core/` | Shared Rust runtime foundation |
| `crates/routa-server/` | Axum backend used by desktop and local server mode |
| `crates/routa-cli/` | CLI commands and ACP-serving entrypoints |
| `docs/` | Canonical public docs, design docs, ADRs, release docs, and repository guidance |

## Canonical Docs

Use these files first when orienting yourself:

- [Architecture](/ARCHITECTURE): runtime topology and invariants
- [ADR Index](/adr): durable architectural decisions
- [Code Style](/coding-style): coding and testing conventions
- [Product Specs](/product-specs/FEATURE_TREE): generated route and endpoint inventory
- [Design Docs](/design-docs): normalized design intent and reviewed product decisions

## Reading Order

1. Read [Architecture](/ARCHITECTURE).
2. Read [ADR Index](/adr).
3. Read [Testing](/developer-guide/testing) to understand the validation model.
4. Read [Design Docs](/design-docs) when you need deeper intent, tradeoffs, or migration context.
