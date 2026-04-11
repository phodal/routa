# Design Docs

Design docs are the canonical home for durable implementation intent in Routa. Use them when
you need to understand why the system is shaped the way it is, which invariants matter, and
which product concepts must survive refactors.

## Start Here

If you only want the highest-signal reading path:

1. Read [Architecture](/ARCHITECTURE) for system boundaries.
2. Read [ADR Index](/adr) for durable decisions and their context.
3. Read [Execution Modes](./execution-modes.md) for `Session`, `Kanban`, and `Team`.
4. Read [Workspace-Centric Redesign](./workspace-centric-redesign.md) for the current product shape and transition debt.

## Canonical Docs

### Product Meaning

| Document | Why read it |
|---|---|
| [execution-modes.md](./execution-modes.md) | Defines the product meaning of Sessions, Kanban, and Team |
| [workspace-centric-redesign.md](./workspace-centric-redesign.md) | Summarizes the workspace-first redesign, shipped surface, and remaining transition debt |
| [core-beliefs.md](./core-beliefs.md) | Captures the agent-first principles behind repository and product decisions |

### Repository And Governance

| Document | Why read it |
|---|---|
| [golden-rules.md](./golden-rules.md) | Repository-level rules for architecture, documentation, and maintainability |
| [architecture-rule-dsl.md](./architecture-rule-dsl.md) | Defines the cross-language architecture rule model for validation and fitness tooling |

### Focused Design Work

| Document | Why read it |
|---|---|
| [agentwatch-tui.md](./agentwatch-tui.md) | TUI-first runtime model, information architecture, and keybindings for Routa Watch |
| [harness-trace-learning-phase2.md](./harness-trace-learning-phase2.md) | Next-step design for trace learning and playbook-driven guidance |

## Legacy Specs And Migration Status

The repository still contains historical design material under `.kiro/specs/`. Those files are
useful context, but they are not automatically canonical. This section exists so the public
design-docs area stays curated instead of turning into a raw archive.

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
