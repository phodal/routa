---
title: "Kanban session history still lacks durable lane metadata"
date: "2026-03-15"
status: "resolved"
resolved_at: "2026-04-03"
area: kanban
labels: ["Agent", "Kanban", "UX"]
---

## What Happened

Card detail can show historical session IDs again, but the underlying task data still stores session history as a flat `sessionIds` array.

That means the UI can show chronological runs, but it cannot always reconstruct the exact lane, specialist, or transition reason for each historical session in more complex flows such as:
- cards bouncing between `dev` and `review`
- cards entering `blocked` and later resuming
- manual reruns inside the same lane

## Why It Happened

The current task model tracks:
- `triggerSessionId` for the current active run
- `sessionIds` for the ordered history of associated sessions

It does **not** persist richer per-run metadata such as:
- lane / column at trigger time
- provider / specialist snapshot
- run timestamp independent of ACP session fetch success
- transition cause (entry automation, rerun, manual move, recovery from blocked)

As a result, the UI has to infer lane history from the current board order, which works for the happy path but is not authoritative for non-linear workflows.

## Resolution

This issue is resolved in the current codebase. The original report is now
historically outdated: task history is no longer limited to a flat `sessionIds`
array.

Evidence in current implementation:

- `src/core/models/task.ts` now persists `laneSessions` and `laneHandoffs`
  alongside `sessionIds`.
- `src/core/kanban/task-lane-history.ts` provides durable helpers to upsert lane
  session records, mark completion status, and track lane handoff requests.
- `src/core/db/schema.ts` and `src/core/db/sqlite-schema.ts` persist
  `laneSessions` / `laneHandoffs` in both Postgres and SQLite-backed stores.
- `src/core/kanban/session-kanban-context.ts` and related tests consume this
  richer history to reconstruct lane-specific context.
