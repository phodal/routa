<div align="center">

<img src="public/logo-animated.svg" alt="Routa" width="360" />

# Routa

**Your AI Agent Team, Managed by Kanban**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-16.1-black.svg)](https://nextjs.org/)
[![Rust](https://img.shields.io/badge/Rust-Axum-orange.svg)](https://github.com/tokio-rs/axum)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Join Slack](https://img.shields.io/badge/Slack-Join%20Community-4A154B?logo=slack&logoColor=white)](https://join.slack.com/t/routa-group/shared_invite/zt-3txzzfxm8-tnRFwNpPvdfjAVoSD6MTJg)

[![npm version](https://img.shields.io/npm/v/routa-cli)](https://www.npmjs.com/package/routa-cli)
[![crates.io](https://img.shields.io/crates/v/routa-cli)](https://crates.io/crates/routa-cli)

[Why Routa](#why-routa) • [Architecture](#architecture) • [How It Works](#how-it-works) • [Agent Team](#the-agent-team) • [Bring Your Own Agents](#bring-your-own-agents) • [Community](#community) • [Quick Start](#quick-start)

</div>

---

> **📦 Distribution Notice**
> This project primarily provides a **Tauri desktop application** (binary distribution).
> The web version is available for demo purposes only.

[Releases](https://github.com/phodal/routa/releases) · [Docs](https://phodal.github.io/routa/) · [Community (Slack)](https://join.slack.com/t/routa-group/shared_invite/zt-3txzzfxm8-tnRFwNpPvdfjAVoSD6MTJg) · [Demo (Bilibili)](https://www.bilibili.com/video/BV16CwyzUED5/) · [Demo (YouTube)](https://www.youtube.com/watch?v=spjmr_1AQLM) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

## Why Routa

One agent doing everything sounds great until it doesn't. A single agent context-switches between planning, coding, reviewing, and reporting — the same way a solo developer burns out juggling every role on a project.

Real teams don't work that way. They specialize, hand off, and keep work visible on a board.

Routa applies the same idea to AI agents. A Kanban board becomes the coordination layer: you describe what you want, Routa decomposes it into cards, and specialized agents pick up work as it flows through columns — Backlog → Todo → Dev → Review → Done. Each agent knows its role and passes work forward when ready.

The board is both the project manager and the communication bus.

![Routa Kanban Overview](https://github.com/user-attachments/assets/8fdf7934-f8ba-469f-a8b8-70e215637a45)

## Architecture

Routa runs on two runtime surfaces that share the same domain model:

- **Web**: Next.js app and API (`src/`)
- **Desktop**: Tauri + Axum (`apps/desktop/` + `crates/routa-server/`)

Both runtimes feed the same workspace-scoped coordination model — sessions, kanban automation, tasks, tools, and traces. The desktop backend is a full local coordination runtime, not a thin transport shim.

![Routa architecture](docs/architecture.svg)

At the center is the ACP orchestration layer. Provider families are normalized through shared adapters and registry logic, so different agent CLIs and Docker providers converge on the same session lifecycle and streaming model. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full contract.

## How It Works

```
You: "Build a user auth system with login, registration, and password reset"
                              ↓
              ┌───────────────────────────────┐
              │  📋 Kanban Board (the brain)   │
              └───────────────────────────────┘
                              ↓
   Backlog          Todo          Dev           Review         Done
  ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐    ┌────────┐
  │Refiner │ →  │Orchestr│ →  │Crafter │ →  │ Guard  │ →  │Reporter│
  │  Agent │    │  Agent │    │  Agent │    │  Agent │    │  Agent │
  └────────┘    └────────┘    └────────┘    └────────┘    └────────┘
```

1. **You speak, Kanban listens** — Describe your goal in natural language. Routa decomposes it into cards on the board.
2. **Each column has a specialist** — Agents are bound to columns. When a card lands in their column, they pick it up automatically.
3. **Work flows forward** — Each agent completes its stage and moves the card to the next column. No manual handoff needed.
4. **Review before done** — The Review Guard agent checks implementation quality and can bounce cards back to Dev if needed.
5. **Full visibility** — Watch agents work in real-time. Every card shows who's working on it, what changed, and why.

## The Agent Team

Routa ships with a set of built-in specialists, each designed for a specific stage of the development workflow:

| Agent | Column | What It Does |
|-------|--------|-------------|
| **Backlog Refiner** | Backlog | Turns rough ideas into implementation-ready stories with clear scope and acceptance criteria |
| **Todo Orchestrator** | Todo | Removes ambiguity, adds execution notes, confirms the card is ready for coding |
| **Dev Crafter** | Dev | Implements the feature, runs tests, records evidence of what changed |
| **Review Guard** | Review | Inspects implementation against acceptance criteria, approves or bounces back to Dev |
| **Done Reporter** | Done | Writes a completion summary — what shipped and what was verified |
| **Blocked Resolver** | Blocked | Triages stuck cards, clarifies blockers, routes them back into the active flow |

Above the board sits the **Coordinator (Routa)** — it plans work, writes specs, delegates to specialists, and orchestrates multi-wave execution. It never writes code itself.

You can also define **Custom Specialists** with their own system prompts, model tiers, and behaviors — via the Web UI, REST API, or Markdown files in `~/.routa/specialists/`.

## Bring Your Own Agents

Routa doesn't lock you into one AI provider. Pick the backend agent that fits each task:

### ACP Providers (Agent Client Protocol)

Routa spawns and manages agent processes through ACP. Supported out of the box:

| Provider | Type | Status |
|----------|------|--------|
| **Claude Code** | CLI | ✅ Supported |
| **OpenCode** | CLI / Docker | ✅ Supported |
| **Codex** | CLI | ✅ Supported |
| **Gemini CLI** | CLI | ✅ Supported |
| **Kimi** | CLI | ✅ Supported |
| **Augment** | CLI | ✅ Supported |
| **Copilot** | CLI | ✅ Supported |

### ACP Agent Registry

Discover and install community-contributed agents from the ACP Registry — supports `npx`, `uvx`, and binary distributions. Browse the registry from Settings → Install Agents, or use the API.

### Multi-Protocol Support

| Protocol | Purpose |
|----------|---------|
| **MCP** (Model Context Protocol) | Coordination tools — task delegation, messaging, notes |
| **ACP** (Agent Client Protocol) | Spawns and manages agent processes |
| **A2A** (Agent-to-Agent Protocol) | Federation interface for cross-platform agent communication |
| **AG-UI** | Agent-generated UI protocol for rich dashboard rendering |

## More Features

- **🔧 Custom MCP Servers** — Register user-defined MCP servers (stdio/http/sse) alongside the built-in coordination server. When an ACP agent spawns, enabled custom servers are automatically merged into its MCP configuration.
- **🐙 GitHub Virtual Workspace** — Import GitHub repos as virtual workspaces for browsing and code review — no local `git clone` required. Works on serverless (Vercel) via zipball download.
- **📡 Scheduled Triggers** — Cron-based agent triggers for recurring tasks.
- **🔗 GitHub Webhooks** — Trigger agent workflows from GitHub events (push, PR, issues).
- **🧠 Memory** — Workspace-scoped memory entries that persist context across sessions.
- **📊 Traces** — Browse agent execution traces, view stats, debug agent behavior.
- **🎯 Skills System** — OpenCode-compatible skill discovery and dynamic loading from a community catalog.
- **🔁 Trace Learning** — Harness Evolution automatically learns from execution history, detects patterns, and generates evidence-backed playbooks for faster future runs. [Feature overview →](docs/features/harness-trace-learning.md) | [User guide →](docs/guides/harness-trace-learning-guide.md) | [Technical reference →](docs/references/harness-trace-learning-technical.md)

## 🚀 Quick Start

### Desktop Application (Recommended)

```bash
npm install --legacy-peer-deps
npm --prefix apps/desktop install
npm run tauri:dev
```

### Web Demo (For Testing Only)

```bash
npm install --legacy-peer-deps
npm run dev
```

Visit `http://localhost:3000` to access the web interface.

### Docker

```bash
# SQLite (default, no external database required)
docker compose up --build

# PostgreSQL
docker compose --profile postgres up --build
```

### CLI (Rust)

Install the CLI directly from NPM for terminal-first workflows:

```bash
npm install -g routa-cli
```

The desktop distribution also includes a `routa` CLI:

```bash
npx -p routa-cli routa --help     # one-off usage
routa -p "Implement feature X"    # Full coordinator flow
routa agent list|create|status    # Agent management
routa task list|create|get        # Task management
routa chat                        # Interactive chat
```

## Community

- Join the Slack community: https://join.slack.com/t/routa-group/shared_invite/zt-3txzzfxm8-tnRFwNpPvdfjAVoSD6MTJg
- Bug reports and feature requests: https://github.com/phodal/routa/issues
- Security reports: [SECURITY.md](SECURITY.md)
- Contribution guide: [CONTRIBUTING.md](CONTRIBUTING.md)

## Harness Engineering

Routa is a practical case study of [Harness Engineering](https://www.phodal.com/blog/harness-engineering/) — building systems that are readable for AI, constrained by guardrails, and improved through fast automated feedback.

- **Readability** — [AGENTS.md](AGENTS.md) defines standards. Specialist definitions in [`resources/specialists/`](resources/specialists/) reveal role boundaries. Machine-friendly interfaces (MCP, ACP, A2A, REST, CLI) mean agent workflows don't depend on manual UI steps.
- **Defense** — Pre-commit lint and pre-push `tools/hook-runtime` checks plus fitness functions ([docs/fitness/](docs/fitness/)) define hard gates: tests, API contract checks, and lint.
- **Feedback Loops** — Issue enrichment, review handoff automation, and backlog hygiene workflows close the loop between agent output and the next iteration.

## License

MIT — see [LICENSE](LICENSE).

Built with [Model Context Protocol](https://modelcontextprotocol.io/) · [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk) · [A2A Protocol](https://a2aprotocol.ai/) · Inspired by [Intent](https://www.augmentcode.com/product/intent)

---

<div align="center">

**[⬆ back to top](#routa)**

Made with ❤️ by the Routa community

</div>
