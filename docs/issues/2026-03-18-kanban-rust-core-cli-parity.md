---
title: "Kanban board/card operations are not first-class in Rust core RPC, which blocks CLI parity and duplicates workflow semantics"
date: "2026-03-18"
status: resolved
resolved_at: "2026-03-18"
severity: medium
area: "kanban"
tags: ["kanban", "rust-core", "cli", "rpc", "architecture", "parity"]
reported_by: "codex"
github_issue: 192
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/192"
related_issues:
  - "docs/issues/2026-03-08-gh-96-feat-kanban-implement-generic-local-first-kanban-data-model.md"
  - "docs/issues/2026-03-14-kanban-story-lane-automation-stalls-after-first-session.md"
---

# Kanban board/card operations are not first-class in Rust core RPC, which blocks CLI parity and duplicates workflow semantics

## What Happened

Routa already has a meaningful Kanban domain model in Rust (`KanbanBoard`, `KanbanColumn`, task `board_id` / `column_id` / `position`) and a much richer Kanban workflow surface in the web stack. However, the Rust JSON-RPC layer still exposes only agents, tasks, notes, workspaces, and skills.

As a result:

- the CLI cannot manage boards and cards as first-class concepts through the same `routa-core` RPC interface it uses for other entities;
- Kanban behavior is split across multiple implementations:
  - Rust core data/store model
  - Rust server HTTP/MCP handlers
  - TypeScript Kanban tools and route handlers
- board/card semantics such as default-board resolution, column validation, task-status mapping, and card shaping are repeated instead of being defined once in a shared core contract.

## Why This Matters

This creates an architectural mismatch with the stated CLI design that the CLI should be a thin adapter over `routa-core`.

The current shape raises several risks:

- CLI users cannot work with Kanban in the same way they work with tasks/workspaces.
- Rust server routes and MCP handlers continue to own business logic that should belong to shared core services or RPC methods.
- Future Kanban changes are more likely to drift between Rust and TypeScript implementations.
- The control-plane direction of Kanban becomes harder to stabilize because the shared backend contract is incomplete.

## Expected Behavior

- Rust core should expose first-class `kanban.*` RPC methods for board and card operations.
- CLI should consume those RPC methods through thin command adapters.
- Shared board/card semantics should live in Rust core rather than being duplicated in server-specific handlers.

## Relevant Files

- `crates/routa-core/src/models/kanban.rs`
- `crates/routa-core/src/models/task.rs`
- `crates/routa-core/src/store/kanban_store.rs`
- `crates/routa-core/src/rpc/router.rs`
- `crates/routa-core/src/rpc/methods/tasks.rs`
- `crates/routa-server/src/api/kanban.rs`
- `crates/routa-server/src/api/mcp_routes.rs`
- `crates/routa-cli/src/main.rs`
- `crates/routa-cli/src/commands/mod.rs`

## Notes

This issue is about shared backend contract and CLI parity, not full Kanban automation. Story-level workflow execution, lane/session lifecycle, and automation reliability remain broader follow-up concerns.

## Resolution

This issue is resolved in the current codebase and the upstream GitHub issue is
closed.

Evidence in current implementation:

- `crates/routa-core/src/rpc/router.rs` now exposes first-class `kanban.*`
  methods including board, card, column, query, decomposition, and handoff
  operations.
- `crates/routa-core/src/rpc/methods/kanban.rs` and its submodules contain the
  shared Rust-side implementation rather than leaving these semantics to
  server-only handlers.
- `crates/routa-cli/src/commands/kanban.rs` consumes those RPC methods through
  thin command adapters, matching the intended CLI architecture.

Broader Kanban automation reliability remains a separate follow-up surface, but
the contract/parity gap described here is no longer open.
