<div align="center">

<img src="public/logo-animated.svg" alt="Routa - Multi-Agent Orchestration" width="360" />

# Routa

**Multi-Agent Coordination Platform for AI Development**

[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15.1-black.svg)](https://nextjs.org/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

[Features](#features) • [Quick Start](#quick-start) • [Architecture](#architecture) • [Contributing](#contributing)

</div>

---

> **📦 Distribution Notice**
> This project primarily provides a **Tauri desktop application** (binary distribution).
> The web version is available **only for demo purposes** and is not the main deployment target.

## Overview

**Routa** orchestrates AI agents to collaborate on complex development tasks through specialized roles and real-time coordination. It parses natural language into structured intent (Spec with Tasks), then shares this unified intent across all downstream agents, ensuring context consistency throughout the workflow.

**Multi-Protocol Architecture:**
- **MCP (Model Context Protocol)** — Coordination tools for agent collaboration (task delegation, messaging, notes)
- **ACP (Agent Client Protocol)** — Spawns and manages agent processes (Claude Code, OpenCode, Codex, Gemini)
- **A2A (Agent-to-Agent Protocol)** — Exposes external federation interface for cross-platform agent communication

Instead of a single AI handling everything, Routa enables multiple agents to work together—one plans, another implements, and a third verifies—creating a more robust and scalable development workflow.

## 📋 Kanban Task Management

![Routa Kanban Overview](https://github.com/user-attachments/assets/8fdf7934-f8ba-469f-a8b8-70e215637a45)

Routa's **Kanban board** is the central hub for multi-agent coordination:

- **📊 Visual Workflow**: Drag-and-drop task cards across columns (Backlog → Todo → Dev → Review → Done)
- **🤖 Agent Automation**: Assign specialized agents to each column for automatic task processing
- **🔄 Real-time Sync**: Live updates as agents move tasks, add comments, and complete work
- **💬 Natural Language Planning**: Describe your goals in plain text, let Routa create and organize tasks
- **🎯 Session Management**: Track agent interactions, view execution history, and monitor progress

The Kanban interface provides full visibility into what each agent is working on, task dependencies, and overall project status—making multi-agent collaboration transparent and manageable.

### What It Does

- **Breaks down complex work** into manageable tasks across specialized agents
- **Coordinates execution** through task delegation, messaging, and event streaming
- **Verifies quality** with dedicated review agents before completion
- **Connects multiple AI platforms** (Claude Code, OpenCode, Codex, Gemini) through unified protocols
- **Provides real-time visibility** into agent activities, task progress, and collaboration

### Key Capabilities

| Icon | Role                      | Description                                                                             |
|------|---------------------------|-----------------------------------------------------------------------------------------|
| 🔵   | **Routa (Coordinator)**   | Plans work, parses intent into structured Spec, creates tasks, delegates to specialists |
| 🟠   | **CRAFTER (Implementor)** | Executes implementation tasks, writes code, makes minimal focused changes               |
| 🟢   | **GATE (Verifier)**       | Reviews work, validates against acceptance criteria, approves or requests fixes         |
| 🎯   | **DEVELOPER (Solo)**      | Plans and implements independently without delegation (single-agent mode)               |
| 🛠️   | **Custom Specialists**    | User-defined specialist roles with custom system prompts, model tiers, and behaviors    |

- **🔄 Task Orchestration**: Create tasks, delegate to agents, track dependencies, parallel execution
- **💬 Inter-Agent Communication**: Message passing, conversation history, completion reports
- **📡 Multi-Protocol Support**: MCP, ACP, A2A for connecting diverse AI clients
- **🎯 Skills System**: OpenCode-compatible skill discovery and dynamic loading
- **🔌 ACP Registry**: Discover and install pre-configured agents from the community registry (supports npx, uvx, and binary distributions)
- **🔧 Custom MCP Servers**: Register and manage user-defined MCP servers (stdio/http/sse) alongside the built-in coordination server
- **🧑‍💻 Custom Specialists**: Define custom agent roles via Web UI, REST API, or Markdown files with YAML frontmatter
- **🐙 GitHub Virtual Workspace**: Import GitHub repos as virtual workspaces for browsing and code review without local clones
- **📊 Real-Time UI**: Live agent status, task progress, streaming chat interface

👉 For detailed protocol specs and API reference, see [AGENTS.md](AGENTS.md)

## 🚀 Quick Start

### Desktop Application (Recommended)

```bash
# Install dependencies
npm install --legacy-peer-deps

# Run Tauri desktop app
npm run tauri dev
```

### Web Demo (For Testing Only)

```bash
# Install dependencies
npm install --legacy-peer-deps

# Start development server
npm run dev
```

Visit `http://localhost:3000` to access the web interface.

### Docker Deployment

```bash
# Build and start with SQLite (no external database required)
docker compose up --build
```

To use PostgreSQL instead, create a `.env` file in the project root:

```dotenv
# .env
ROUTA_DB_DRIVER=postgres
DATABASE_URL=postgresql://routa:routa_secret@postgres:5432/routa
POSTGRES_PASSWORD=routa_secret
```

Then start with the `postgres` profile (starts a bundled Postgres container):

```bash
docker compose --profile postgres up --build
```

The service is available at `http://localhost:3000`.
Health check: `http://localhost:3000/api/health`

## 🔧 Custom MCP Servers

Register user-defined MCP servers (`stdio`/`http`/`sse`) alongside the built-in coordination server. Managed via Web UI (Settings panel) or REST API. When an ACP agent spawns, enabled custom servers are automatically merged into its MCP configuration.

Supported providers: Claude, OpenCode, Codex, Gemini, Kimi, Augment, Copilot.

## 🧑‍💻 Custom Specialists

Define custom specialist roles beyond the built-in four, with their own system prompts, model tiers, and behaviors. Managed via Web UI (Specialist Manager), REST API, or Markdown files with YAML frontmatter placed in `~/.routa/specialists/`.

Loading priority: Database > User files (`~/.routa/specialists/`) > Bundled (`resources/specialists/`) > Hardcoded fallback.

## 🐙 GitHub Virtual Workspace

Import GitHub repos as virtual workspaces for browsing and code review — no local `git clone` required. Supports file tree browsing, content reading, and search. Works on serverless (Vercel) via zipball download with TTL-based cache cleanup.

## ⌨️ CLI (Rust)

The desktop distribution includes a `routa` CLI built on the same `routa-core` logic as the Rust server:

```bash
routa -p "Implement feature X"    # Full coordinator flow
routa agent list|create|status    # Agent management
routa task list|create|get        # Task management
routa chat                        # Interactive chat
```

## 🏗 Architecture

```mermaid
flowchart TB
    subgraph clients["🖥️ AI Clients"]
        claude["Claude Code"]
        opencode["OpenCode/Codex"]
        gemini["Gemini CLI"]
        a2a_ext["External Agents"]
    end

    subgraph browser["🌐 Web Interface"]
        chat["Chat Panel"]
        agents["Agent Panel"]
        skills["Skill Panel"]
    end

    subgraph server["⚙️ Routa Server"]
        mcp["MCP Server<br/>/api/mcp"]
        acp["ACP Agent<br/>/api/acp"]
        a2a["A2A Bridge<br/>/api/a2a"]
        rest["REST APIs"]

        subgraph core["Core Engine"]
            tools["Coordination Tools"]
            orchestrator["Orchestrator"]
            system["Stores & EventBus"]
            skill_reg["Skill Registry"]
        end
    end

    claude -.->|"SSE + JSON-RPC"| mcp
    opencode -.->|"stdio + JSON-RPC"| acp
    gemini -.->|"stdio + JSON-RPC"| acp
    a2a_ext -.->|"HTTP + JSON-RPC"| a2a

    chat -->|"WebSocket"| acp
    agents -->|"REST"| rest
    skills -->|"REST"| rest

    mcp --> tools
    acp --> tools
    acp --> skill_reg
    a2a --> tools
    rest --> system

    tools --> orchestrator
    orchestrator --> system
    skill_reg --> system

    classDef clientStyle fill:#e1f5ff,stroke:#0288d1,stroke-width:2px
    classDef browserStyle fill:#fff3e0,stroke:#f57c00,stroke-width:2px
    classDef serverStyle fill:#f3e5f5,stroke:#7b1fa2,stroke-width:2px
    classDef coreStyle fill:#e8f5e9,stroke:#388e3c,stroke-width:2px

    class claude,opencode,gemini,a2a_ext clientStyle
    class chat,agents,skills browserStyle
    class mcp,acp,a2a,rest serverStyle
    class tools,orchestrator,system,skill_reg coreStyle
```

## 🎯 Harness Engineering in Practice

Routa.js is a practical case study of the three principles from the
[Harness Engineering](https://www.phodal.com/blog/harness-engineering/) article:
build software systems that are readable for AI, constrained by engineering
guardrails, and improved through fast automated feedback.

### 🔍 System Readability (系统可读性)

Routa makes project structure and operating rules explicit so agents can work
with less hidden context:

- **Explicit knowledge architecture**: [AGENTS.md](AGENTS.md) defines coding
  standards, testing strategy, Git discipline, and PR requirements, while
  [docs/product-specs/FEATURE_TREE.md](docs/product-specs/FEATURE_TREE.md)
  captures product capabilities.
- **Machine-friendly interfaces**: the platform exposes MCP, ACP, A2A, REST,
  and CLI entry points so agent workflows do not depend on manual UI steps.
- **Progressive context disclosure**: bundled specialist definitions in
  [`resources/specialists/`](resources/specialists/) and the fitness rulebook in
  [docs/fitness/README.md](docs/fitness/README.md) reveal role boundaries,
  quality gates, and task-specific context only where needed.

### 🛡️ Defense Mechanisms (防御机制)

Routa treats engineering constraints as hard boundaries that keep AI-generated
changes inside a safe operating envelope:

- **Automated enforcement before code lands**: `.husky/pre-commit` runs a fast
  lint pass, and `.husky/pre-push` delegates to
  [`scripts/smart-check.sh`](scripts/smart-check.sh) for structured validation.
- **Fitness functions as physical laws**:
  [docs/fitness/README.md](docs/fitness/README.md) defines hard gates such as
  `npm run test:run`, `cargo test --workspace`, `npm run api:check`, and
  `npm run lint`.
- **Clear boundaries for agents**: `AGENTS.md` and specialist configs define
  what agents should do, what they must not do, and how they report verifiable
  evidence.

### 🔄 Automated Feedback Loops (自动化反馈回路)

Routa closes the loop by collecting feedback from issue intake, review
automation, and recurring maintenance workflows:

- **Issue enrichment**:
  [`.github/workflows/issue-enricher.yml`](.github/workflows/issue-enricher.yml)
  prepares structured context and solution direction for new work.
- **Review handoff automation**:
  [`.github/workflows/copilot-complete.yml`](.github/workflows/copilot-complete.yml)
  promotes completed work into review-ready state and triggers downstream
  verification.
- **Continuous backlog hygiene**:
  [`.github/workflows/issue-garbage-collector.yml`](.github/workflows/issue-garbage-collector.yml)
  keeps issue context fresh through scheduled cleanup.
- **Unified evidence collection**: Git hooks, fitness reports, workflow logs,
  and task artifacts all produce feedback that can be fed back into the next
  agent iteration.

## 📄 License

- Built with [Model Context Protocol](https://modelcontextprotocol.io/) by Anthropic
- Uses [Agent Client Protocol](https://github.com/agentclientprotocol/typescript-sdk) for agent communication
- Uses [A2A Protocol](https://a2aprotocol.ai/) for agent federation
- Inspired by the [Intent](https://www.augmentcode.com/product/intent) - multi-agent coordination patterns in modern AI
  systems

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**[⬆ back to top](#routa-js)**

Made with ❤️ by the Routa community

</div>
