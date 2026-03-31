# Architecture Decision Records

Lightweight records of decisions that shape Routa.js boundaries, protocols, and evolution.

## Discovery

```bash
claude -p "What ADRs exist in docs/adr/ and what do they decide?"
claude -p "Which ADR governs how agent providers are integrated?"
claude -p "Read ADR 0004 and explain the kanban automation boundary"
```

## Current ADRs

| ADR | Decision | Derived From |
|---|---|---|
| [0001](./0001-dual-backend-semantic-parity.md) | Web and desktop share domain semantics via api-contract.yaml | code structure |
| [0002](./0002-provider-normalization-via-acp.md) | All agent runtimes normalized to ACP through adapter layers | [issue #33](../issues/2026-02-28-gh-33-model-based-acp-provider.md) |
| [0003](./0003-workspace-first-scope.md) | Workspaces are the top-level coordination boundary | [design-doc](../design-docs/workspace-centric-redesign.md) |
| [0004](./0004-kanban-driven-automation.md) | Kanban lanes trigger ACP sessions with queued concurrency | [issue #96](../issues/2026-03-08-gh-96-feat-kanban-implement-generic-local-first-kanban-data-model.md), [issue #148](../issues/2026-03-14-gh-148-feat-add-session-queueing-and-concurrency-limits-for-kanban-acp-automati.md) |
| [0005](./0005-specialist-externalization.md) | Specialists as Markdown+YAML with priority loading | [issue #1](../issues/2026-02-16-gh-1-feat-specialist-markdown-yaml-frontmatter-specialist.md) |
| [0006](./0006-orchestration-shell-pattern.md) | Complex files use thin shell + domain hooks structure | coding standards |

## Rules

- ADRs record decisions that affect structure, boundaries, or long-term evolution.
- Do not create ADRs for trivial implementation details or bug fixes.
- Status values: `accepted`, `superseded`, `deprecated`.
- When a decision changes, update the existing ADR status and create a new one that references it.
