---
title: "Backlog cards should not persist or consume speculative history memory before refinement confirms context"
date: "2026-04-22"
kind: issue
status: closed
severity: medium
area: "kanban"
tags: ["kanban", "backlog", "history-memory", "task-adaptive-harness"]
reported_by: "codex"
related_issues:
  - "docs/issues/2026-04-21-task-adaptive-harness-kanban-backlog-refine-and-card-detail.md"
  - "docs/issues/2026-04-22-save-jit-context-minimal-result-persistence.md"
github_issue: 521
github_state: closed
github_url: "https://github.com/phodal/routa/issues/521"
---

# Backlog cards should not persist or consume speculative history memory before refinement confirms context

## What Happened

Fresh backlog cards can accumulate `jitContextSnapshot` and start consuming `taskAdaptiveHarness` before the backlog refiner has confirmed any feature ownership or file-level hints.

This produces misleading "History Memory" on new backlog cards:

- the task itself still has no `contextSearchSpec`
- the card has not yet been refined by the backlog specialist
- but opening the history-memory panel can still hydrate and persist a `jitContextSnapshot`
- later backlog sessions may consume that speculative snapshot as if it were confirmed task context

In practice this can anchor a new story to the wrong feature family.

## Example

Card:

- `5f27533f-cc82-4c91-89b0-bb62427bd8db`
- title: `[Feature]Add Superpowers skill/spec import support`

Observed state:

- `contextSearchSpec` is `null`
- `jitContextSnapshot.featureId` was persisted as `feature-explorer`
- `jitContextSnapshot.recommendedContextSearchSpec.featureCandidates` contained `feature-explorer`
- `History Memory` displayed repeated reads and sessions from Feature Explorer / fitness / github work instead of Superpowers import work

This happened because the card title and a single linked backlog session were enough to trigger speculative task-adaptive inference, and the result was then saved back onto the task.

## Expected Behavior

Backlog lifecycle should be stricter:

1. A newly created backlog card starts with no `contextSearchSpec` and no persisted `jitContextSnapshot`.
2. Backlog refiner may use temporary feature/history preload during its own session, but that preload is session-scoped and not automatically written back to the task.
3. Only after the refiner explicitly confirms feature/file hints and writes them through `update_task.contextSearchSpec` should later backlog/todo/dev sessions consume task-adaptive history memory.
4. History-memory persistence should not happen automatically for backlog cards that still lack confirmed hints.

## Why This Matters

If speculative context is persisted too early:

- wrong features become sticky on the task
- saved history memory starts to look authoritative even though no refinement occurred
- later lanes inherit misleading prompts
- users lose trust in the "History Memory" surface

## Scope of Fix

- Treat backlog preload as temporary unless the refiner writes confirmed hints back.
- Gate backlog `taskAdaptiveHarness` startup for task-scoped sessions when the task still lacks:
  - explicit `contextSearchSpec`, or
  - saved structured history-memory analysis
- Do not auto-persist `jitContextSnapshot` from the card-detail history-memory panel for such backlog cards.
- Keep top-level planning input preload intact; this issue is specifically about task/card lifecycle.

## Relevant Files

- `src/core/kanban/task-adaptive.ts`
- `src/app/workspace/[workspaceId]/kanban/kanban-detail-panels.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-tab-panels.tsx`
- `src/core/kanban/agent-trigger.ts`

## Verification Targets

- Fresh backlog card without `contextSearchSpec`:
  - should not auto-persist `jitContextSnapshot` from detail-panel load
  - should not auto-start task-scoped backlog sessions with speculative `taskAdaptiveHarness`
- After backlog refiner writes `contextSearchSpec`:
  - task-scoped backlog/todo/dev sessions may consume task-adaptive preload
  - history-memory panel may persist confirmed snapshots

## Resolution

Implemented on 2026-04-22:

- task-scoped backlog `taskAdaptiveHarness` is now disabled unless the task already has confirmed `contextSearchSpec` or saved history-memory analysis
- the card-detail `History Memory` panel no longer auto-loads or persists speculative snapshots for fresh backlog cards
- if an old speculative `jitContextSnapshot` already exists on a fresh backlog card, opening the history-memory panel clears it back to `null`

## Verification

- `npx vitest run src/core/kanban/__tests__/task-adaptive.test.ts 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab-detail-and-prompts.test.tsx'`
- `npx vitest run 'src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx'`
- `npx tsc --noEmit`
- `entrix run --tier fast`

Real-card cleanup:

- `taskId=5f27533f-cc82-4c91-89b0-bb62427bd8db`
- stale `feature-explorer` `jitContextSnapshot` was cleared
- current API state is back to `contextSearchSpec: null` and no persisted history-memory snapshot
