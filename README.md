<div align="center">

<img src="public/logo-animated.svg" alt="Routa" width="360" />

# Routa

**Workspace-first multi-agent coordination platform for software delivery**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.2-black.svg)](https://nextjs.org/)
[![Rust](https://img.shields.io/badge/Rust-Axum-orange.svg)](https://github.com/tokio-rs/axum)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Join Slack](https://img.shields.io/badge/Slack-Join%20Community-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/routa-group/shared_invite/zt-3txzzfxm8-tnRFwNpPvdfjAVoSD6MTJg)
[![npm version](https://img.shields.io/npm/v/routa-cli)](https://www.npmjs.com/package/routa-cli)
[![crates.io](https://img.shields.io/crates/v/routa-cli)](https://crates.io/crates/routa-cli)

[Overview](#overview) • [Architecture](#architecture) • [How It Works](#how-it-works) • [Providers](#providers) • [Features](#features) • [Quick Start](#quick-start) • [Repository Map](#repository-map)

</div>

---

[Releases](https://github.com/phodal/routa/releases) · [Architecture Doc](docs/ARCHITECTURE.md) · [Harness Monitor Architecture](docs/harness/harness-monitor-run-centric-operator-model.md) · [Feature Tree](docs/product-specs/FEATURE_TREE.md) · [Docs Site](https://phodal.github.io/routa/) · [Community (Slack)](https://join.slack.com/t/routa-group/shared_invite/zt-3txzzfxm8-tnRFwNpPvdfjAVoSD6MTJg) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Overview

Routa is a multi-agent coordination platform built around a workspace-scoped Kanban model. It is designed for software delivery workflows where planning, implementation, review, traces, tools, and repo context need to stay visible and durable instead of being hidden inside a single chat thread.

The current implementation has two runtime surfaces that share the same domain semantics and API shape:

- **Web**: Next.js app and API in `src/`
- **Desktop**: Tauri shell in `apps/desktop/` backed by the Axum server in `crates/routa-server/`

This repository is intentionally not "a web demo plus a separate desktop app". Both runtimes preserve the same workspace, task, session, kanban, codebase, memory, and trace model.

## Why Routa

Single-agent workflows break down when the same context has to handle decomposition, coding, review, and reporting. Routa makes those responsibilities explicit.

- Work starts from a **workspace**, not a hidden global repo.
- Execution is driven by **tasks and kanban lanes**, not ad hoc prompts.
- Agent runs are persisted as **sessions, traces, artifacts, and notes**.
- Automation flows through **ACP, MCP, A2A, AG-UI, SSE, and REST** instead of one provider-specific runtime.

In practice, the board is both the planning surface and the coordination bus.

![Routa Kanban Overview](https://github.com/user-attachments/assets/8fdf7934-f8ba-469f-a8b8-70e215637a45)

## Architecture

The architecture has shifted to an ACP-centric view because that is what the codebase implements today: both runtime surfaces converge on the same session lifecycle, provider abstraction, task binding, and event persistence model.

![Routa architecture](docs/architecture.svg)

Read the canonical architecture contract in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The updated diagram reflects the current layering:

- Product surface: workspace, session, kanban, team, settings, traces
- Runtime surfaces: Next.js web runtime and Tauri + Axum desktop runtime
- Core: ACP/session orchestration, provider abstraction, kanban/task binding, EventBus + persistence
- Provider families: ACP-backed CLI/container agents and BYOK SDK/API integrations
- Execution substrates: local CLI runner, SDK/API mode, and Docker-backed execution

For the `harness-monitor` control surface specifically, the current run-centric semantic boundary is documented in [docs/harness/harness-monitor-run-centric-operator-model.md](docs/harness/harness-monitor-run-centric-operator-model.md). That document captures the subsystem-level rule that `Task / Run / Workspace / EvalSnapshot / PolicyDecision / Evidence` stay as the stable domain objects, while operator planes such as `Observe / Attribute / Evaluate / Orchestrate / Constrain / Validate / Evidence` are derived in an application-layer run assessment shared by CLI and TUI.

## How It Works

```text
You: "Build a user auth system with login, registration, and password reset"
                              ↓
              ┌───────────────────────────────┐
              │  Kanban Board (coordination)  │
              └───────────────────────────────┘
                              ↓
   Backlog          Todo          Dev           Review         Done
  ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐
  │Refiner │ →  │Orchestr│ →  │Crafter │ →  │ Guard  │ →  │Reporter│
  │ Agent  │    │ Agent  │    │ Agent  │    │ Agent  │    │ Agent  │
  └────────┘    └────────┘    └────────┘    └────────┘    └────────┘
```

1. You describe a goal in natural language.
2. Routa decomposes the goal into kanban tasks.
3. Lane automation binds tasks to specialist roles and execution context.
4. Providers are launched through ACP or normalized provider adapters.
5. Session events, traces, artifacts, and task state stream back to the UI.

The built-in specialist flow currently centers on:

- **Backlog Refiner**: turns rough ideas into scoped work items
- **Todo Orchestrator**: clarifies implementation intent and execution notes
- **Dev Crafter**: performs the implementation and records evidence
- **Review Guard**: checks behavior and can route work back to development
- **Done Reporter**: summarizes what shipped and what was verified
- **Blocked Resolver**: handles stalled work and routes it back into active flow

## Providers

Routa is provider-agnostic at the orchestration layer. The codebase currently supports two integration families.

### ACP-backed providers

These providers run as CLI or container processes and are managed through ACP runtime APIs, registry logic, warmup/install flows, and streaming session updates.

- Claude Code
- Codex
- Gemini CLI
- Copilot
- OpenCode
- Kimi
- Augment

### BYOK / SDK / API providers

These providers route through the shared provider abstraction rather than the ACP process runtime.

- Claude Code SDK
- OpenCode SDK
- OpenAI API
- Anthropic API
- Gemini API
- Zhipu-backed integrations

### Protocol surfaces

- **REST**: product-facing CRUD and workflow endpoints
- **MCP**: coordination tools and collaborative tool execution
- **ACP**: provider runtime, install, warmup, registry, Docker, session orchestration
- **A2A**: agent-to-agent interoperability
- **AG-UI / A2UI**: UI-facing agent stream and dashboard protocol surfaces
- **SSE**: real-time transport for sessions, notes, kanban events, and protocol streams

## Features

The current implementation is broader than just kanban automation. Major product surfaces in the repository include:

- **Workspace-first navigation** for overview, kanban, sessions, team views, and codebases
- **Session orchestration** with create, prompt, cancel, reconnect, trace, and streaming flows
- **Kanban automation** with per-board queues, decomposition, YAML import/export, and event streaming
- **Codebase and worktree management** for local repositories and workspace-scoped execution context
- **GitHub virtual workspaces** for zipball-based repo import, search, tree browsing, and PR comment workflows
- **MCP tool surfaces** plus user-defined MCP server registration
- **Shared sessions, notes, memory, and artifacts** as durable coordination primitives
- **Schedules, webhooks, background tasks, and workflow runs** for automation beyond one-off prompts
- **Traces, review, and harness analysis** for debugging, governance, and quality feedback loops
- **Desktop local-first runtime** with SQLite, sandboxing, native process execution, and Docker-assisted agent execution

For a generated inventory of routes and endpoints, see [docs/product-specs/FEATURE_TREE.md](docs/product-specs/FEATURE_TREE.md).

## Quick Start

### Prerequisites

- Node.js 20+
- npm
- Rust toolchain for desktop development
- Tauri system prerequisites if you want to run the desktop shell

### Web Runtime

```bash
npm install --legacy-peer-deps
npm run dev
```

Open `http://localhost:3000`.

### Desktop Runtime

```bash
npm install --legacy-peer-deps
npm --prefix apps/desktop install
npm run tauri:dev
```

The Tauri smoke path uses `http://127.0.0.1:3210/` behind the desktop shell.

### Docker

```bash
# SQLite
docker compose up --build

# PostgreSQL profile
docker compose --profile postgres up --build
```

### CLI

```bash
npm install -g routa-cli
```

Examples:

```bash
npx -p routa-cli routa --help
routa -p "Implement feature X"
routa agent list
routa task list
routa chat
```

## Development And Validation

Use [docs/fitness/README.md](docs/fitness/README.md) as the canonical validation rulebook. Typical local flows:

```bash
entrix run --dry-run
entrix run --tier fast
entrix run --tier normal
```

Other frequently used commands:

```bash
npm run test
npm run test:e2e
npm run api:test
npm run lint
```

## Repository Map

| Path | Purpose |
|---|---|
| `src/app/` | Next.js App Router pages and API routes |
| `src/client/` | Client components, hooks, and UI protocol helpers |
| `src/core/` | TypeScript domain logic, stores, ACP/MCP, kanban, workflows, trace, review, harness |
| `apps/desktop/` | Tauri shell and packaging |
| `crates/routa-core/` | Shared Rust runtime foundation |
| `crates/routa-server/` | Axum backend used by desktop/local server mode |
| `crates/routa-cli/` | CLI commands and ACP-serving entrypoints |
| `docs/ARCHITECTURE.md` | Canonical architecture and invariants |
| `docs/harness/harness-monitor-run-centric-operator-model.md` | Harness Monitor run-centric operator semantics |
| `docs/adr/` | Architecture decision records |
| `docs/product-specs/FEATURE_TREE.md` | Generated route and endpoint index |
| `docs/fitness/` | Validation and quality gates |

## Community

- Slack: https://join.slack.com/t/routa-group/shared_invite/zt-3txzzfxm8-tnRFwNpPvdfjAVoSD6MTJg
- Issues: https://github.com/phodal/routa/issues
- Security: [SECURITY.md](SECURITY.md)
- Contributions: [CONTRIBUTING.md](CONTRIBUTING.md)

## Harness Engineering

Routa is also a working example of harness-oriented engineering for agentic software systems:

- **Readable for agents** through explicit repo guidance, role definitions, and protocol surfaces
- **Constrained by guardrails** through fitness functions, API checks, lint, and hook runtime validation
- **Improved by feedback loops** through traces, review, issue hygiene, and execution evidence
- **Run-centric in harness-monitor** through a shared run assessment that maps operator planes onto `Run` instead of letting CLI and TUI derive separate meanings

Related references:

- [AGENTS.md](AGENTS.md)
- [docs/fitness/README.md](docs/fitness/README.md)
- [docs/harness/harness-monitor-run-centric-operator-model.md](docs/harness/harness-monitor-run-centric-operator-model.md)
- [docs/REFACTOR.md](docs/REFACTOR.md)

## License

MIT. See [LICENSE](LICENSE).

Built with [Model Context Protocol](https://modelcontextprotocol.io/) · [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk) · [A2A Protocol](https://a2aprotocol.ai/)

