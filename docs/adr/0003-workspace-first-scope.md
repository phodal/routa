# ADR 0003: Workspace-First Scope

- Status: accepted
- Date: 2026-02-25
- Derived from: [design-doc](../design-docs/workspace-centric-redesign.md), [issue #20](https://github.com/phodal/routa/issues/20)

## Context

Early versions used implicit global scope for sessions, tasks, and boards. As the product grew, this caused:
- sessions from different projects mixing in the same list
- no clear boundary for which agent config or specialist applies where
- ambiguous MCP tool scope (which repo does "git status" refer to?)

## Decision

Workspaces are the top-level coordination boundary. All domain entities are workspace-scoped:

- Sessions, tasks, notes, kanban boards, codebases, worktrees, memories, and schedules belong to a workspace.
- API routes require explicit workspace context (path param or query) unless they are deliberate bootstrap flows.
- MCP tools resolve workspace context before executing.
- UI navigation is workspace-first: users select a workspace, then drill into its resources.

The `"default"` workspace exists as transition scaffolding for paths not yet fully migrated. It is not the target domain model.

## Consequences

- New API endpoints must accept workspace scope. Endpoints without explicit scope are considered incomplete.
- Store implementations receive `workspaceId` as a required parameter in CRUD operations.
- Both `RoutaSystem` (TypeScript) and `AppState` (Rust) propagate workspace context through their service layers.
- Kanban automation, background tasks, and scheduled runs inherit workspace scope from their parent board/workflow.

## Code References

- `src/core/routa-system.ts` — workspace-aware store wiring
- `crates/routa-core/src/state.rs` — Rust workspace-aware state
- `docs/design-docs/workspace-centric-redesign.md` — full redesign status
- `src/core/models/workspace.ts` — workspace model
