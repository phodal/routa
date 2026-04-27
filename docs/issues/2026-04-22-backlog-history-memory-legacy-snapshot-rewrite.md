---
title: Legacy backlog cards can re-persist stale history memory snapshots
kind: issue
status: resolved
created_at: 2026-04-22
updated_at: 2026-04-22
---

## Summary

Fresh backlog cards now correctly avoid generating `contextSearchSpec` and `jitContextSnapshot`
before backlog refinement confirms feature or file hints.

Legacy backlog cards that already carry an old speculative `jitContextSnapshot` could still show
that stale snapshot again after it was manually cleared through the task API.

## Repro

Task:
- `5f27533f-cc82-4c91-89b0-bb62427bd8db`
- title: `[Feature]Add Superpowers skill/spec import support`

Observed on:
- `http://localhost:3000/workspace/default/kanban?boardId=4e8e567c-e308-48cd-a4f6-e3d8e1d17839&taskId=5f27533f-cc82-4c91-89b0-bb62427bd8db`

Steps:
1. `PATCH /api/tasks/5f27533f-cc82-4c91-89b0-bb62427bd8db` with `{"jitContextSnapshot": null}`
2. Confirm the immediate PATCH response no longer includes `jitContextSnapshot`
3. Wait about 2 seconds
4. `GET /api/tasks/5f27533f-cc82-4c91-89b0-bb62427bd8db`

Observed result before the fix:
- the old `jitContextSnapshot` can appear again
- the stale snapshot still points to `feature-explorer`

## Why It Matters

This makes backlog gating look unreliable on old cards:
- fresh cards behave correctly
- old cards can still show or reuse speculative history memory

That creates confusion during dogfooding because the UI appears to contradict the new rule.

## Evidence

- Fresh smoke task `f17fe830-b589-4d3d-9660-c93189957d02` stayed at:
  - `contextSearchSpec: null`
  - `jitContextSnapshot: null`
- Legacy task `5f27533f-cc82-4c91-89b0-bb62427bd8db` restored its stale snapshot within ~2s after manual clearing

## Resolution

Two changes were added:

1. save-path guards
   - fresh backlog tasks and unrelated task saves strip speculative `jitContextSnapshot`
   - this was added to task API routes and task-store save paths

2. read-path guards
   - task-store hydration and `/api/tasks` + `/api/tasks/[taskId]` serialization now also strip
     speculative backlog snapshots before returning payloads
   - this prevents old persisted rows from surfacing in Kanban UI or being reused by prompt preload

## Verification

- targeted tests:
  - `npx vitest run src/core/kanban/__tests__/task-adaptive.test.ts src/app/api/tasks/__tests__/route.test.ts 'src/app/api/tasks/[taskId]/__tests__/route.test.ts'`
  - `42 passed`
- typecheck:
  - `npx tsc --noEmit`
  - pass
- fast fitness:
  - `entrix run --tier fast`
  - pass
- live API:
  - `GET /api/tasks/5f27533f-cc82-4c91-89b0-bb62427bd8db`
  - `GET /api/tasks?workspaceId=default`
  - both no longer expose `jitContextSnapshot` for the legacy backlog card

## Notes

- During diagnosis, multiple old helper `node --eval` processes and an older `next-server` were
  still holding `routa.db`; they were cleaned up to avoid polluting live verification.
- The legacy row may still physically exist in SQLite, but the product behavior is now correct:
  backlog cards without confirmed context do not surface or reuse speculative history memory.
