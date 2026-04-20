---
title: Design Docs
hide_table_of_contents: true
---

# Design Docs

Design docs explain why Routa is shaped the way it is. Read this section when product behavior,
system boundaries, or long-lived invariants matter more than install steps.

If you are still trying to get Routa running, go back to [Quick Start](/quick-start),
[Platforms](/platforms), or [Use Routa](/use-routa).

## Choose A Reading Path

<div className="routa-doc-map">
  <a href="/routa/ARCHITECTURE">
    <strong>Architecture</strong>
    Start here when you need system boundaries, runtime topology, and the web/desktop parity
    model.
  </a>
  <a href="/routa/adr">
    <strong>Architecture Decisions</strong>
    Read the ADR index when you need the durable decisions behind providers, workspaces,
    Kanban automation, and specialist loading.
  </a>
  <a href="/routa/design-docs/execution-modes">
    <strong>Execution Modes</strong>
    Understand the product meaning of `Session`, `Kanban`, and `Team` before changing workflow
    behavior.
  </a>
  <a href="/routa/design-docs/workspace-centric-redesign">
    <strong>Workspace-Centric Redesign</strong>
    Use this to understand the current product shape, shipped changes, and remaining transition
    debt.
  </a>
  <a href="/routa/design-docs/core-beliefs">
    <strong>Core Beliefs</strong>
    Read the product and repository principles that should survive refactors and UI changes.
  </a>
</div>

## What You Get From This Section

<div className="routa-start-grid">
  <div className="routa-start-card">
    <span className="routa-start-card__badge">Boundaries</span>
    <h3>System Shape</h3>
    <p>Learn which responsibilities belong to the web app, desktop runtime, server, and ACP layer.</p>
  </div>
  <div className="routa-start-card">
    <span className="routa-start-card__badge">Product Model</span>
    <h3>Core Concepts That Matter</h3>
    <p>Understand workspaces, repositories, providers, Sessions, Kanban, and Team as durable product objects.</p>
  </div>
  <div className="routa-start-card">
    <span className="routa-start-card__badge">Decision History</span>
    <h3>Why It Works This Way</h3>
    <p>Use ADRs and redesign notes when a change would otherwise fight an intentional system decision.</p>
  </div>
</div>

## Focused Design Material

Use these when you already know the main product model and need a narrower topic:

- [agentwatch-tui.md](./agentwatch-tui.md): TUI-first runtime model, information architecture, and keybindings for Harness Monitor
- [harness-trace-learning-phase2.md](./harness-trace-learning-phase2.md): trace learning and playbook-driven guidance

## Legacy Specs And Migration Status

Historical design material still exists under `.kiro/specs/`, but it is not automatically
canonical. Keep using this page as the curated entry point instead of treating the raw archive as
the source of truth.

<details>
<summary>Legacy Specs Inventory</summary>

| Legacy Spec | Scope | Current Handling |
|---|---|---|
| `.kiro/specs/docker-agent-execution/design.md` | Docker-backed ACP agent execution architecture | indexed only |
| `.kiro/specs/docker-agent-execution/requirements.md` | Docker agent execution requirements | indexed only |
| `.kiro/specs/docker-agent-execution/tasks.md` | Docker agent execution task breakdown | indexed only |
| `.kiro/specs/kanban-workspace-repository/requirements.md` | Workspace repository requirements for Kanban | indexed only |
| `.kiro/specs/playwright-page-snapshots/requirements.md` | Page snapshot requirements | indexed only |
| `.kiro/specs/workspace-centric-redesign/design.md` | Workspace-first redesign architecture | indexed only |
| `.kiro/specs/workspace-centric-redesign/requirements.md` | Workspace-first redesign requirements | indexed only |
| `.kiro/specs/workspace-centric-redesign/tasks.md` | Workspace-first redesign task breakdown | indexed only |

</details>

## Curation Rules

- Migrate only reviewed, still-relevant knowledge from `.kiro/specs/`.
- Do not copy large historical specs verbatim into `docs/` unless they are being actively normalized.
- When a legacy spec becomes canonical, create a focused document here and link back to the source in a short provenance note.
- Prefer one canonical document plus pointers over parallel copies with drift.

## Related Docs

- [Architecture](/ARCHITECTURE)
- [Architecture Decision Records](/adr)
- [Product Specs](/product-specs/FEATURE_TREE)
- [Developer Guide](/developer-guide)
