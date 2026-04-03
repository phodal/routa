---
title: "Homepage and Kanban Entry Surface Fragmentation"
date: 2026-03-19
agent: Codex (GPT-5)
status: resolved
resolved_at: "2026-03-19"
severity: medium
area: frontend
tags: [homepage, kanban, workspace, information-architecture, ux]
github_issue: 203
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/203"
---

# Homepage and Kanban Entry Surface Fragmentation

## What happened

Routa's primary operating surface has shifted toward Kanban, but the UI still presents three competing entry points:

1. `/` behaves like a launcher and also renders Kanban-derived board/task telemetry
2. `/workspace/{workspaceId}` behaves like a second dashboard and embeds Kanban as the default tab
3. `/workspace/{workspaceId}/kanban` behaves like the actual production work surface

This makes the product feel undecided about where work should start and where work should continue.

## Why it matters

Local issue file: `docs/issues/2026-03-19-homepage-kanban-entry-surface-fragmentation.md`

- Users see duplicated task-entry surfaces and repeated workspace/task summaries
- Navigation semantics are weak: "Open workspace" and "Open board" lead to overlapping experiences
- Kanban is positioned as the core surface in UI copy, but the route hierarchy still treats it as one tab among several
- Homepage tests and product copy are drifting because the homepage is simultaneously treated as a landing page, launcher, and Kanban summary

## Observable symptoms

- `HomeInput` is rendered in multiple entry surfaces
- Homepage fetches board/task snapshots and previews active lanes instead of remaining a focused launcher
- Workspace page defaults to a Kanban tab, duplicating the standalone Kanban route
- Test expectations still encode multiple homepage narratives (`Kanban-First Control Surface`, `Open board`, older `Kanban Core` copy)

## Files likely involved

- `src/app/page.tsx`
- `src/client/components/home-page-sections.tsx`
- `src/app/workspace/[workspaceId]/page.tsx`
- `src/app/workspace/[workspaceId]/workspace-page-client.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `e2e/layout-verification.spec.ts`
- `e2e/homepage-open-board-tauri.spec.ts`

## Desired direction

- Keep `/` as a global launcher for workspace selection, new requirement entry, and recent activity recovery
- Make `/workspace/{workspaceId}/kanban` the canonical operating surface for task execution
- Reduce or remove Kanban duplication from `/workspace/{workspaceId}`
- Align route semantics, copy, and tests around a single primary workflow

## Progress notes

- Phase 1: homepage no longer renders a Kanban snapshot/control-summary surface
- Phase 2: `/workspace/{workspaceId}` was converted from a second Kanban shell into a true overview surface
- Phase 3: desktop navigation semantics were unified to `Overview / Kanban / Traces`
- Decision for now: keep `/workspace/{workspaceId}` as an overview route instead of redirecting, because it still provides recovery/context functions that are distinct from active board execution

## Resolution

This issue is resolved in the current codebase and the upstream GitHub issue is
closed.

Evidence in current implementation:

- `src/app/workspace/[workspaceId]/page.tsx` now redirects the workspace root to
  `/workspace/{workspaceId}/kanban`, making Kanban the canonical operating
  surface.
- `src/app/workspace/[workspaceId]/overview/page.tsx` keeps overview as an
  explicit sibling route instead of a second implicit Kanban shell.
- `src/client/components/desktop-sidebar.tsx` exposes distinct `Kanban`,
  `Overview`, and `Team` navigation entries, which removes the earlier route
  ambiguity from the main desktop shell.
