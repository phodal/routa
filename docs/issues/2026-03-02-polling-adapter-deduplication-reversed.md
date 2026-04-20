---
title: "GitHub Polling Adapter deduplication logic is reversed — duplicate PENDING tasks flood queue"
date: 2026-03-02
status: resolved
severity: high
area: polling / background-tasks
reported_by: copilot
github_issue: 23
github_state: closed
github_url: https://github.com/phodal/data-mesh-spike/issues/23
resolved_at: "2026-04-11"
fix_commit: "fix pollRepo() deduplication — break on lastEventId instead of skipping newer events"
---

## What Happened

`GET /api/background-tasks` returned 522 tasks, of which **513 were PENDING** — all with `triggerSource: "polling"`, created every ~30 seconds over ~10 minutes of uptime. The background worker (max 2 concurrent) cannot drain the queue; legitimate manual tasks dispatched later are permanently starved.

## Why This Might Happen

The `pollRepo()` method in `src/core/polling/github-polling-adapter.ts` (lines ~185–220) iterates GitHub Events API results (returned **newest-first**) using `lastEventId` as a sentinel:

```typescript
let foundLastEvent = !lastEventId; // true when no prior marker

for (const event of events) {
  if (event.id === lastEventId) { foundLastEvent = true; continue; }
  if (!foundLastEvent) continue;   // ← skips events NEWER than sentinel

  // reaches here only for events OLDER than lastEventId ← processed on every poll
  if (!result.newLastEventId) result.newLastEventId = event.id; // ← drifts back
  await this.processEvent(event, configs);
}
```

The guard `if (!foundLastEvent) continue` exits early for events **before** the sentinel (i.e., the newer ones) and processes all events **after** it (older ones). As a result:

- Every polling cycle replays increasingly older events.
- `newLastEventId` is set to an event older than the last marker, so the deduplication window moves backward in history rather than forward.
- Each 30 s tick: `N` new events → 0 processed (already seen), but `M` old events → re-processed.

The `lastEventIds` map is in-memory (not persisted), so a server restart also resets deduplication entirely.

## Relevant Files

- `src/core/polling/github-polling-adapter.ts` — `pollRepo()` method
- `src/app/api/polling/check/route.ts` — calls `getPollingAdapter()` and `adapter.checkNow()`
- `src/core/background-worker/index.ts` — `dispatchPending()` uses `listReadyToRun()` (FIFO, max 2)
- `src/core/store/background-task-store.ts` — `listPending()` / `listReadyToRun()`
