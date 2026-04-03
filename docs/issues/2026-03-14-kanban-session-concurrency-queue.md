---
title: "Kanban automation can overrun limited ACP provider capacity without queueing"
date: "2026-03-14"
status: resolved
resolved_at: "2026-03-15"
severity: high
area: "kanban"
tags: ["kanban", "automation", "queue", "concurrency", "acp"]
reported_by: "codex"
github_issue: 148
github_state: "closed"
github_url: "https://github.com/phodal/routa/issues/148"
related_issues:
  - https://github.com/phodal/routa/issues/148
---

# Kanban automation can overrun limited ACP provider capacity without queueing

## What Happened

Kanban card creation and column automation can start ACP coding sessions immediately without any board-level concurrency control. When multiple cards are created or auto-advanced close together, Routa may attempt to launch more ACP sessions than the configured provider capacity can handle.

## Expected Behavior

Kanban should expose an explicit queueing mechanism and a configurable concurrency limit so only a bounded number of ACP sessions run at once, while additional cards wait in queue and start later.

## Reproduction Context

- Environment: web
- Trigger: create or auto-advance multiple Kanban cards while column automation is enabled for a limited ACP provider

## Why This Might Happen

- Kanban automation currently creates sessions directly from `triggerAssignedTaskAgent` without a queue coordinator.
- Board settings expose column automation rules, but there is no board-level session concurrency limit or queued/running state for cards.

## Relevant Files

- `src/core/kanban/agent-trigger.ts`
- `src/core/kanban/workflow-orchestrator.ts`
- `src/core/kanban/workflow-orchestrator-singleton.ts`
- `src/core/models/kanban.ts`
- `src/core/models/task.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`

## Observations

- The session detail page already has local task queue handling for CRAFTER execution, so there is precedent for sequential dispatch.
- Kanban automation currently tracks active automations per card, but not provider capacity or pending queue order.

## References

- Local implementation task requested by user on 2026-03-14

## Resolution

This issue is resolved in the current codebase. The local status was updated during
issue hygiene on 2026-04-03 after verifying that the queueing and concurrency
controls are already implemented.

Evidence in current implementation:

- `src/core/kanban/kanban-session-queue.ts` enforces a per-board session queue,
  tracks queued and running cards, and drains queued work when slots reopen.
- `src/core/kanban/workflow-orchestrator-singleton.ts` routes Kanban automation
  through `enqueueKanbanTaskSession(...)` instead of starting ACP sessions
  unbounded.
- `src/app/workspace/[workspaceId]/kanban/kanban-settings-modal.tsx` exposes the
  board-level `Session queue` limit in the settings UI.
- `src/core/kanban/__tests__/kanban-session-queue.test.ts` covers saturation,
  draining, and stale queued-card cleanup behavior.
