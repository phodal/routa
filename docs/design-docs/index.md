# Design Docs Index

This directory is the canonical home for durable design intent in Routa.js.

Use these documents for:
- architectural intent that should outlive a single PR
- invariants that implementation work must preserve
- migration status from earlier design material in `.kiro/specs/`
- links to current plans when a design is actively being executed

## Current Canonical Docs

| Document | Purpose | Status |
|---|---|---|
| `core-beliefs.md` | Agent-first operating principles for how the repository should store knowledge | active |
| `golden-rules.md` | Repository-level rules for documentation, architecture, and maintainability | active |
| `workspace-centric-redesign.md` | Canonical summary of the workspace-first architecture, shipped surface, and remaining transition debt | active |

## Imported Or Indexed Legacy Specs

The repository still contains historical design material under `.kiro/specs/`. Those files are useful, but they are not yet normalized into the `docs/` information architecture.

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

## Migration Rules

- Migrate only reviewed, still-relevant knowledge from `.kiro/specs/`.
- Do not copy large historical specs verbatim into `docs/` unless they are being actively normalized.
- When a legacy spec becomes canonical, create a focused document here and link back to the source in a short provenance note.
- Prefer one canonical document plus pointers over parallel copies with drift.

## Related Docs

- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [Architecture Decision Records](../adr/README.md)
- [FEATURE_TREE.md](../product-specs/FEATURE_TREE.md)
- [core-beliefs.md](./core-beliefs.md)
- [golden-rules.md](./golden-rules.md)
- [workspace-centric-redesign.md](./workspace-centric-redesign.md)
