---
title: Workspace-Centric Redesign
---

# Workspace-Centric Redesign

## Status

Canonical design document. This replaces the older `.kiro/specs/workspace-centric-redesign/*` files as the primary summary of the workspace-first architecture.

The redesign is partially shipped. Workspace-first routing, codebase modeling, and workspace-scoped session views are real. Some APIs and backend flows still carry transitional `default` workspace assumptions.

## Why This Exists

Routa originally treated `workspace` as a mostly hidden container around a single default context. The redesign promoted workspace to the top-level coordination unit so sessions, notes, tasks, codebases, and UI navigation all have an explicit project scope.

This unlocks:
- multiple workspaces with explicit switching
- multiple codebases per workspace
- workspace-scoped session and Kanban views
- consistent scope across web and desktop surfaces

## Canonical Decisions

### Workspace Is The Primary User Context

Users navigate by workspace first, then by sessions, notes, tasks, or boards within that workspace.

### Codebases Are First-Class Records

Repository path and branch are modeled as separate codebase records instead of being embedded on the workspace itself.

### Sessions Must Carry Workspace Scope

Session history, trace views, and workspace detail pages assume sessions belong to a workspace and are filtered by that scope.

### Web And Desktop Must Preserve The Same Semantics

The Rust desktop backend and the Next.js backend can differ in implementation, but workspace and codebase API semantics should stay aligned.

## Current Implementation Baseline

### Implemented

- Workspace pages and navigation exist on `/workspace/[workspaceId]` and related routes.
- Workspace switching UI exists via `WorkspaceSwitcher`.
- Codebase CRUD APIs exist under workspace-scoped routes and top-level codebase mutation routes.
- The main schema includes `codebases`, `workspace_skills`, workspace-scoped `acp_sessions`, and workspace-scoped worktrees.
- Client hooks fetch workspaces and codebases through workspace-scoped APIs.
- Tauri static export routing supports placeholder workspace routes and resolves them client-side.

Representative files:
- `src/app/workspace/[workspaceId]/workspace-page-client.tsx`
- `src/client/components/workspace-switcher.tsx`
- `src/client/hooks/use-workspaces.ts`
- `src/app/api/workspaces/[workspaceId]/route.ts`
- `src/app/api/workspaces/[workspaceId]/codebases/route.ts`
- `src/core/db/schema.ts`

### Transitional Or Incomplete Areas

- Some APIs still fall back to `"default"` when `workspaceId` is absent, especially task and background-task endpoints.
- Some runtime and desktop boot flows still ensure or assume a default workspace exists.
- Session restart and MCP server paths still contain `"default"` fallback behavior.
- The design goal of fully removing hard-coded default workspace behavior is not complete.
- `workspace_skills` exists in schema, but the repository still needs a clear canonical doc for what is fully implemented versus transitional in skill scoping.

Representative files with residual transition logic:
- `src/app/api/tasks/route.ts`
- `src/app/api/background-tasks/route.ts`
- `src/app/api/acp/route.ts`
- `crates/routa-server/src/lib.rs`
- `crates/routa-cli/src/commands/prompt.rs`

## Invariants To Preserve

1. Every user-visible workspace resource must have an explicit workspace scope.
2. Codebases belong to one workspace and should be addressed through that relationship.
3. Session and Kanban surfaces should reflect the currently selected workspace, not a global mixed list.
4. Desktop route placeholders are an implementation detail, not a domain concept.
5. New APIs should require explicit workspace scope unless there is a deliberate bootstrap exception.

## Migration Notes From Legacy Specs

The older `.kiro/specs/workspace-centric-redesign/` set mixed three different concerns:
- product requirements
- implementation sequencing
- target architecture

This canonical doc keeps only the durable architecture and transition status. Detailed sequencing should live under `docs/exec-plans/`, and historical spec text remains in `.kiro/specs/` as provenance until individually retired.

## Next Cleanup Targets

1. Remove remaining `"default"` fallbacks from task and background-task APIs.
2. Narrow bootstrap-only default workspace logic so it does not leak into steady-state runtime behavior.
3. Document the actual skill-scoping state and close the gap between schema intent and product semantics.
4. Add verification coverage for workspace-required APIs and transition-free routing behavior.

## Provenance

Source material normalized into this document:
- `.kiro/specs/workspace-centric-redesign/design.md`
- `.kiro/specs/workspace-centric-redesign/requirements.md`
- `.kiro/specs/workspace-centric-redesign/tasks.md`

Related docs:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
