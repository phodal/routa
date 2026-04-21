---
title: "Kanban should surface Task-Adaptive Harness in backlog refinement and card detail"
date: "2026-04-21"
kind: issue
status: open
severity: medium
area: kanban
tags:
  - kanban
  - harness
  - backlog-refinement
  - card-detail
  - task-adaptive-harness
  - sessions
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md"
github_issue: 516
github_state: open
github_url: "https://github.com/phodal/routa/issues/516"
---

# Kanban should surface Task-Adaptive Harness in backlog refinement and card detail

## What Happened

`Task-Adaptive Harness` now exists as an execution capability:

- ACP session creation can accept `taskAdaptiveHarness`
- Kanban prompt entry and move-blocked remediation already pass a task-adaptive context request
- MCP now exposes `assemble_task_adaptive_harness`

But the capability is still not productized in the two Kanban surfaces where users most need to see and trust it:

- backlog refinement, where a planner/refiner should load relevant prior task/session context before rewriting or decomposing a story
- card detail, where the operator should be able to see which history sessions and friction signals were selected, instead of receiving silent context injection

As a result, the feature currently behaves like hidden infrastructure rather than a visible Kanban workflow affordance.

## Expected Behavior

Kanban should treat `Task-Adaptive Harness` as a first-class refinement and inspection primitive.

Specifically:

- backlog refinement sessions should request task-adaptive hydration by default, especially for backlog-refiner / planning-oriented automation
- card detail should expose a compact harness summary, including matched history sessions, recovered files, and high-priority friction signals such as failed reads or repeated reads
- users should be able to understand why a planning/refinement session started with a specific historical context slice
- the detail surface should make it obvious whether the harness found strong matches, weak matches, or no relevant history

## Reproduction Context

- Environment: both
- Trigger:
  1. open Kanban and start or automate backlog/planning work
  2. observe that manual planning prompts and move-blocked remediation use `taskAdaptiveHarness`
  3. inspect backlog refinement and card detail flows
  4. note that the backlog refinement automation path is not yet clearly wired to the harness, and card detail does not show the compiled harness pack or confidence

## Why This Might Happen

- the current implementation prioritized session-start plumbing over Kanban UX surfacing
- backlog refinement has multiple entry paths, including automation and recovery, and not all of them currently pass task-adaptive inputs
- the compiled harness pack is injected into session startup but not yet stored or projected into a visible card-detail read model
- the current card detail panels focus on readiness, execution, evidence, and runs; they do not yet include a harness/context section

## Relevant Files

- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx`
- `src/core/harness/task-adaptive.ts`
- `src/core/harness/task-adaptive-tool.ts`
- `src/app/api/acp/acp-session-create.ts`

## Observations

- the current Kanban prompt path already passes `taskAdaptiveHarness` from `kanban-tab.tsx`
- move-blocked remediation also passes task-adaptive inputs, which confirms the harness is relevant to planning-style repair flows
- automation and recovery paths still create sessions outside that explicit Kanban prompt path
- card detail already has tabs for readiness, execution, changes, evidence, and runs, so a harness/context panel can fit the existing information architecture without inventing a brand-new surface

## References

- Local related issue: `docs/issues/2026-04-21-task-adaptive-harness-jit-history-session-context.md`
- GitHub umbrella issue: `https://github.com/phodal/routa/issues/515`
