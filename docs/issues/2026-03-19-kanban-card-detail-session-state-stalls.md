---
title: "Kanban card detail session pane can stall when ACP session appears after the detail view opens"
date: "2026-03-19"
status: resolved
resolved_at: "2026-03-19"
severity: high
area: "kanban"
tags: [kanban, acp, session, ui, refresh, sse]
reported_by: "Codex"
github_state: null
github_url: null
related_issues: [
  "docs/issues/2026-03-12-kanban-column-automation-and-manual-issue-modal.md",
  "docs/issues/2026-03-14-kanban-story-lane-automation-stalls-after-first-session.md"
]
---

# Kanban card detail session pane can stall when ACP session appears after the detail view opens

## What Happened

While using the Kanban card detail overlay, the right-side ACP session area can get stuck in an empty or stale state when the card is opened before the task's ACP session metadata is fully visible to the frontend.

Observed behavior from the current UI:

1. A card detail opens while `task.triggerSessionId` is still empty or not yet reflected in the current frontend state.
2. The backend later creates or persists the ACP session and updates the task.
3. The Kanban detail overlay does not reliably switch from the empty session pane to the real session pane.
4. In some runs the task is already complete and the evidence exists, but the detail panel still shows stale session state until the user manually leaves and reopens or triggers another refresh path.

## Expected Behavior

- If a card is open and its ACP session becomes available shortly afterward, the detail overlay should self-heal and show the session without requiring the user to close and reopen the card.
- If the session id is known but the full session record is missing from the current sessions list, the frontend should fetch that one session directly instead of waiting for a future full-list refresh.
- The detail view should expose a lightweight manual refresh control as a user-visible fallback.

## Reproduction Context

- Environment: Kanban card detail overlay in the workspace board UI
- Trigger: opening a card while ACP session creation / task persistence / sessions list refresh are still converging
- Evidence: user-provided screenshot in the chat shows a blocked-resolution card whose work is complete, while the Kanban detail/session state is inconsistent

## Why This Might Happen

There are three likely contributors in the current implementation:

1. `activeSessionId` is initialized only when the card detail opens and is not reliably re-synchronized when `task.triggerSessionId` appears later.
2. The detail pane renders from the parent `sessions` collection only; when a specific session is missing from that collection, there is no direct backfill fetch for `/api/sessions/[sessionId]`.
3. The Kanban invalidation path depends partly on SSE semantics that are not equivalent across the Next.js route and the Rust route. The frontend expects `kanban:changed`, but the Rust-side `/api/kanban/events` currently emits only `connected` plus heartbeat comments.

## Relevant Files

- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx`
- `src/app/workspace/[workspaceId]/kanban/kanban-page-client.tsx`
- `src/client/hooks/use-kanban-events.ts`
- `src/app/api/sessions/[sessionId]/route.ts`
- `src/app/api/kanban/events/route.ts`
- `crates/routa-server/src/api/kanban.rs`

## Observations

- `openTaskDetail()` selects `task.triggerSessionId` or the latest historical session only once at open time.
- The detail render path uses `sessions.find(...)` for both `sessionInfo` and the right-side active session.
- There is no targeted fetch to backfill a missing active session record by id.
- The current `useKanbanEvents()` hook invalidates on `kanban:changed`, but the Rust `/api/kanban/events` route does not currently emit that event type.

## Proposed Fix Plan

1. Add active-card session synchronization in `kanban-tab.tsx`:
   - when the currently open task gains a preferred session id, auto-fill `activeSessionId` if the user is still on the empty state
   - do not clobber a user-selected historical session that still belongs to the task

2. Add targeted session backfill in `kanban-tab.tsx`:
   - if the active session id is known but missing from the current sessions array, fetch `/api/sessions/[sessionId]`
   - merge the fetched record into a local fallback session map so the UI can render immediately

3. Add a short refresh burst for newly opened cards that should have an automation session but do not yet have one:
   - this covers the race between task update, session store visibility, and UI hydration

4. Add a manual refresh button in the card detail UI:
   - let users recover explicitly even if the automatic path misses a change

## Resolution

This issue is resolved in the current codebase.

Evidence in current implementation:

- `src/app/workspace/[workspaceId]/kanban/kanban-tab.tsx` now keeps
  `activeSessionId` synchronized with `getPreferredTaskSessionId(activeTask)`,
  but avoids clobbering a user-selected historical session that still belongs to
  the card.
- The same file maintains `backfilledSessions` and performs a targeted fetch to
  `/api/sessions/[sessionId]` when the preferred active session is known but
  missing from the current sessions list.
- The same file triggers `scheduleKanbanRefreshBurst(onRefresh)` for cards that
  should have automation but are still in the empty-session state, covering the
  task/session convergence race.
- `src/app/workspace/[workspaceId]/kanban/kanban-card-detail.tsx` now exposes a
  visible `Refresh` button in the detail header as a manual recovery path.
- `src/app/workspace/[workspaceId]/kanban/__tests__/kanban-tab.test.tsx`
  contains a focused regression test,
  `recovers when the trigger session appears after the detail view is already open`,
  which verifies the targeted session backfill path.

5. Later, evaluate whether to unify the Next.js and Rust Kanban SSE semantics:
   - make both runtimes emit compatible `kanban:changed` payloads
   - keep frontend correctness independent from SSE delivery so UI does not stall when events are delayed or absent
