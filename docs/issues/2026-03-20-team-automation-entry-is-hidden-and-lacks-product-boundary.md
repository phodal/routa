---
title: "Team automation already exists in specialists/CLI, but the product has no clear Team surface or boundary in the workspace UI"
date: "2026-03-20"
status: resolved
resolved_at: "2026-03-22"
severity: medium
area: "ui"
tags: ["team", "automation", "specialist", "workspace", "navigation", "information-architecture", "product"]
reported_by: "codex"
related_issues:
  - "2026-03-17-design-system-unified-desktop-sidebar-theme-routing.md"
  - "2026-03-19-homepage-kanban-entry-surface-fragmentation.md"
  - "2026-03-19-specialist-resource-layout-drift-and-loader-divergence.md"
  - "https://github.com/phodal/routa/issues/205"
github_issue: 205
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/205"
---

# Team automation already exists in specialists/CLI, but the product has no clear Team surface or boundary in the workspace UI

## What Happened

`team-*` specialists already exist in the runtime specialist catalog, including a dedicated `team-agent-lead` coordinator that is explicitly designed to receive a requirement, decompose it, delegate to role-specific members, and verify completion.

The same repository also already contains a CLI-level `routa team` flow that:

- discovers `team-*` members
- builds a team roster
- launches a team lead session
- streams the interactive coordination run

On the web side, the underlying ACP/session pipeline can already execute the same specialist, because session creation accepts `specialistId`, resolves specialist role/provider/model, and registers the orchestrator when the resolved role is `ROUTA`.

However, the workspace UI still has no dedicated Team entry, Team page, or Team-oriented runtime surface. In practice, Team mode is only reachable indirectly:

- by selecting a custom specialist from the Home input
- by knowing the right specialist ID in advance
- by treating the resulting session as a generic ROUTA session

This means the capability exists technically, but not as a product concept users can discover or reason about.

## Expected Behavior

If Team is intended to be a first-class capability, the product should make that intention legible:

- Team should be discoverable as a distinct workspace surface rather than hidden behind generic custom-specialist selection
- users should be able to understand how Team differs from plain Routa multi-agent mode and from static workflows
- the UI should expose Team runs as a meaningful object or surface, not just as generic sessions mixed with everything else
- navigation and information architecture should reflect whether Team is a core operating mode, an advanced specialist, or only a CLI feature

## Reproduction Context

- Environment: both
- Trigger: review of current `resources/specialists/team`, desktop navigation, Home input specialist selection, ACP session creation, workflow UI, and existing CLI team flow while considering a left-nav Team automation entry

## Why This Might Happen

- Team appears to have grown from the specialist/resource side and the CLI side first, before a corresponding workspace-level UI concept was defined
- the web product currently organizes work around pages such as Overview, Kanban, Sessions, Traces, and Settings, but Team does not map cleanly to any of those existing surfaces
- the current specialist API exposes specialists as a flat list, so Team members are runtime-visible but not product-visible as a category
- session/task/agent data is sufficient to run the coordinator flow, but there is no explicit Team run aggregate or Team-specific state model in the UI
- `workflow` and `team` both represent automation, but they are materially different concepts: one is a static background DAG, the other is an interactive lead-and-delegate operating mode

## Relevant Files

- `resources/specialists/team/agent-lead.yaml`
- `resources/specialists/team/backend-dev.yaml`
- `resources/specialists/team/frontend-dev.yaml`
- `resources/specialists/team/qa.yaml`
- `resources/specialists/team/researcher.yaml`
- `src/core/specialists/specialist-file-loader.ts`
- `src/client/components/home-input.tsx`
- `src/app/api/acp/route.ts`
- `src/app/api/sessions/route.ts`
- `src/core/acp/http-session-store.ts`
- `src/client/components/desktop-sidebar.tsx`
- `src/client/components/desktop-app-shell.tsx`
- `src/client/components/workflow-panel.tsx`
- `src/core/workflows/workflow-executor.ts`
- `crates/routa-cli/src/commands/team.rs`

## Observations

- `team-agent-lead` is already authored as a dedicated coordinator prompt, not as a generic specialist variant; it names a team roster and coordination rules directly.
- the specialist loader already supports taxonomy directories such as `team/`, `review/`, and `workflows/kanban/`, which means Team already exists structurally in runtime resources rather than being a one-off prompt hack.
- the Home input loads all specialists and lets users launch one as a custom specialist, which means Team is technically invokable from the UI today, but only through an expert-only path.
- ACP session creation already resolves `specialistId`, derives role/provider/model from the specialist, and registers an orchestrator for `ROUTA`; this makes Team runs viable without a new execution engine.
- the session store already records `specialistId`, so Team lead sessions are distinguishable in runtime data, but `/api/sessions` treats them as ordinary sessions with no Team-specific framing.
- the desktop left navigation currently exposes Home, Overview, Kanban, Traces, and Settings only; there is no Team surface in either desktop shell implementation.
- the existing workflow UI is oriented around YAML-defined background execution and static step graphs. That surface communicates repeatable pipelines, not interactive delegation or team supervision.
- the CLI `routa team` command makes Team feel like a first-class mode, while the web UI makes the same capability feel incidental. This creates cross-surface product drift.
- from an information-architecture standpoint, the unresolved question is not whether Team can run, but whether the product considers Team to be:
  - a specialist
  - a workspace operating mode
  - a reusable workflow template family
  - or a separate automation surface with its own runtime object

## References

- Local history searched:
  - `docs/issues/2026-03-17-design-system-unified-desktop-sidebar-theme-routing.md`
  - `docs/issues/2026-03-19-homepage-kanban-entry-surface-fragmentation.md`
  - `docs/issues/2026-03-19-specialist-resource-layout-drift-and-loader-divergence.md`

## Resolution

This issue is resolved in the current codebase and the upstream GitHub issue is
closed.

Evidence in current implementation:

- `src/client/components/desktop-sidebar.tsx` now exposes a first-class `Team`
  entry in workspace navigation.
- `src/app/workspace/[workspaceId]/team/page.tsx` and
  `src/app/workspace/[workspaceId]/team/team-page-client.tsx` provide a
  dedicated Team launch surface instead of hiding the capability behind generic
  specialist selection.
- `src/app/workspace/[workspaceId]/team/[sessionId]/page.tsx` and related
  Team-run components provide a dedicated runtime surface for Team sessions.
- `src/client/utils/specialist-categories.ts` and the Team page filter Team
  specialists structurally from the specialist catalog, matching the
  product-level Team concept.
